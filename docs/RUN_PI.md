# Running on the Raspberry Pi

## Prerequisites

- Pi set up per [PI_SETUP.md](PI_SETUP.md)
- Dependencies installed via `scripts/install_pi_deps.sh`
- Services installed via `scripts/install_services.sh`
- `config/shadow.env` created from `config/shadow.env.example`

## Production (auto-start on boot)

After running `scripts/install_services.sh` (see [DEPLOYMENT_PI.md](DEPLOYMENT_PI.md)), everything starts automatically on boot:

1. **systemd** starts `shadow-kismet`, `shadow-reducer`, `shadow-backend`
2. **lxsession** starts the desktop, then launches Chromium via `scripts/kiosk.sh`
3. The kiosk waits for the backend, then opens fullscreen

Check status:

```bash
sudo systemctl status shadow-kismet shadow-reducer shadow-backend
```

Logs:

```bash
journalctl -u shadow-kismet -f
journalctl -u shadow-reducer -f
journalctl -u shadow-backend -f
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
