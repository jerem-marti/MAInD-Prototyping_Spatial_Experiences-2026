# ELEN - ELectronic ENtities

> A speculative camera that reveals invisible wireless presences (Wi-Fi networks, Bluetooth devices) as ethereal visual overlays on a live video feed.

---

## Course Info

| Field | Details |
|---|---|
| Group | Jérémy Martin, Nerea Asensio, Nicholas Vos |
| School | SUPSI - Master of Arts in Interaction Design |
| Course | ID212.01 Prototyping Spatial Experiences |

## Brief

This course explores the technological potential of contemporary camera systems as interactive, computational devices. Framed as a speculative fiction project, students design and prototype "magical cameras" that extend human perception beyond its natural limits.

Through the creation or hacking of physical objects, students combine sensors, computer vision, and machine-learning tools to build responsive systems that detect, interpret, and visualise data invisible to the human eye.

## Architecture

```
Kismet (Wi-Fi + BT monitor)
    |  REST API (~1 Hz poll)
    v
Reducer  -->  ghost_state.json
                    |
                    v
Backend (PiCamera2 MJPEG + WebSocket)
    |-- /mjpeg      (camera stream)
    |-- /ws         (state + IMU + battery)
    |-- /gallery    (snapshot gallery)
    v
Browser (WebGL fluid overlay @ 60 fps)
```

See [docs/02-ARCHITECTURE.md](docs/02-ARCHITECTURE.md) for details.

## Quick Start (Raspberry Pi)

```bash
# 1. Install dependencies
bash scripts/install_pi_deps.sh

# 2. Copy and edit environment config
cp config/shadow.env.example config/shadow.env
nano config/shadow.env

# 3. Install systemd services
bash scripts/install_services.sh

# 4. Reboot (services start automatically)
sudo reboot
```

Or for development with tmux: `bash scripts/run_dev_tmux.sh`

See [docs/05-RUN_PI.md](docs/05-RUN_PI.md) for full instructions.

## Documentation

| Doc | Description |
|---|---|
| [ARCHITECTURE.md](docs/02-ARCHITECTURE.md) | System design, pipeline, data flow |
| [RUN_PI.md](docs/05-RUN_PI.md) | How to run everything on the Pi |
| [PI_SETUP.md](docs/01-PI_SETUP.md) | Raspberry Pi setup from scratch |
| [DEPLOYMENT_PI.md](docs/04-DEPLOYMENT_PI.md) | ArchiDep auto-deploy (git hook + systemd) |
| [DATA_CONTRACT.md](docs/03-DATA_CONTRACT.md) | ghost_state.json schema |
| [TROUBLESHOOTING.md](docs/06-TROUBLESHOOTING.md) | Common issues and fixes |

## Repository Structure

```
src/
  backend/server.py        # MJPEG stream + WebSocket + IMU + battery
  reducer/reducer.py       # Kismet API -> ghost_state.json
  web/                     # Main overlay app (WebGL fluid simulation)
  gallery/                 # Snapshot gallery UI
config/
  shadow.env.example       # Environment template (no secrets)
systemd/                   # systemd unit files for Pi
scripts/
  install_pi_deps.sh       # Apt dependencies
  install_services.sh      # Install all systemd services + kiosk
  kiosk.sh                 # Chromium kiosk launcher
  run_dev_tmux.sh          # Dev launcher (tmux)
  power_monitor.py         # X1201 UPS battery/AC monitor
  deploy/                  # ArchiDep post-receive hook
  test/                    # Hardware test scripts (buttons, LEDs, IMU)
samples/
  ghost_state.sample.json  # Example state file
state/                     # Runtime state (ghost_state.json, snapshots)
assets/
  README.md                # External media links + conventions
docs/                      # Project documentation
```

## Deploy to Pi

```bash
git remote add pi jermarti@PI_IP:/home/jermarti/maind-deploy-repo
git push pi main
```

See [docs/04-DEPLOYMENT_PI.md](docs/04-DEPLOYMENT_PI.md) for full setup.

## Key Features

- **Wi-Fi + Bluetooth detection** via Kismet (APs, clients, BLE devices)
- **WebGL fluid simulation** overlaid on live camera feed
- **IMU integration** (LSM6DS gyroscope/accelerometer) for 360-degree view navigation
- **Battery monitoring** (MAX17040 fuel gauge) with on-screen indicator
- **Live Photo capture** (still PNG + 3-second WebM video loop)
- **Snapshot gallery** with delete functionality
- **Kiosk mode** for standalone installation

## License

Academic project - SUPSI MAIND 2025-2026.
