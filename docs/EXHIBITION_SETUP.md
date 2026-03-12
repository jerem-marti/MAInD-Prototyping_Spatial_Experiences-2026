# Exhibition Setup Guide — Raspberry Pi 5

Fresh install guide for deploying the ELEN exhibition branch on a new Raspberry Pi 5.

## Hardware

| Component | Details |
|---|---|
| Raspberry Pi 5 | Powered via USB-C (no battery/UPS) |
| USB Wi-Fi dongle | Monitor mode capable (same as main branch) |
| Bluetooth | Built-in `hci0` |
| Display output | HDMI to Panasonic PT-VMZ60 projector (WUXGA 1920x1200, 16:10) |
| No camera | No PiCamera module needed |
| No GPIO | No buttons, LEDs, IMU, or power shield |

## 1. Flash the OS

Install **Raspberry Pi OS Desktop 64-bit (Bookworm or Trixie)** with Raspberry Pi Imager.

In Imager, open **OS Customisation** and set:

- **Username**: `jermarti` (or your preferred username — update paths below accordingly)
- **Password**: your choice
- **Hostname**: `shadow-exhibition` (or your preference)
- **Wi-Fi credentials**: for SSH access during setup
- **Locale / keyboard**: your locale
- **Enable SSH**: yes

## 2. First boot and update

Connect keyboard, mouse, and HDMI to the projector (or a monitor for setup).

```bash
sudo apt update
sudo apt full-upgrade -y
sudo reboot
```

## 3. Display / projector check

After reboot, verify the Pi desktop appears on the projector at 1920x1200.

If the resolution is wrong:

```bash
# Check current resolution
xrandr
# Or on Wayland:
wlr-randr
```

Go to **Preferences -> Screen Configuration** and set the output to 1920x1200 if needed.

### Force resolution via config.txt (if auto-detect fails)

```bash
sudo nano /boot/firmware/config.txt
```

Add under `[all]`:

```ini
hdmi_group=2
hdmi_mode=89
# mode 89 = 1920x1200 @ 60Hz
```

Reboot and verify.

## 4. Install system dependencies

```bash
sudo apt update
sudo apt install -y \
  git curl jq tmux wget gpg \
  python3-aiohttp python3-requests \
  chromium
```

Note: compared to the main branch, you do **not** need `python3-picamera2`, `python3-gpiozero`, `python3-smbus`, `python3-libgpiod`, or `i2c-tools`.

## 5. Install Kismet

Kismet scans Wi-Fi and Bluetooth devices. Follow the official Debian packages.

### Add the Kismet repository

```bash
sudo apt install -y wget gpg
sudo rm -f /usr/share/keyrings/kismet-archive-keyring.gpg

wget -O - https://www.kismetwireless.net/repos/kismet-release.gpg.key --quiet \
  | gpg --dearmor | sudo tee /usr/share/keyrings/kismet-archive-keyring.gpg >/dev/null
```

For **Trixie**:
```bash
echo 'deb [signed-by=/usr/share/keyrings/kismet-archive-keyring.gpg] https://www.kismetwireless.net/repos/apt/release/trixie trixie main' \
  | sudo tee /etc/apt/sources.list.d/kismet.list >/dev/null
```

For **Bookworm**:
```bash
echo 'deb [signed-by=/usr/share/keyrings/kismet-archive-keyring.gpg] https://www.kismetwireless.net/repos/apt/release/bookworm bookworm main' \
  | sudo tee /etc/apt/sources.list.d/kismet.list >/dev/null
```

Then:

```bash
sudo apt update
sudo apt install -y kismet
```

### Configure Kismet

```bash
sudo mkdir -p /etc/kismet
sudo nano /etc/kismet/kismet_site.conf
```

Contents:

```conf
httpd_bind_address=127.0.0.1
httpd_port=2501
httpd_username=shadow
httpd_password=change-this-now
```

Replace `change-this-now` with a real password. You'll use the same password in `shadow.env`.

### Test Kismet

Plug in the USB Wi-Fi dongle, then:

```bash
sudo kismet --no-ncurses \
  -c 'wlan1:type=linuxwifi,name=wifiusb,channel_hop=false,channel=11' \
  -c 'hci0:type=linuxbluetooth,name=bt0'
```

In another terminal, verify devices are detected:

```bash
curl -sS --user 'shadow:change-this-now' \
  'http://127.0.0.1:2501/devices/views/phydot11_accesspoints/last-time/-60/devices.prettyjson' | jq length
```

You should see a number > 0 if there are Wi-Fi networks nearby. Press `Ctrl+C` to stop the test.

## 6. Clone and configure the project

```bash
cd ~
git clone <your-repo-url> shadow-creatures
cd shadow-creatures
git checkout exhibition
```

Or if deploying from a bare repo:

```bash
mkdir -p ~/shadow-creatures
cd ~/shadow-creatures
git init
git remote add origin <your-repo-url>
git fetch origin
git checkout exhibition
```

### Create the environment config

```bash
cp config/shadow.env.example config/shadow.env
nano config/shadow.env
```

Update the paths and Kismet password:

```env
KISMET_URL=http://127.0.0.1:2501
KISMET_USER=shadow
KISMET_PASS=your-actual-kismet-password

GHOST_STATE_PATH=/home/jermarti/shadow-creatures/state/ghost_state.json
SALT_FILE=/home/jermarti/shadow-creatures/state/salt.txt
WEB_DIR=/home/jermarti/shadow-creatures/src/web

HTTP_PORT=8080
```

Replace `jermarti` with your actual username if different.

### Create the state directory

```bash
mkdir -p ~/shadow-creatures/state
```

## 7. Test manually before installing services

Open a tmux session to run all components:

```bash
cd ~/shadow-creatures
bash scripts/run_dev_tmux.sh
```

This starts Kismet, the reducer, and the backend in separate tmux panes. Wait ~10 seconds for everything to initialize, then open a browser on the Pi:

```bash
chromium http://localhost:8080
```

You should see:
- Dark background
- Blobs appearing as devices are detected
- Signal count updating in the status bar

Press `Ctrl+C` in each tmux pane to stop, or `tmux kill-session -t shadow`.

## 8. Install systemd services and kiosk

The install script sets up all services and configures the kiosk autostart.

**Before running**, edit the service files to match your username and deploy path:

```bash
cd ~/shadow-creatures

# Update username and paths in service files
USERNAME=$(whoami)
DEPLOY_DIR=$(pwd)

sed -i "s|User=jermarti|User=$USERNAME|g" systemd/shadow-backend.service systemd/shadow-reducer.service
sed -i "s|/home/jermarti/maind-deploy|$DEPLOY_DIR|g" systemd/shadow-backend.service systemd/shadow-reducer.service
```

Then run the installer:

```bash
bash scripts/install_services.sh
```

This will:
- Install and enable `shadow-kismet`, `shadow-reducer`, `shadow-backend` as systemd services
- Install `shadow-power` (but it will fail to start since there's no UPS hardware — this is fine)
- Set up Chromium kiosk autostart
- Hide the desktop panel, wallpaper, and mouse cursor
- Set boot splash to black

### Disable the power monitor service (not needed)

```bash
sudo systemctl disable shadow-power
sudo systemctl stop shadow-power
```

### Reboot and verify

```bash
sudo reboot
```

After reboot, the Pi should:
1. Boot to a black screen
2. Start Kismet, reducer, and backend automatically
3. Launch Chromium in kiosk mode pointing to `http://localhost:8080`
4. Show the ELEN splash screen, then the blob visualization

## 9. Verify everything works

### Check services

```bash
sudo systemctl status shadow-kismet
sudo systemctl status shadow-reducer
sudo systemctl status shadow-backend
```

All three should show `active (running)`.

### Check logs

```bash
# Kismet
journalctl -u shadow-kismet -f

# Reducer
journalctl -u shadow-reducer -f

# Backend
journalctl -u shadow-backend -f
```

### Check the ghost_state.json is being written

```bash
cat ~/shadow-creatures/state/ghost_state.json | jq '.telemetry'
```

You should see device counts updating.

### Debug mode

Press `D` on a connected keyboard to toggle the debug HUD overlay (shows FPS, device counts, signal details). Press `B` to toggle blob debug mode (hyper-visible blobs for testing).

## 10. Exhibition day checklist

- [ ] Pi powered via USB-C
- [ ] USB Wi-Fi dongle plugged in
- [ ] HDMI connected to projector
- [ ] Projector set to correct HDMI input, 1920x1200
- [ ] Pi boots to black screen, then ELEN splash, then blobs
- [ ] Blobs appear within ~15 seconds of boot
- [ ] No visible OS interface (no taskbar, no cursor, no desktop)
- [ ] SSH accessible via `wlan0` for remote troubleshooting

## Troubleshooting

### No blobs visible

1. Check Kismet is running: `sudo systemctl status shadow-kismet`
2. Check reducer output: `cat ~/shadow-creatures/state/ghost_state.json | jq '.telemetry.total_count'`
3. If `total_count` is 0, Kismet isn't detecting devices — check `wlan1` and `hci0`:
   ```bash
   ip link show
   iw dev
   hciconfig
   ```
4. Check backend is serving: `curl -s http://localhost:8080 | head -5`

### Black screen after boot (no blobs, no splash)

1. Check if Chromium is running: `ps aux | grep chromium`
2. Check backend: `sudo systemctl status shadow-backend`
3. Try manually: `chromium --app=http://localhost:8080 --start-fullscreen`

### Wrong resolution on projector

```bash
# Check what the Pi detects
xrandr
# Force 1920x1200 if needed — see step 3
```

### Services fail to start after path changes

If you moved the project or renamed the user, re-run:

```bash
cd ~/shadow-creatures
bash scripts/install_services.sh
```

### Remote access while exhibition is running

SSH in via the Pi's `wlan0` IP:

```bash
ssh jermarti@<pi-ip-address>
```

To restart everything:

```bash
sudo systemctl restart shadow-kismet shadow-reducer shadow-backend
pkill -f 'chromium.*--kiosk'
sleep 2
bash ~/shadow-creatures/scripts/kiosk.sh &
```
