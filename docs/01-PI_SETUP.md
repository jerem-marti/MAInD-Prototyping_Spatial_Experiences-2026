# Raspberry Pi Setup

## 1. Flash the OS

Install **Raspberry Pi OS Desktop 64-bit (Trixie)** with Raspberry Pi Imager.

In Imager, open **OS Customisation** and set:

- Username and password
- Hostname
- Wi-Fi credentials
- Locale / keyboard
- **Enable SSH**

## 2. Connect the Joy-IT RB-LCD-5 screen before first boot

The panel is **800x480 resistive single-touch** over HDMI.

1. Pi powered off
2. Screen seated on GPIO header
3. HDMI adapter connected (use the adapter matching your Pi generation)
4. Keyboard / mouse connected
5. Power on

## 3. First boot and update

```bash
sudo apt update
sudo apt full-upgrade -y
sudo reboot
```

## 4. Screen check (try with no vendor script first)

Raspberry Pi OS desktop now uses **Wayland/labwc** by default with improved touchscreen support.

Check:
- Does the screen show the desktop?
- Does touch work?
- Does the on-screen keyboard appear on touch?

If yes, stop here. That's the best outcome.

### Fix orientation

Go to **Preferences -> Screen Configuration**, right-click the display, choose **Orientation**.

### Fallback (only if touch/display fails)

```bash
sudo rm -rf LCD-show
git clone https://github.com/goodtft/LCD-show.git
chmod -R 755 LCD-show
cd LCD-show/
sudo ./LCD5-show
```

This reboots automatically. Only use this if the plain desktop install fails -- the vendor script writes X11 calibration files and may conflict with the Wayland default.

## 5. Camera

Test the camera module (Camera Module 3 requires the modern `rpicam` stack):

```bash
rpicam-hello --timeout 5
rpicam-jpeg -o test.jpg
```

If no preview appears, check the ribbon cable and ensure the `video` group membership.

## 6. Network Interfaces

| Interface | Role |
|---|---|
| `wlan0` | Internet / SSH access |
| `wlan1` | Monitor mode (USB Wi-Fi dongle) |
| `hci0` | Bluetooth scanning |

Check with:

```bash
ip link show
hciconfig
```

## 7. Install project dependencies

```bash
sudo apt install -y \
  curl jq tmux wget gpg chromium \
  python3-picamera2 python3-aiohttp python3-requests python3-gpiozero \
  python3-smbus python3-libgpiod python3-jinja2 \
  i2c-tools

sudo usermod -aG video,gpio "$USER" || true
```

Or use the script:

```bash
bash scripts/install_pi_deps.sh
```

## 8. Enable I2C (for IMU and battery gauge)

```bash
sudo raspi-config
```

Interface Options -> **I2C** -> Enable -> reboot.

Verify:

```bash
sudo i2cdetect -y 1
```

Expected addresses:
- `0x6A` - LSM6DS IMU (accelerometer/gyroscope)
- `0x36` - MAX17040 battery fuel gauge (on X1201 UPS)

## 9. X1201 UPS Power Management

### EEPROM configuration (one-time)

```bash
sudo rpi-eeprom-config -e
```

Set / add the following values, then save and reboot:

```
POWER_OFF_ON_HALT=1
PSU_MAX_CURRENT=5000
```

- `POWER_OFF_ON_HALT=1` — Pi cuts the 5V rail after `shutdown -h now`. The X1201 detects this and enters ultra-low-power standby, cutting power to everything.
- `PSU_MAX_CURRENT=5000` — suppresses the "not capable of supplying 5A" warning.

### Disable the shutdown dialog (power button)

The X1201 has a physical button that behaves like the Pi 5 power button. By default, a single press opens a "Shutdown Options" dialog on the desktop. Two layers intercept this event:

**1. labwc (Wayland compositor)** — grabs `XF86PowerOff` before logind sees it:

```bash
mkdir -p ~/.config/labwc
cp /etc/xdg/labwc/rc.xml ~/.config/labwc/rc.xml
sed -i '/<keybind key="XF86PowerOff"/,/<\/keybind>/d' ~/.config/labwc/rc.xml
labwc --reconfigure 2>/dev/null || true
```

**2. systemd-logind** — fallback handler:

```bash
sudo nano /etc/systemd/logind.conf
```

Set:

```ini
HandlePowerKey=ignore
```

Then:

```bash
sudo systemctl restart systemd-logind
```

> Both are done automatically by `scripts/install_services.sh`.

### Install gpiod (for power loss detection)

```bash
sudo apt install -y python3-libgpiod
```

### GPIO pin map (X1201)

| GPIO | Function | Direction |
|---|---|---|
| 6 | Power Loss Detection (PLD) | Input — 1 = AC on, 0 = AC lost |
| 16 | Charging control | Output — `dl` = charge, `dh` = stop |

### Power monitor service

The `shadow-power` systemd service monitors battery level and AC power status.
It writes `state/power_state.json` every 5 seconds with:

```json
{"voltage": 3.934, "soc": 66.4, "ac": true, "charging": true, "ts": 1710085767.0}
```

The backend reads battery data directly via I2C and broadcasts it over WebSocket.

Installed by `scripts/install_services.sh`. Logs:

```bash
journalctl -u shadow-power -f
```

## 10. Install Kismet (Trixie)

Kismet provides official **Debian Trixie arm64** packages:

```bash
sudo apt install -y wget gpg
sudo rm -f /usr/share/keyrings/kismet-archive-keyring.gpg

wget -O - https://www.kismetwireless.net/repos/kismet-release.gpg.key --quiet \
  | gpg --dearmor | sudo tee /usr/share/keyrings/kismet-archive-keyring.gpg >/dev/null

echo 'deb [signed-by=/usr/share/keyrings/kismet-archive-keyring.gpg] https://www.kismetwireless.net/repos/apt/release/trixie trixie main' \
  | sudo tee /etc/apt/sources.list.d/kismet.list >/dev/null

sudo apt update
sudo apt install -y kismet
```

### Configure Kismet

Create the local config (overrides survive upgrades):

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

### Test Kismet

Known-good command (fixed channel 11, USB Wi-Fi + Bluetooth):

```bash
sudo kismet --no-ncurses \
  -c 'wlan1:type=linuxwifi,name=wifiusb,channel_hop=false,channel=11' \
  -c 'hci0:type=linuxbluetooth,name=bt0'
```

In another terminal:

```bash
curl -sS --user 'shadow:change-this-now' \
  'http://127.0.0.1:2501/devices/views/phydot11_accesspoints/last-time/-60/devices.prettyjson' | jq .
```

## 11. Environment Config

```bash
cp config/shadow.env.example config/shadow.env
nano config/shadow.env
```

Set the Kismet password and verify paths. See `shadow.env.example` for all available options.

## 12. GPIO (buttons + LEDs + IMU)

### Buttons

Each button is wired between a GPIO and GND (internal pull-ups, no resistor needed):

| Button | GPIO | Physical Pin | GND Pin | Function |
|---|---|---|---|---|
| Snapshot | 12 | pin 32 | pin 30/34 | Capture snapshot + Live Photo |
| Mode | 26 | pin 37 | pin 34/39 | Short: gallery; Long (5s): debug |

### LEDs

Both LEDs use GPIOs with default pull-down so they go LOW cleanly when the Pi cuts power (POWER_OFF_ON_HALT=1).

| LED | Type | GPIO | Physical Pin | Behavior |
|---|---|---|---|---|
| Power | Digital (on/off) | 20 | pin 38 | On when backend running |
| Sense | PWM (breathing) | 13 | pin 33 | Speed varies with device count |

> **Reserved by X1201 power shield:**
> - GPIO 6 — Power Loss Detection (PLD input). Do **not** use for LEDs or buttons.
> - GPIO 16 — Charging control (output). Do **not** use for LEDs or buttons.

### Grove 6-axis IMU (I2C @ 0x6A)

Wired in parallel on the LCD header:

- **SDA** -> GPIO2 / pin 3
- **SCL** -> GPIO3 / pin 5
- **3V3** -> pin 1 or 17
- **GND** -> any GND pin

IMU must be **3.3V**, not 5V.

Test the IMU:

```bash
python3 scripts/test/test_lsm6ds_read.py
```

## Troubleshooting

### "AP=0" (no access points detected)

- Check that `wlan1` is in monitor mode: `iw dev`
- Try a different channel in the Kismet `-c` flag
- Verify the USB Wi-Fi dongle is connected: `lsusb`
- Make sure Kismet is actually running: `ps aux | grep kismet`

### Reducer not producing output

- Check Kismet API: `curl -sS --user 'shadow:yourpass' http://127.0.0.1:2501/system/status.json`
- Verify the output path matches `--out` argument
- Check file permissions on the state directory

### Camera not working

- `rpicam-hello` should show a preview
- Check ribbon cable
- Ensure user is in `video` group: `groups $USER`

See also [06-TROUBLESHOOTING.md](06-TROUBLESHOOTING.md) for more.
