#!/usr/bin/env python3
import asyncio
import base64
import io
import json
import os
import sys
import time
from threading import Condition
from typing import Optional, Set

from aiohttp import web, WSMsgType
from gpiozero import Button, LED
from picamera2 import Picamera2
from picamera2.encoders import MJPEGEncoder
from picamera2.outputs import FileOutput

STATE_PATH = os.environ.get("GHOST_STATE_PATH",
             os.path.expanduser("~/shadow_creatures/state/ghost_state.json"))
SNAP_DIR = os.environ.get("SNAP_DIR",
           os.path.expanduser("~/shadow_creatures/state/snaps"))
WEB_DIR = os.environ.get("WEB_DIR",
          os.path.expanduser("~/shadow_creatures/web"))

HTTP_PORT = int(os.environ.get("HTTP_PORT", "8080"))
BTN_SNAPSHOT = int(os.environ.get("BTN_SNAPSHOT", "17"))
BTN_MODE = int(os.environ.get("BTN_MODE", "27"))
LED_POWER = int(os.environ.get("LED_POWER", "0"))
LED_SENSE = int(os.environ.get("LED_SENSE", "6"))

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
        self.led_sense: Optional[LED] = None
        self.power_on = False
        self.sense_on = False

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

        elif msg.type == WSMsgType.ERROR:
            break

    app_state.ws_clients.discard(ws)
    return ws

async def upload_snapshot(request):
    os.makedirs(SNAP_DIR, exist_ok=True)
    payload = await request.json()
    data_url = payload.get("data_url", "")
    if not data_url.startswith("data:image/png;base64,"):
        return web.json_response({"ok": False, "error": "Expected PNG data URL"}, status=400)

    raw = base64.b64decode(data_url.split(",", 1)[1])

    ts = time.strftime("%Y%m%d-%H%M%S") + f"-{int(time.time()*1000)%1000:03d}"
    png_path = os.path.join(SNAP_DIR, f"shadow_{ts}.png")
    with open(png_path, "wb") as f:
        f.write(raw)

    json_path = os.path.join(SNAP_DIR, f"shadow_{ts}.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(app_state.last_state or {}, f, ensure_ascii=False)

    return web.json_response({"ok": True, "path": png_path})

async def state_watcher():
    while True:
        try:
            st = os.stat(STATE_PATH)
            if st.st_mtime != app_state.last_mtime:
                app_state.last_mtime = st.st_mtime
                with open(STATE_PATH, "r", encoding="utf-8") as f:
                    app_state.last_state = json.load(f)
                await app_state.broadcast({"type": "state", "state": app_state.last_state})

                has_devices = bool(
                    app_state.last_state.get("wifi", {}).get("aps")
                    or app_state.last_state.get("bt", {}).get("devices")
                )
                if has_devices and not app_state.sense_on:
                    app_state.led_sense.on()
                    app_state.sense_on = True
                    await app_state.broadcast({"type": "leds", "power": app_state.power_on, "sense": app_state.sense_on})
                elif not has_devices and app_state.sense_on:
                    app_state.led_sense.off()
                    app_state.sense_on = False
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
    btn_snap = Button(BTN_SNAPSHOT, pull_up=True, bounce_time=0.05)
    btn_mode = Button(BTN_MODE, pull_up=True, bounce_time=0.05)

    def on_snap():
        asyncio.run_coroutine_threadsafe(app_state.broadcast({"type": "snapshot"}), loop)

    def on_mode():
        app_state.mode = (app_state.mode + 1) % 3
        asyncio.run_coroutine_threadsafe(app_state.broadcast({"type": "mode", "mode": app_state.mode}), loop)

    btn_snap.when_pressed = on_snap
    btn_mode.when_pressed = on_mode

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
    setup_gpio(asyncio.get_running_loop())

    app_state.led_power = LED(LED_POWER)
    app_state.led_sense = LED(LED_SENSE)
    app_state.led_power.on()
    app_state.power_on = True

async def on_cleanup(app):
    try:
        app["watcher_task"].cancel()
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
        if app_state.led_power:
            app_state.led_power.off()
    except Exception:
        pass

def main():
    app = web.Application()
    app.router.add_get("/", index)
    app.router.add_get("/mjpeg", mjpeg_handler)
    app.router.add_get("/ws", ws_handler)
    app.router.add_post("/api/upload_snapshot", upload_snapshot)
    app.router.add_get("/{path:.*}", static_files)

    app.on_startup.append(on_startup)
    app.on_cleanup.append(on_cleanup)

    web.run_app(app, host="0.0.0.0", port=HTTP_PORT)

if __name__ == "__main__":
    main()

