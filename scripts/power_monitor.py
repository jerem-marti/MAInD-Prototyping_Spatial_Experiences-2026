#!/usr/bin/env python3
"""
X1201 UPS power monitor for Shadow Creatures.

Pure monitoring service — no shutdown logic.
Writes battery/AC state to a JSON file that the backend can read
and broadcast over WebSocket.

Monitors:
  - AC power status via GPIO 6 (PLD pin on gpiochip4)
  - Battery voltage / SOC via I2C fuel gauge (MAX17040 @ 0x36)

Designed to run as a systemd service (shadow-power.service).
Requires: python3-libgpiod, python3-smbus
"""
import json
import os
import struct
import sys
import time

# ---------------------------------------------------------------------------
# Configuration (overridable via environment)
# ---------------------------------------------------------------------------

PLD_CHIP = os.environ.get("PLD_CHIP", "/dev/gpiochip4")
PLD_PIN = int(os.environ.get("PLD_PIN", "6"))

BAT_BUS = int(os.environ.get("BAT_BUS", "1"))
BAT_ADDR = int(os.environ.get("BAT_ADDR", "0x36"), 0)

# Polling interval (seconds)
POLL_INTERVAL = float(os.environ.get("POLL_INTERVAL", "5"))

# State file written each cycle (readable by backend / other services)
STATE_FILE = os.environ.get(
    "POWER_STATE_FILE",
    os.path.join(os.path.dirname(__file__), "..", "state", "power_state.json"),
)


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
# Supports both libgpiod v1 (Bullseye/Bookworm) and v2 (Trixie)
# ---------------------------------------------------------------------------

_GPIOD_V2 = None  # will be set to True/False on first call


def _is_gpiod_v2():
    global _GPIOD_V2
    if _GPIOD_V2 is None:
        import gpiod
        _GPIOD_V2 = hasattr(gpiod, "request_lines")
    return _GPIOD_V2


def pld_setup():
    """Open GPIO line for power-loss detection.

    Returns an opaque handle suitable for pld_read() and pld_close().
    """
    import gpiod

    if _is_gpiod_v2():
        # libgpiod v2 API (Trixie)
        request = gpiod.request_lines(
            PLD_CHIP,
            consumer="shadow-power",
            config={PLD_PIN: gpiod.LineSettings(
                direction=gpiod.line.Direction.INPUT,
            )},
        )
        return request  # single object
    else:
        # libgpiod v1 API (Bookworm and older)
        chip = gpiod.Chip(PLD_CHIP)
        line = chip.get_line(PLD_PIN)
        line.request(consumer="shadow-power", type=gpiod.LINE_REQ_DIR_IN)
        return (chip, line)


def pld_read(handle):
    """Return True if AC power is connected, False if on battery."""
    import gpiod

    if _is_gpiod_v2():
        val = handle.get_value(PLD_PIN)
        return val == gpiod.line.Value.ACTIVE
    else:
        _chip, line = handle
        return line.get_value() == 1


def pld_close(handle):
    """Release the GPIO resources."""
    if _is_gpiod_v2():
        handle.release()
    else:
        chip, line = handle
        line.release()
        chip.close()


# ---------------------------------------------------------------------------
# State file
# ---------------------------------------------------------------------------

def write_state(voltage, soc, ac_on):
    """Write current power state to JSON file (atomic write)."""
    state = {
        "voltage": voltage,
        "soc": soc,
        "ac": ac_on,
        "charging": ac_on and soc < 100.0,
        "ts": time.time(),
    }
    tmp = STATE_FILE + ".tmp"
    try:
        os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
        with open(tmp, "w") as f:
            json.dump(state, f)
        os.replace(tmp, STATE_FILE)
    except OSError as e:
        print(f"[POWER] State write error: {e}", file=sys.stderr, flush=True)


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------

def main():
    from smbus2 import SMBus

    print("[POWER] Shadow Creatures power monitor starting", flush=True)
    print(f"[POWER] PLD: {PLD_CHIP} GPIO {PLD_PIN}", flush=True)
    print(f"[POWER] Battery: bus {BAT_BUS}, addr 0x{BAT_ADDR:02X}", flush=True)
    print(f"[POWER] State file: {os.path.abspath(STATE_FILE)}", flush=True)

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
    pld_handle = None
    try:
        pld_handle = pld_setup()
        ac = pld_read(pld_handle)
        print(f"[POWER] PLD OK: AC {'connected' if ac else 'disconnected'}",
              flush=True)
    except Exception as e:
        print(f"[POWER] WARNING: PLD not available ({e}) — "
              "AC detection disabled", file=sys.stderr, flush=True)

    if bus is None and pld_handle is None:
        print("[POWER] ERROR: neither fuel gauge nor PLD available — exiting",
              file=sys.stderr, flush=True)
        sys.exit(1)

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
            if pld_handle:
                try:
                    ac_on = pld_read(pld_handle)
                except Exception as e:
                    print(f"[POWER] PLD read error: {e}",
                          file=sys.stderr, flush=True)

            # Write state for other services to read
            write_state(voltage, soc, ac_on)

            time.sleep(POLL_INTERVAL)

    except KeyboardInterrupt:
        print("[POWER] Interrupted", flush=True)
    finally:
        if bus:
            bus.close()
        if pld_handle:
            pld_close(pld_handle)


if __name__ == "__main__":
    main()
