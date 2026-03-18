# Architecture

## Overview

ELEN (ELectronic ENtities) is a speculative camera system that reveals invisible wireless presences as ethereal overlays on a live camera feed. It combines Kismet wireless monitoring, a Python backend, and a WebGL-based frontend.

## Pipeline

```
Kismet (Wi-Fi/BT monitor)
    |  REST API (~1 Hz poll)
    v
Reducer (reducer.py)
    |  writes JSON
    v
ghost_state.json
    |  file-watch (0.2s interval)
    v
Backend (server.py)
    |-- /mjpeg     (PiCamera2 MJPEG stream)
    |-- /ws        (WebSocket: state + IMU + battery)
    |-- /api/*     (snapshot upload/list/delete)
    |-- /gallery   (gallery UI)
    |-- /snapshots (snapshot files)
    v
Browser (WebGL @ 60 fps)
```

## Components

### Kismet

- Monitors Wi-Fi and Bluetooth devices on `wlan1` / `hci0`
- Exposes REST API on `http://127.0.0.1:2501`
- Systemd service: `shadow-kismet.service`

### Reducer (`src/reducer/reducer.py`)

- Polls Kismet API at ~1 Hz (configurable via `--interval`)
- Tries multiple Kismet view names for compatibility:
  - **Wi-Fi APs:** `phy80211_accesspoints`, `phydot11_accesspoints`
  - **Wi-Fi All (for clients):** `phy-IEEE802.11`, `phydot11_all`
  - **Bluetooth:** `phy-Bluetooth`, `phybluetooth`, `phy-BTLE`, `phybluetooth_le`, `linuxbluetooth`
- Extracts both **access points** and **client devices** from Wi-Fi data
- Computes packet **burst rate** from Kismet's minute RRD data
- Hashes MAC addresses with a per-install random salt (privacy)
- Computes normalized signal strength: `clamp((dBm + 90) / 60, 0, 1)`
- Outputs `wifi.aps[]`, `wifi.clients[]`, and `bt.devices[]`
- Writes `ghost_state.json` atomically (`.tmp` + `os.replace()`)
- Systemd service: `shadow-reducer.service`

### Backend (`src/backend/server.py`)

- **MJPEG streaming** from PiCamera2 at 1280x720
- **WebSocket server** that broadcasts:
  - `{type: "state", state: {...}}` - ghost state updates (every 0.2s)
  - `{type: "mode", mode: N}` - display mode (0=AP, 1=BT, 2=Both)
  - `{type: "imu", yaw, pitch, roll}` - IMU orientation (50 Hz)
  - `{type: "battery", voltage, soc}` - battery state (every 5s)
  - `{type: "snapshot"}` - snapshot trigger
  - `{type: "gallery_toggle"}` - gallery visibility toggle
  - `{type: "leds", power, sense}` - LED status
- **GPIO integration:**
  - Snapshot button (GPIO 12)
  - Mode/Gallery button (GPIO 26)
  - Power LED (GPIO 20) - on when running
  - Sense LED (GPIO 13) - PWM breathing, speed varies with device count
- **IMU broadcaster:** Reads LSM6DS accelerometer/gyroscope at ~100 Hz, broadcasts complementary-filtered orientation at 50 Hz
- **Battery broadcaster:** Reads MAX17040 fuel gauge every 5 seconds
- **Snapshot API:**
  - `POST /api/upload_snapshot` - upload PNG + optional WebM Live Photo
  - `GET /api/snapshots` - list all snapshots
  - `DELETE /api/snapshots/{name}` - delete a snapshot
  - `GET /snapshots/{name}/{file}` - serve snapshot files
- **Gallery UI:** Served at `/gallery`
- Systemd service: `shadow-backend.service`

### Power Monitor (`scripts/power_monitor.py`)

- Monitors X1201 UPS battery and AC power status
- Reads battery voltage/SOC from MAX17040 fuel gauge (I2C @ 0x36)
- Reads AC power status from GPIO 6 (PLD pin on gpiochip4)
- Writes `state/power_state.json` every 5 seconds
- Systemd service: `shadow-power.service`

### Web Overlay (`src/web/`)

- WebGL-based fluid simulation engine (`atomFluid.js`)
- Receives data via WebSocket:
  - Ghost state (Wi-Fi APs, clients, BT devices)
  - IMU orientation (for 360-degree view navigation)
  - Battery status (displayed as indicator)
- Visual modes: AP only, BT only, Both
- Debug UI (togglable) with signal parameters
- Live Photo recording (3-second buffer)
- Snapshot capture with composite rendering
- Splash screen during initialization

### Gallery (`src/gallery/`)

- Lists all captured snapshots
- Displays still PNG and plays Live Photo WebM
- Delete functionality
- Accessible via mode button (short press)

## Data Flow Frequencies

| Stage | Frequency |
|---|---|
| Kismet poll | ~1 Hz |
| ghost_state.json write | ~1 Hz |
| Backend state watch | every 0.2s |
| WebSocket state push | every 0.2s |
| IMU broadcast | 50 Hz |
| Battery broadcast | every 5s |
| Browser render | 60 fps |

## Hardware Interfaces

### GPIO Pin Assignments

| GPIO | Pin | Function | Direction |
|---|---|---|---|
| 12 | 32 | Snapshot button | Input (pull-up) |
| 26 | 37 | Mode/Gallery button | Input (pull-up) |
| 20 | 38 | Power LED | Output (digital) |
| 13 | 33 | Sense LED | Output (PWM) |
| 6 | - | Power Loss Detection (X1201) | Input (gpiochip4) |
| 16 | - | Charging control (X1201) | Reserved |

### I2C Devices

| Address | Device | Function |
|---|---|---|
| 0x6A | LSM6DS | 6-axis IMU (accel + gyro) |
| 0x36 | MAX17040 | Battery fuel gauge |

## Systemd Services

| Service | Description | User |
|---|---|---|
| `shadow-kismet` | Kismet wireless monitor | root |
| `shadow-reducer` | Kismet -> ghost_state.json | jermarti |
| `shadow-backend` | MJPEG + WebSocket server | jermarti |
| `shadow-power` | Battery/AC power monitor | root |

## Privacy

- MAC addresses are SHA-256 hashed with a per-install random salt before storage
- No raw MACs in `ghost_state.json`
- Salt stored in `state/salt.txt` (auto-generated on first run)
- Kismet capture files are `.gitignore`d
