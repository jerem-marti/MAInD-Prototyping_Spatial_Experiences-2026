# Architecture

## Overview

Shadow Creatures is a speculative camera system that reveals invisible wireless presences as ghost-like overlays on a live camera feed.

## Pipeline

```
Kismet (Wi-Fi/BT monitor)
    |  REST API (1 Hz poll)
    v
Reducer (reducer.py)
    |  writes JSON
    v
ghost_state.json
    |  file-watch + WebSocket push (0.2 s)
    v
Backend (server.py)  ---->  /mjpeg  (PiCamera2 stream)
    |                ---->  /ws     (ghost state updates)
    v
Browser overlay (app.js @ 60 fps)
```

## Components

### Kismet
- Monitors Wi-Fi and Bluetooth devices on `wlan1` / `hci0`
- Exposes REST API on `http://127.0.0.1:2501`

### Reducer (`src/reducer/reducer.py`)
- Polls Kismet API at ~1 Hz (configurable via `--interval`)
- Tries multiple Kismet view names for Wi-Fi (`phy80211_accesspoints`, `phydot11_accesspoints`) and BT (`phybluetooth`, `phybluetooth_le`, `linuxbluetooth`)
- Hashes MAC addresses with a per-install random salt (privacy)
- Computes normalized signal strength: `clamp((dBm + 90) / 60, 0, 1)`
- Outputs two separate arrays: `wifi.aps[]` and `bt.devices[]`
- Writes `ghost_state.json` atomically (`.tmp` + `os.replace()`)

### Backend (`src/backend/server.py`)
- Serves MJPEG stream from PiCamera2
- Watches `ghost_state.json` for changes
- Pushes state updates via WebSocket (every 0.2 s)
- Serves static web files

### Web Overlay (`src/web/`)
- Receives ghost state via WebSocket
- Wi-Fi APs rendered as fog circles (up to 25), BT devices as spark particles (up to 40)
- Three modes: AP fog (0), BT sparks (1), Both (2)
- Button controls: snapshot (GPIO 17), mode switch (GPIO 27)
- Snapshot captures camera + overlay composited as PNG, uploaded to backend

## Data Flow Frequencies

| Stage | Frequency |
|---|---|
| Kismet poll | ~1 Hz |
| ghost_state write | ~1 Hz |
| WebSocket push | every 0.2 s |
| Browser render | 60 fps |

## Privacy

- MAC addresses are SHA-256 hashed with a per-install random salt before storage
- No raw MACs in `ghost_state.json`
- Salt stored in `state/salt.txt` (auto-generated on first run)
- Kismet capture files are `.gitignore`d
