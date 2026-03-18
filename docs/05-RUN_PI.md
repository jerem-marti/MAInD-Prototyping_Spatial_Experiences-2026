# Running on the Raspberry Pi

## Prerequisites

- Pi set up per [01-PI_SETUP.md](01-PI_SETUP.md)
- Dependencies installed via `scripts/install_pi_deps.sh`
- Services installed via `scripts/install_services.sh`
- `config/shadow.env` created from `config/shadow.env.example`

## Production (auto-start on boot)

After running `scripts/install_services.sh` (see [04-DEPLOYMENT_PI.md](04-DEPLOYMENT_PI.md)), everything starts automatically on boot:

1. **systemd** starts `shadow-kismet`, `shadow-reducer`, `shadow-backend`, `shadow-power`
2. **lxsession** starts the desktop, then launches Chromium via `scripts/kiosk.sh`
3. The kiosk waits for the backend, then opens fullscreen

Check status:

```bash
sudo systemctl status shadow-kismet shadow-reducer shadow-backend shadow-power
```

Logs:

```bash
journalctl -u shadow-kismet -f
journalctl -u shadow-reducer -f
journalctl -u shadow-backend -f
journalctl -u shadow-power -f
```

Restart everything (including the kiosk browser):

```bash
bash scripts/deploy/restart_services.sh
```

## Quick Start (manual)

### 1. Start Kismet

Known-good command (fixed channel 11, USB Wi-Fi + Bluetooth):

```bash
sudo kismet --no-ncurses \
  -c 'wlan1:type=linuxwifi,name=wifiusb,channel_hop=false,channel=11' \
  -c 'hci0:type=linuxbluetooth,name=bt0'
```

Verify Kismet is running:

```bash
curl -sS --user 'shadow:yourpass' http://127.0.0.1:2501/system/status.json | jq .
```

### 2. Start the Reducer

```bash
python3 src/reducer/reducer.py
```

Check that `ghost_state.json` is being written:

```bash
watch -n1 cat state/ghost_state.json
```

### 3. Start the Backend

```bash
python3 src/backend/server.py
```

The backend provides:
- MJPEG camera stream at `/mjpeg`
- WebSocket at `/ws` for state, IMU, and battery updates
- Gallery UI at `/gallery`
- Snapshot API at `/api/snapshots`

### 4. Open the Overlay

```bash
bash scripts/kiosk.sh
```

The script waits for the backend to respond, sets `DISPLAY=:0` if needed, and launches Chromium in fullscreen kiosk mode.

> **Note:** `--disable-gpu-video-decode` (included in the script) prevents an intermittent GPU crash (`SharedImageBackingFactory` / `GPU state invalid`) that kills WebGL contexts on the Pi's VideoCore GPU.

## Quick Start (tmux)

```bash
bash scripts/run_dev_tmux.sh
```

This opens a tmux session with three panes: Kismet, Reducer, Backend. Then launch the kiosk separately:

```bash
bash scripts/kiosk.sh
```

## Hardware Features

### IMU (Gyroscope/Accelerometer)

The backend automatically detects and reads the LSM6DS IMU at I2C address `0x6A`. Orientation data (yaw, pitch, roll) is broadcast over WebSocket at 50 Hz.

Test the IMU:

```bash
python3 scripts/test/test_lsm6ds_read.py
```

### Battery Monitor

The backend reads the MAX17040 fuel gauge at I2C address `0x36` and broadcasts voltage/SOC over WebSocket every 5 seconds. The battery indicator appears in the top-right of the overlay.

### GPIO Buttons and LEDs

| Component | GPIO | Function |
|---|---|---|
| Snapshot button | 12 | Captures snapshot (still + Live Photo) |
| Mode/Gallery button | 26 | Short press: toggle gallery; 5s hold: toggle debug |
| Power LED | 20 | On when backend is running |
| Sense LED | 13 | PWM breathing, speed varies with device count |

Test buttons:

```bash
python3 scripts/test/test_buttons.py
```

Test LEDs (stop backend first):

```bash
sudo systemctl stop shadow-backend
python3 scripts/test/test_leds.py
```

## Snapshot Gallery

Snapshots are saved to `state/snapshots/` with:
- `still.png` - composite image (camera + overlay)
- `live.webm` - 3-second video loop (if Live Photo enabled)
- `state.json` - ghost state at capture time

Access the gallery:
- Press the mode button (GPIO 26) on the device
- Or navigate to `http://PI_IP:8080/gallery`
