# Shadow Creatures — Prototyping Spatial Experiences

> A speculative camera that reveals the invisible wireless presences around you as ghost-like creatures overlaid on a live video feed.

---

## Course Info

| Field | Details |
|---|---|
| Group | Jérémy Martin — Nerea Asensio — Nicholas Vos |
| School | SUPSI — Master of Arts in Interaction Design |
| Course | ID212.01 Prototyping Spatial Experiences |

## Brief

This course explores the technological potential of contemporary camera systems as interactive, computational devices. Framed as a speculative fiction project, students design and prototype "magical cameras" that extend human perception beyond its natural limits.

Through the creation or hacking of physical objects, students combine sensors, computer vision, and machine-learning tools to build responsive systems that detect, interpret, and visualise data invisible to the human eye.

## Architecture

```
Kismet (Wi-Fi + BT monitor)
    |  REST API (1 Hz)
    v
Reducer  -->  ghost_state.json
                    |
                    v
Backend (PiCamera2 MJPEG + WebSocket)
                    |
                    v
Browser overlay (HTML5 Canvas @ 60 fps)
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for details.

## Quick Start (Raspberry Pi)

```bash
# 1. Install dependencies
bash scripts/install_pi_deps.sh

# 2. Copy and edit environment config
cp config/shadow.env.example config/shadow.env
nano config/shadow.env

# 3. Start Kismet
sudo kismet --no-ncurses \
  -c 'wlan1:type=linuxwifi,name=wifiusb,channel_hop=false,channel=11' \
  -c 'hci0:type=linuxbluetooth,name=bt0'

# 4. Start Reducer + Backend
python3 src/reducer/reducer.py &
python3 src/backend/server.py &

# 5. Open browser
chromium http://localhost:8080
```

Or use the tmux helper: `bash scripts/run_dev_tmux.sh`

See [docs/RUN_PI.md](docs/RUN_PI.md) for full instructions.

## Documentation

| Doc | Description |
|---|---|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design, pipeline, data flow |
| [RUN_PI.md](docs/RUN_PI.md) | How to run everything on the Pi |
| [PI_SETUP.md](docs/PI_SETUP.md) | Raspberry Pi setup from scratch |
| [DEPLOYMENT_PI.md](docs/DEPLOYMENT_PI.md) | ArchiDep auto-deploy (git hook + systemd) |
| [DATA_CONTRACT.md](docs/DATA_CONTRACT.md) | ghost_state.json schema |
| [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | Common issues and fixes |

## Repository Structure

```
src/
  backend/server.py        # MJPEG stream + WebSocket server
  reducer/reducer.py       # Kismet API -> ghost_state.json
  web/                     # HTML/CSS/JS overlay
config/
  shadow.env.example       # Environment template (no secrets)
systemd/                   # systemd unit files for Pi
scripts/
  install_pi_deps.sh       # Apt dependencies
  run_dev_tmux.sh          # Dev launcher (tmux)
  deploy/                  # ArchiDep post-receive hook
samples/
  ghost_state.sample.json  # Example state file
assets/
  README.md                # External media links + conventions
docs/                      # Project documentation
```

## Deploy to Pi

```bash
git remote add pi jermarti@PI_IP:/home/jermarti/maind-deploy-repo
git push pi main
```

See [docs/DEPLOYMENT_PI.md](docs/DEPLOYMENT_PI.md) for full setup.

## License

Academic project — SUPSI MAIND 2025-2026.
