#!/usr/bin/env python3
import asyncio
import base64
import io
import json
import math
import os
import shutil
import signal
import sys
import time
from threading import Condition
from typing import Optional, Set

from aiohttp import web, WSMsgType
from gpiozero import Button, LED, PWMLED
from picamera2 import Picamera2
from picamera2.encoders import MJPEGEncoder
from picamera2.outputs import FileOutput

STATE_PATH = os.environ.get("GHOST_STATE_PATH",
             os.path.expanduser("~/shadow_creatures/state/ghost_state.json"))
SNAP_DIR = os.environ.get("SNAP_DIR",
           os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'state', 'snapshots'))
WEB_DIR = os.environ.get("WEB_DIR",
          os.path.expanduser("~/shadow_creatures/web"))
GALLERY_DIR = os.environ.get("GALLERY_DIR",
              os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'gallery'))

HTTP_PORT = int(os.environ.get("HTTP_PORT", "8080"))
BTN_SNAPSHOT = int(os.environ.get("BTN_SNAPSHOT", "12"))   # physical pin 32
BTN_MODE = int(os.environ.get("BTN_MODE", "26"))           # physical pin 37
LED_POWER = int(os.environ.get("LED_POWER", "17"))
LED_SENSE = int(os.environ.get("LED_SENSE", "6"))

# --- IMU (LSM6DS) configuration ---
IMU_BUS = int(os.environ.get("IMU_BUS", "1"))
IMU_ADDR = int(os.environ.get("IMU_ADDR", "0x6A"), 0)
IMU_RATE_HZ = int(os.environ.get("IMU_RATE_HZ", "50"))  # broadcast rate

# --- Battery fuel gauge (MAX17040) configuration ---
BAT_BUS = int(os.environ.get("BAT_BUS", "1"))
BAT_ADDR = int(os.environ.get("BAT_ADDR", "0x36"), 0)
BAT_RATE_HZ = float(os.environ.get("BAT_RATE_HZ", "0.2"))  # every 5 seconds


class StreamingOutput(io.BufferedIOBase):
    """
    Exactly the pattern used by Picamera2's mjpeg_server_2.py:
    encoder writes JPEG frames here; we keep the latest + signal waiters.
    """
    def __init__(self):
        self.frame: Optional[bytes] = None
        self.condition = Condition()

    def write(self, buf):
        with self.condition:
            self.frame = buf
            self.condition.notify_all()
        return len(buf)

    def wait_for_frame(self) -> bytes:
        with self.condition:
            self.condition.wait()
            return self.frame


class AppState:
    def __init__(self):
        self.ws_clients: Set[web.WebSocketResponse] = set()
        self.mode = 0  # 0 AP, 1 BT, 2 both
        self.last_state = {}
        self.last_mtime = 0.0
        self.led_power: Optional[LED] = None
        self.led_sense: Optional[PWMLED] = None
        self.btn_snap: Optional[Button] = None
        self.btn_mode: Optional[Button] = None
        self.power_on = False
        self.sense_on = False
        self.sense_device_count = 0

    async def broadcast(self, payload: dict):
        dead = []
        for ws in self.ws_clients:
            try:
                await ws.send_str(json.dumps(payload))
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.ws_clients.discard(ws)

app_state = AppState()


# ─── IMU helpers ──────────────────────────────────────────────────────────────

def _twos_complement_16(lo, hi):
    v = (hi << 8) | lo
    return v - 65536 if v >= 32768 else v


def _imu_init(bus):
    """Configure LSM6DS: accel 104 Hz +/-2g, gyro 104 Hz 245 dps, auto-increment."""
    bus.write_byte_data(IMU_ADDR, 0x12, 0x04)   # CTRL3_C: auto-increment
    bus.write_byte_data(IMU_ADDR, 0x10, 0x40)   # CTRL1_XL: 104 Hz, 2g
    bus.write_byte_data(IMU_ADDR, 0x11, 0x40)   # CTRL2_G: 104 Hz, 245 dps
    time.sleep(0.1)   # 100 ms settle (matches proven test script value)


def _imu_read(bus):
    """Read accel (g) and gyro (dps) from LSM6DS. Returns (ax, ay, az, gx, gy, gz)."""
    ACC_SCALE = 0.000061   # 2g: 0.061 mg/LSB
    GYRO_SCALE = 0.00875   # 245 dps: 8.75 mdps/LSB

    raw_g = bus.read_i2c_block_data(IMU_ADDR, 0x22, 6)
    raw_a = bus.read_i2c_block_data(IMU_ADDR, 0x28, 6)

    gx = _twos_complement_16(raw_g[0], raw_g[1]) * GYRO_SCALE
    gy = _twos_complement_16(raw_g[2], raw_g[3]) * GYRO_SCALE
    gz = _twos_complement_16(raw_g[4], raw_g[5]) * GYRO_SCALE

    ax = _twos_complement_16(raw_a[0], raw_a[1]) * ACC_SCALE
    ay = _twos_complement_16(raw_a[2], raw_a[3]) * ACC_SCALE
    az = _twos_complement_16(raw_a[4], raw_a[5]) * ACC_SCALE

    return ax, ay, az, gx, gy, gz


def _blocking_imu_loop(bus):
    """
    Blocking loop that reads the IMU at ~100 Hz and maintains integrated
    yaw / pitch / roll using a complementary filter.
    Returns a generator yielding (yaw, pitch, roll) dicts.
    """
    _imu_init(bus)

    yaw = 0.0
    pitch = 0.0
    roll = 0.0
    last_t = time.monotonic()
    alpha = 0.98  # complementary filter weight (gyro trust)

    while True:
        ax, ay, az, gx, gy, gz = _imu_read(bus)
        now = time.monotonic()
        dt = now - last_t
        last_t = now

        # Accelerometer-derived tilt angles (degrees)
        acc_pitch = math.degrees(math.atan2(ax, math.sqrt(ay * ay + az * az)))
        acc_roll = math.degrees(math.atan2(ay, math.sqrt(ax * ax + az * az)))

        # Gyro integration — gy integrates pitch (Y-axis rotation), gx integrates roll (X-axis)
        pitch = alpha * (pitch + gy * dt) + (1 - alpha) * acc_pitch
        roll = alpha * (roll + gx * dt) + (1 - alpha) * acc_roll
        yaw += gz * dt  # no accelerometer reference for yaw — gyro only

        # Wrap yaw to 0-360
        yaw = yaw % 360

        yield {"yaw": round(yaw, 2), "pitch": round(pitch, 2), "roll": round(roll, 2)}
        # No sleep here — broadcast rate is governed by asyncio.sleep() in imu_broadcaster


async def imu_broadcaster():
    """
    Async coroutine: reads IMU in a worker thread, broadcasts orientation
    to all WebSocket clients at IMU_RATE_HZ.
    """
    try:
        from smbus2 import SMBus
    except ImportError:
        print("[IMU] smbus2 not available — IMU disabled", file=sys.stderr)
        return

    bus = None
    try:
        bus = SMBus(IMU_BUS)
        who = bus.read_byte_data(IMU_ADDR, 0x0F)
        print(f"[IMU] LSM6DS detected: WHO_AM_I=0x{who:02X} on bus {IMU_BUS}, addr 0x{IMU_ADDR:02X}")
    except Exception as e:
        print(f"[IMU] Sensor not found ({e}) — IMU disabled", file=sys.stderr)
        if bus:
            bus.close()
        return

    gen = _blocking_imu_loop(bus)
    interval = 1.0 / IMU_RATE_HZ

    try:
        while True:
            try:
                orientation = await asyncio.to_thread(next, gen)
            except StopIteration:
                break
            except Exception as e:
                print(f"[IMU] Read error (will retry): {e}", file=sys.stderr)
                await asyncio.sleep(interval)
                continue
            payload = {"type": "imu", **orientation}
            await app_state.broadcast(payload)
            await asyncio.sleep(interval)
    except asyncio.CancelledError:
        pass
    finally:
        gen.close()   # signal generator to stop before closing the bus
        bus.close()


# ─── Battery fuel gauge (MAX17040) ────────────────────────────────────────────

def _bat_read(bus):
    """Read battery voltage (V) and state-of-charge (%) from MAX17040."""
    raw_v = bus.read_i2c_block_data(BAT_ADDR, 0x02, 2)
    raw_soc = bus.read_i2c_block_data(BAT_ADDR, 0x04, 2)
    voltage = ((raw_v[0] << 4) | (raw_v[1] >> 4)) * 1.25 / 1000.0  # mV -> V
    soc = raw_soc[0] + raw_soc[1] / 256.0  # integer + fractional %
    return round(voltage, 3), round(soc, 1)


async def battery_broadcaster():
    """
    Async coroutine: reads battery fuel gauge at BAT_RATE_HZ, broadcasts
    voltage and SOC to all WebSocket clients.
    """
    try:
        from smbus2 import SMBus
    except ImportError:
        print("[BAT] smbus2 not available — battery monitor disabled", file=sys.stderr)
        return

    bus = None
    try:
        bus = SMBus(BAT_BUS)
        # Quick probe — read version register (0x08)
        ver = bus.read_i2c_block_data(BAT_ADDR, 0x08, 2)
        print(f"[BAT] MAX17040 detected: version=0x{ver[0]:02X}{ver[1]:02X} on bus {BAT_BUS}, addr 0x{BAT_ADDR:02X}")
    except Exception as e:
        print(f"[BAT] Fuel gauge not found ({e}) — battery monitor disabled", file=sys.stderr)
        if bus:
            bus.close()
        return

    interval = 1.0 / BAT_RATE_HZ

    try:
        while True:
            try:
                voltage, soc = await asyncio.to_thread(_bat_read, bus)
            except Exception as e:
                print(f"[BAT] Read error (will retry): {e}", file=sys.stderr)
                await asyncio.sleep(interval)
                continue
            payload = {"type": "battery", "voltage": voltage, "soc": soc}
            await app_state.broadcast(payload)
            await asyncio.sleep(interval)
    except asyncio.CancelledError:
        pass
    finally:
        bus.close()


# ─── HTTP handlers ────────────────────────────────────────────────────────────

async def index(_request):
    return web.FileResponse(os.path.join(WEB_DIR, "index.html"))

async def static_files(request):
    path = request.match_info["path"]
    full = os.path.realpath(os.path.join(WEB_DIR, path))
    if not full.startswith(os.path.realpath(WEB_DIR)):
        raise web.HTTPForbidden()
    if not os.path.isfile(full):
        raise web.HTTPNotFound()
    return web.FileResponse(full)

async def ws_handler(request):
    ws = web.WebSocketResponse()
    await ws.prepare(request)

    app_state.ws_clients.add(ws)
    await ws.send_str(json.dumps({"type": "mode", "mode": app_state.mode}))
    if app_state.last_state:
        await ws.send_str(json.dumps({"type": "state", "state": app_state.last_state}))
    await ws.send_str(json.dumps({"type": "leds", "power": app_state.power_on, "sense": app_state.sense_on}))

    async for msg in ws:
        if msg.type == WSMsgType.TEXT:
            try:
                data = json.loads(msg.data)
            except Exception:
                continue

            if data.get("type") == "set_mode":
                app_state.mode = int(data.get("mode", 0)) % 3
                await app_state.broadcast({"type": "mode", "mode": app_state.mode})

            if data.get("type") == "snapshot_request":
                await app_state.broadcast({"type": "snapshot"})

            if data.get("type") == "gallery_toggle":
                await app_state.broadcast({"type": "gallery_toggle"})

        elif msg.type == WSMsgType.ERROR:
            break

    app_state.ws_clients.discard(ws)
    return ws

async def upload_snapshot(request):
    payload = await request.json()
    data_url = payload.get("data_url", "")
    live_webm = payload.get("live_webm", "")

    if not data_url.startswith("data:image/png;base64,"):
        return web.json_response({"ok": False, "error": "Expected PNG data URL"}, status=400)

    raw_png = base64.b64decode(data_url.split(",", 1)[1])

    ts = time.strftime("%Y%m%d-%H%M%S") + f"-{int(time.time()*1000)%1000:03d}"
    snap_subdir = os.path.join(SNAP_DIR, f"shadow_{ts}")
    os.makedirs(snap_subdir, exist_ok=True)

    # Save still PNG
    png_path = os.path.join(snap_subdir, "still.png")
    with open(png_path, "wb") as f:
        f.write(raw_png)

    # Save Live Photo WebM if present
    if live_webm and "," in live_webm:
        raw_webm = base64.b64decode(live_webm.split(",", 1)[1])
        webm_path = os.path.join(snap_subdir, "live.webm")
        with open(webm_path, "wb") as f:
            f.write(raw_webm)

    # Save ghost state JSON
    json_path = os.path.join(snap_subdir, "state.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(app_state.last_state or {}, f, ensure_ascii=False)

    return web.json_response({"ok": True, "dir": snap_subdir})

# ─── Gallery API + static serving ────────────────────────────────────────────

async def list_snapshots(_request):
    """Return JSON array of snapshot metadata, sorted newest first."""
    snapshots = []
    if not os.path.isdir(SNAP_DIR):
        return web.json_response(snapshots)
    for name in sorted(os.listdir(SNAP_DIR), reverse=True):
        snap_path = os.path.join(SNAP_DIR, name)
        if not os.path.isdir(snap_path):
            continue
        still = os.path.join(snap_path, "still.png")
        if not os.path.isfile(still):
            continue
        snapshots.append({
            "name": name,
            "has_live": os.path.isfile(os.path.join(snap_path, "live.webm")),
            "has_state": os.path.isfile(os.path.join(snap_path, "state.json")),
            "timestamp": os.path.getmtime(still),
        })
    return web.json_response(snapshots)

async def serve_snapshot_file(request):
    """Serve a file from a snapshot directory (whitelist: still.png, live.webm, state.json)."""
    name = request.match_info["name"]
    filename = request.match_info["file"]
    if filename not in ("still.png", "live.webm", "state.json"):
        raise web.HTTPForbidden()
    full = os.path.realpath(os.path.join(SNAP_DIR, name, filename))
    if not full.startswith(os.path.realpath(SNAP_DIR)):
        raise web.HTTPForbidden()
    if not os.path.isfile(full):
        raise web.HTTPNotFound()
    return web.FileResponse(full)

async def delete_snapshot(request):
    """Delete a snapshot directory and all its files."""
    name = request.match_info["name"]
    snap_path = os.path.realpath(os.path.join(SNAP_DIR, name))
    if not snap_path.startswith(os.path.realpath(SNAP_DIR)):
        raise web.HTTPForbidden()
    if not os.path.isdir(snap_path):
        raise web.HTTPNotFound()
    shutil.rmtree(snap_path)
    return web.json_response({"ok": True, "deleted": name})

async def gallery_index(_request):
    return web.FileResponse(os.path.join(GALLERY_DIR, "index.html"))

async def gallery_static(request):
    path = request.match_info["path"]
    full = os.path.realpath(os.path.join(GALLERY_DIR, path))
    if not full.startswith(os.path.realpath(GALLERY_DIR)):
        raise web.HTTPForbidden()
    if not os.path.isfile(full):
        raise web.HTTPNotFound()
    return web.FileResponse(full)

def _pulse_speed(device_count: int) -> tuple:
    """Map device count to (fade_in_time, fade_out_time) for PWMLED.pulse().
    More devices → faster breathing.
      0 devices  → LED off (handled by caller)
      1-3        → slow breath (1.5s in, 1.5s out)
      4-10       → medium (0.8s in, 0.8s out)
      11-25      → fast (0.4s in, 0.4s out)
      26+        → rapid (0.2s in, 0.2s out)
    """
    if device_count <= 3:
        return (1.5, 1.5)
    elif device_count <= 10:
        return (0.8, 0.8)
    elif device_count <= 25:
        return (0.4, 0.4)
    else:
        return (0.2, 0.2)


async def state_watcher():
    while True:
        try:
            st = os.stat(STATE_PATH)
            if st.st_mtime != app_state.last_mtime:
                app_state.last_mtime = st.st_mtime
                with open(STATE_PATH, "r", encoding="utf-8") as f:
                    app_state.last_state = json.load(f)
                await app_state.broadcast({"type": "state", "state": app_state.last_state})

                aps = app_state.last_state.get("wifi", {}).get("aps") or []
                clients = app_state.last_state.get("wifi", {}).get("clients") or []
                bt_devs = app_state.last_state.get("bt", {}).get("devices") or []
                device_count = len(aps) + len(clients) + len(bt_devs)

                if device_count > 0 and not app_state.sense_on:
                    # Start pulsing
                    fade_in, fade_out = _pulse_speed(device_count)
                    app_state.led_sense.pulse(fade_in_time=fade_in, fade_out_time=fade_out)
                    app_state.sense_on = True
                    app_state.sense_device_count = device_count
                    await app_state.broadcast({"type": "leds", "power": app_state.power_on, "sense": app_state.sense_on})
                elif device_count > 0 and app_state.sense_on and device_count != app_state.sense_device_count:
                    # Adjust pulse speed when device count changes tier
                    old_speed = _pulse_speed(app_state.sense_device_count)
                    new_speed = _pulse_speed(device_count)
                    if old_speed != new_speed:
                        app_state.led_sense.pulse(fade_in_time=new_speed[0], fade_out_time=new_speed[1])
                    app_state.sense_device_count = device_count
                elif device_count == 0 and app_state.sense_on:
                    app_state.led_sense.off()
                    app_state.sense_on = False
                    app_state.sense_device_count = 0
                    await app_state.broadcast({"type": "leds", "power": app_state.power_on, "sense": app_state.sense_on})
        except FileNotFoundError:
            pass
        except Exception as e:
            print(f"state_watcher error: {e}", file=sys.stderr)
        await asyncio.sleep(0.2)

async def mjpeg_handler(request):
    output: StreamingOutput = request.app["stream_output"]

    resp = web.StreamResponse(
        status=200,
        headers={
            "Content-Type": "multipart/x-mixed-replace; boundary=FRAME",
            "Cache-Control": "no-cache, private",
            "Pragma": "no-cache",
            "Age": "0",
        },
    )
    await resp.prepare(request)

    try:
        while True:
            # Wait for next frame in a worker thread (doesn't block the event loop)
            frame = await asyncio.to_thread(output.wait_for_frame)
            if not frame:
                continue

            await resp.write(b"--FRAME\r\n")
            await resp.write(b"Content-Type: image/jpeg\r\n")
            await resp.write(f"Content-Length: {len(frame)}\r\n\r\n".encode("utf-8"))
            await resp.write(frame)
            await resp.write(b"\r\n")
    except (ConnectionResetError, asyncio.CancelledError, BrokenPipeError):
        pass
    except Exception:
        pass

    return resp

def setup_gpio(loop):
    # Store on app_state to prevent garbage collection — gpiozero Button
    # objects deregister GPIO callbacks when GC'd (close() is called).
    print(f"[GPIO] Setting up buttons on pins {BTN_SNAPSHOT}, {BTN_MODE}", flush=True)
    app_state.btn_snap = Button(BTN_SNAPSHOT, pull_up=True, bounce_time=0.05)
    app_state.btn_mode = Button(BTN_MODE, pull_up=True, bounce_time=0.05)
    print(f"[GPIO] Button factory: {app_state.btn_snap.pin_factory}", flush=True)
    print(f"[GPIO] Snap pin: {app_state.btn_snap.pin}, value: {app_state.btn_snap.value}", flush=True)

    def on_snap():
        print("[GPIO] Snapshot button pressed!", flush=True)
        asyncio.run_coroutine_threadsafe(app_state.broadcast({"type": "snapshot"}), loop)

    def on_mode():
        asyncio.run_coroutine_threadsafe(app_state.broadcast({"type": "gallery_toggle"}), loop)

    app_state.btn_snap.when_pressed = on_snap
    app_state.btn_mode.when_pressed = on_mode
    print("[GPIO] Callbacks registered OK", flush=True)

async def on_startup(app):
    os.makedirs(SNAP_DIR, exist_ok=True)

    picam2 = Picamera2()
    # Keep it simple and encoder-friendly (like picamera2 examples)
    picam2.configure(picam2.create_video_configuration(main={"size": (1280, 720)}))

    output = StreamingOutput()
    app["stream_output"] = output
    app["picam2"] = picam2

    picam2.start()
    picam2.start_recording(MJPEGEncoder(), FileOutput(output))

    app["watcher_task"] = asyncio.create_task(state_watcher())
    app["imu_task"] = asyncio.create_task(imu_broadcaster())
    app["bat_task"] = asyncio.create_task(battery_broadcaster())
    setup_gpio(asyncio.get_running_loop())

    app_state.led_power = LED(LED_POWER)
    app_state.led_sense = PWMLED(LED_SENSE)
    app_state.led_power.on()
    app_state.power_on = True

    # Ensure LEDs turn off on SIGTERM (systemd sends this before SIGKILL on shutdown)
    def _shutdown_leds(signum, frame):
        try:
            if app_state.led_sense:
                app_state.led_sense.off()
            if app_state.led_power:
                app_state.led_power.off()
        except Exception:
            pass
        # Re-raise so aiohttp's own handler still runs
        raise SystemExit(0)

    signal.signal(signal.SIGTERM, _shutdown_leds)

async def on_cleanup(app):
    try:
        app["watcher_task"].cancel()
    except Exception:
        pass
    try:
        app["imu_task"].cancel()
    except Exception:
        pass
    try:
        app["bat_task"].cancel()
    except Exception:
        pass
    try:
        app["picam2"].stop_recording()
        app["picam2"].stop()
    except Exception:
        pass
    try:
        if app_state.led_sense:
            app_state.led_sense.off()
            app_state.led_sense.close()
        if app_state.led_power:
            app_state.led_power.off()
            app_state.led_power.close()
    except Exception:
        pass
    try:
        if app_state.btn_snap:
            app_state.btn_snap.close()
        if app_state.btn_mode:
            app_state.btn_mode.close()
    except Exception:
        pass

def main():
    app = web.Application(client_max_size=10 * 1024 * 1024)  # 10 MB for Live Photo uploads
    app.router.add_get("/", index)
    app.router.add_get("/mjpeg", mjpeg_handler)
    app.router.add_get("/ws", ws_handler)
    app.router.add_post("/api/upload_snapshot", upload_snapshot)

    # Gallery API
    app.router.add_get("/api/snapshots", list_snapshots)
    app.router.add_delete("/api/snapshots/{name}", delete_snapshot)

    # Snapshot file serving
    app.router.add_get("/snapshots/{name}/{file}", serve_snapshot_file)

    # Gallery UI
    app.router.add_get("/gallery", gallery_index)
    app.router.add_get("/gallery/", gallery_index)
    app.router.add_get("/gallery/{path:.*}", gallery_static)

    # Main web app static files (catch-all — must be LAST)
    app.router.add_get("/{path:.*}", static_files)

    app.on_startup.append(on_startup)
    app.on_cleanup.append(on_cleanup)

    web.run_app(app, host="0.0.0.0", port=HTTP_PORT)

if __name__ == "__main__":
    main()
