#!/usr/bin/env python3
"""
Shadow Creatures — Exhibition backend.
Stripped-down server: no camera, no IMU, no battery gauge, no GPIO.
Serves static web files + WebSocket relay for ghost_state.json.
"""
import asyncio
import json
import os
import sys
import time
from typing import Set

from aiohttp import web, WSMsgType

STATE_PATH = os.environ.get("GHOST_STATE_PATH",
             os.path.expanduser("~/shadow_creatures/state/ghost_state.json"))
WEB_DIR = os.environ.get("WEB_DIR",
          os.path.expanduser("~/shadow_creatures/web"))

HTTP_PORT = int(os.environ.get("HTTP_PORT", "8080"))


class AppState:
    def __init__(self):
        self.ws_clients: Set[web.WebSocketResponse] = set()
        self.mode = 2  # 0 AP, 1 BT, 2 both
        self.last_state = {}
        self.last_mtime = 0.0

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

    async for msg in ws:
        if msg.type == WSMsgType.TEXT:
            try:
                data = json.loads(msg.data)
            except Exception:
                continue

            if data.get("type") == "set_mode":
                app_state.mode = int(data.get("mode", 0)) % 3
                await app_state.broadcast({"type": "mode", "mode": app_state.mode})

        elif msg.type == WSMsgType.ERROR:
            break

    app_state.ws_clients.discard(ws)
    return ws


async def state_watcher():
    while True:
        try:
            st = os.stat(STATE_PATH)
            if st.st_mtime != app_state.last_mtime:
                app_state.last_mtime = st.st_mtime
                with open(STATE_PATH, "r", encoding="utf-8") as f:
                    app_state.last_state = json.load(f)
                await app_state.broadcast({"type": "state", "state": app_state.last_state})
        except FileNotFoundError:
            pass
        except Exception as e:
            print(f"state_watcher error: {e}", file=sys.stderr)
        await asyncio.sleep(0.2)


async def on_startup(app):
    app["watcher_task"] = asyncio.create_task(state_watcher())

async def on_cleanup(app):
    try:
        app["watcher_task"].cancel()
    except Exception:
        pass

def main():
    app = web.Application()
    app.router.add_get("/", index)
    app.router.add_get("/ws", ws_handler)

    # Main web app static files (catch-all — must be LAST)
    app.router.add_get("/{path:.*}", static_files)

    app.on_startup.append(on_startup)
    app.on_cleanup.append(on_cleanup)

    web.run_app(app, host="0.0.0.0", port=HTTP_PORT)

if __name__ == "__main__":
    main()

