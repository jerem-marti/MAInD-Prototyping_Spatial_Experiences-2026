#!/usr/bin/env python3
import asyncio
import base64
import io
import json
import os
import shutil
import signal
import sys
import time
from typing import Optional, Set

from aiohttp import web, WSMsgType

STATE_PATH = os.environ.get("GHOST_STATE_PATH",
             os.path.expanduser("~/shadow_creatures/state/ghost_state.json"))
SNAP_DIR = os.environ.get("SNAP_DIR",
           os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'state', 'snapshots'))
WEB_DIR = os.environ.get("WEB_DIR",
          os.path.expanduser("~/shadow_creatures/web"))
GALLERY_DIR = os.environ.get("GALLERY_DIR",
              os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'gallery'))

HTTP_PORT = int(os.environ.get("HTTP_PORT", "8080"))


class AppState:
    def __init__(self):
        self.ws_clients: Set[web.WebSocketResponse] = set()
        self.mode = 0  # 0 AP, 1 BT, 2 both
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
    os.makedirs(SNAP_DIR, exist_ok=True)
    app["watcher_task"] = asyncio.create_task(state_watcher())

async def on_cleanup(app):
    try:
        app["watcher_task"].cancel()
    except Exception:
        pass

def main():
    app = web.Application(client_max_size=10 * 1024 * 1024)  # 10 MB for Live Photo uploads
    app.router.add_get("/", index)
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
