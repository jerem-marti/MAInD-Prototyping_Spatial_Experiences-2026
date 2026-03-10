#!/usr/bin/env python3
"""
X1201 UPS power monitor for Shadow Creatures.

Monitors:
  - AC power loss via GPIO 6 (PLD pin on gpiochip4)
  - Battery voltage / SOC via I2C fuel gauge (MAX17040 @ 0x36)

Actions:
  - On AC loss + battery below threshold: graceful shutdown
  - On critical battery regardless of AC: graceful shutdown

Designed to run as a systemd service (shadow-power.service).
Requires: gpiod, smbus2
"""
import os
import shutil
import struct
import sys
import time
from subprocess import call

# ---------------------------------------------------------------------------
# Configuration (overridable via environment)
# ---------------------------------------------------------------------------

PLD_CHIP = os.environ.get("PLD_CHIP", "gpiochip4")
PLD_PIN = int(os.environ.get("PLD_PIN", "6"))

BAT_BUS = int(os.environ.get("BAT_BUS", "1"))
BAT_ADDR = int(os.environ.get("BAT_ADDR", "0x36"), 0)

# SOC threshold: shutdown if AC lost AND battery below this %
SHUTDOWN_SOC = float(os.environ.get("SHUTDOWN_SOC", "15"))

# Critical SOC: shutdown unconditionally (even on AC — gauge may be wrong)
CRITICAL_SOC = float(os.environ.get("CRITICAL_SOC", "5"))

# Voltage floor (V): shutdown if below this, as a safety net
CRITICAL_VOLTAGE = float(os.environ.get("CRITICAL_VOLTAGE", "3.20"))

# Seconds to wait after trigger before issuing shutdown
# (gives services time to finish in-flight work)
SHUTDOWN_DELAY = int(os.environ.get("SHUTDOWN_DELAY", "10"))

# Polling interval (seconds)
POLL_INTERVAL = float(os.environ.get("POLL_INTERVAL", "5"))

# How many consecutive low readings before triggering shutdown
# (avoids false triggers from transient dips)
TRIGGER_COUNT = int(os.environ.get("TRIGGER_COUNT", "3"))

# Disk usage: shutdown if root filesystem free space drops below this (MB)
DISK_CRITICAL_MB = int(os.environ.get("DISK_CRITICAL_MB", "100"))

# Disk cleanup paths (deleted before shutdown to free space for clean halt)
DISK_CLEANUP_GLOBS = [
    "/root/.kismet/*.kismet",
    "/Kismet-*.kismet",
]


# ---------------------------------------------------------------------------
# Battery fuel gauge (MAX17040 family @ 0x36)
# ---------------------------------------------------------------------------

def bat_read(bus):
    """Read battery voltage (V) and state-of-charge (%) from MAX17040."""
    raw_v = bus.read_word_data(BAT_ADDR, 0x02)
    swapped_v = struct.unpack("<H", struct.pack(">H", raw_v))[0]
    voltage = swapped_v * 1.25 / 1000 / 16

    raw_soc = bus.read_word_data(BAT_ADDR, 0x04)
    swapped_soc = struct.unpack("<H", struct.pack(">H", raw_soc))[0]
    soc = swapped_soc / 256.0

    return round(voltage, 3), round(soc, 1)


# ---------------------------------------------------------------------------
# AC power detection (GPIO 6 on gpiochip4)
# ---------------------------------------------------------------------------

def pld_setup():
    """Open GPIO line for power-loss detection. Returns (chip, line)."""
    import gpiod
    chip = gpiod.Chip(PLD_CHIP)
    line = chip.get_line(PLD_PIN)
    line.request(consumer="shadow-power", type=gpiod.LINE_REQ_DIR_IN)
    return chip, line


def pld_read(line):
    """Return True if AC power is connected, False if on battery."""
    return line.get_value() == 1


# ---------------------------------------------------------------------------
# Disk space watchdog
# ---------------------------------------------------------------------------

def disk_free_mb(path="/"):
    """Return free space on the filesystem containing *path*, in MB."""
    st = shutil.disk_usage(path)
    return st.free // (1024 * 1024)


def disk_cleanup():
    """Best-effort removal of known large disposable files."""
    import glob
    for pattern in DISK_CLEANUP_GLOBS:
        for f in glob.glob(pattern):
            try:
                os.remove(f)
                print(f"[POWER] Cleaned up {f}", flush=True)
            except OSError:
                pass


# ---------------------------------------------------------------------------
# Graceful shutdown
# ---------------------------------------------------------------------------

def do_shutdown():
    """Stop shadow services then power off."""
    print("[POWER] Stopping shadow services...", flush=True)
    call("sudo systemctl stop shadow-backend shadow-reducer shadow-kismet",
         shell=True)
    print(f"[POWER] Issuing shutdown in {SHUTDOWN_DELAY}s...", flush=True)
    time.sleep(SHUTDOWN_DELAY)
    call("sudo shutdown -h now", shell=True)
    sys.exit(0)


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------

def main():
    from smbus2 import SMBus

    print("[POWER] Shadow Creatures power monitor starting", flush=True)
    print(f"[POWER] PLD: {PLD_CHIP} GPIO {PLD_PIN}", flush=True)
    print(f"[POWER] Battery: bus {BAT_BUS}, addr 0x{BAT_ADDR:02X}", flush=True)
    print(f"[POWER] Thresholds: shutdown_soc={SHUTDOWN_SOC}%, "
          f"critical_soc={CRITICAL_SOC}%, "
          f"critical_voltage={CRITICAL_VOLTAGE}V", flush=True)

    # --- Init I2C (fuel gauge) ---
    bus = None
    try:
        bus = SMBus(BAT_BUS)
        v, s = bat_read(bus)
        print(f"[POWER] Fuel gauge OK: {v}V, {s}%", flush=True)
    except Exception as e:
        print(f"[POWER] WARNING: fuel gauge not found ({e}) — "
              "voltage/SOC monitoring disabled", file=sys.stderr, flush=True)
        bus = None

    # --- Init GPIO (PLD) ---
    pld_line = None
    pld_chip = None
    try:
        pld_chip, pld_line = pld_setup()
        ac = pld_read(pld_line)
        print(f"[POWER] PLD OK: AC {'connected' if ac else 'disconnected'}",
              flush=True)
    except Exception as e:
        print(f"[POWER] WARNING: PLD not available ({e}) — "
              "AC detection disabled", file=sys.stderr, flush=True)

    if bus is None and pld_line is None:
        print("[POWER] ERROR: neither fuel gauge nor PLD available — exiting",
              file=sys.stderr, flush=True)
        sys.exit(1)

    low_count = 0

    try:
        while True:
            # Read battery
            voltage, soc = (0.0, 100.0)
            if bus:
                try:
                    voltage, soc = bat_read(bus)
                except Exception as e:
                    print(f"[POWER] Battery read error: {e}",
                          file=sys.stderr, flush=True)

            # Read AC
            ac_on = True
            if pld_line:
                try:
                    ac_on = pld_read(pld_line)
                except Exception as e:
                    print(f"[POWER] PLD read error: {e}",
                          file=sys.stderr, flush=True)

            # Evaluate
            should_shutdown = False

            if voltage > 0 and voltage < CRITICAL_VOLTAGE:
                print(f"[POWER] CRITICAL voltage: {voltage}V < {CRITICAL_VOLTAGE}V",
                      flush=True)
                should_shutdown = True

            if soc <= CRITICAL_SOC:
                print(f"[POWER] CRITICAL SOC: {soc}% <= {CRITICAL_SOC}%",
                      flush=True)
                should_shutdown = True

            if not ac_on and soc <= SHUTDOWN_SOC:
                print(f"[POWER] AC lost + low SOC: {soc}% <= {SHUTDOWN_SOC}%",
                      flush=True)
                should_shutdown = True

            # Disk space check
            free_mb = disk_free_mb()
            if free_mb < DISK_CRITICAL_MB:
                print(f"[POWER] CRITICAL disk: {free_mb}MB free < {DISK_CRITICAL_MB}MB",
                      flush=True)
                disk_cleanup()
                # Re-check after cleanup
                free_mb = disk_free_mb()
                if free_mb < DISK_CRITICAL_MB:
                    print(f"[POWER] Still critical after cleanup: {free_mb}MB",
                          flush=True)
                    should_shutdown = True
                else:
                    print(f"[POWER] Cleanup recovered space: {free_mb}MB free",
                          flush=True)

            if should_shutdown:
                low_count += 1
                if low_count >= TRIGGER_COUNT:
                    print(f"[POWER] {low_count} consecutive triggers — "
                          "initiating shutdown", flush=True)
                    do_shutdown()
                else:
                    print(f"[POWER] Trigger {low_count}/{TRIGGER_COUNT}",
                          flush=True)
            else:
                if low_count > 0:
                    print("[POWER] Condition cleared, resetting counter",
                          flush=True)
                low_count = 0

            time.sleep(POLL_INTERVAL)

    except KeyboardInterrupt:
        print("[POWER] Interrupted", flush=True)
    finally:
        if bus:
            bus.close()
        if pld_line:
            pld_line.release()
        if pld_chip:
            pld_chip.close()


if __name__ == "__main__":
    main()
