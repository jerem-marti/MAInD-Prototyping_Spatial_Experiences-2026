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
  git curl jq tmux wget gpg \
  python3-picamera2 python3-aiohttp python3-requests python3-gpiozero \
  python3-smbus python3-jinja2 \
  i2c-tools

sudo usermod -aG video,gpio "$USER" || true
```

Or use the script:

```bash
bash scripts/install_pi_deps.sh
```

## 8. Enable I2C (for Grove IMU)

```bash
sudo raspi-config
```

Interface Options -> **I2C** -> Enable -> reboot.

Verify:

```bash
sudo i2cdetect -y 1
```

Expected addresses: `0x6A` (IMU), `0x36` (power shield fuel gauge).

## 9. Install Kismet (Trixie)

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

## 10. Environment Config

```bash
cp config/shadow.env.example config/shadow.env
nano config/shadow.env
```

Set the Kismet password and verify paths.

## 11. GPIO (buttons + IMU)

### Buttons

Each button is wired between a GPIO and GND (internal pull-ups, no resistor needed):

| Button | GPIO | Physical Pin | GND Pin |
|---|---|---|---|
| Snapshot | 17 | pin 11 | pin 9/14 |
| Mode | 27 | pin 13 | pin 14/9 |

> **Note:** If using a power shield on GPIO16, avoid GPIO16 for buttons (~0.8V idle). GPIO12 (pin 32) and GPIO26 (pin 37) are safe alternatives.

### Grove 6-axis IMU (I2C @ 0x6A)

Wired in parallel on the LCD header:

- **SDA** -> GPIO2 / pin 3
- **SCL** -> GPIO3 / pin 5
- **3V3** -> pin 1 or 17
- **GND** -> any GND pin

IMU must be **3.3V**, not 5V.

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

See also [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for more.
