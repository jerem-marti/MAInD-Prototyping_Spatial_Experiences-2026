# Running on the Raspberry Pi

## Prerequisites

- Pi set up per [PI_SETUP.md](PI_SETUP.md)
- Dependencies installed via `scripts/install_pi_deps.sh`
- `config/shadow.env` created from `config/shadow.env.example`

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

Check that `ghost_state.json` is being written (path depends on your setup -- default `~/shadow_creatures/state/`, or `$GHOST_STATE_PATH` from env):

```bash
watch -n1 cat ~/shadow_creatures/state/ghost_state.json
```

### 3. Start the Backend

```bash
python3 src/backend/server.py
```

### 4. Open the Overlay

Open Chromium on the Pi (or any device on the same network):

```
http://localhost:8080
```

## Quick Start (tmux)

```bash
bash scripts/run_dev_tmux.sh
```

This opens a tmux session with three panes: Kismet, Reducer, Backend.

## Systemd (production)

If systemd services are installed (see [DEPLOYMENT_PI.md](DEPLOYMENT_PI.md)):

```bash
sudo systemctl start shadow-reducer
sudo systemctl start shadow-backend
```

Check status:

```bash
sudo systemctl status shadow-reducer
sudo systemctl status shadow-backend
```

Logs:

```bash
journalctl -u shadow-backend -f
journalctl -u shadow-reducer -f
```
