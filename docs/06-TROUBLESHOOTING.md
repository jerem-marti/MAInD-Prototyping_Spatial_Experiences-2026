# Troubleshooting

## Kismet

### Kismet won't start
- Check that no other instance is running: `sudo killall kismet`
- Verify `wlan1` exists: `ip link show`
- Check permissions: Kismet needs root or suid

### AP count = 0
- `wlan1` might not support monitor mode. Check with `iw phy phy1 info | grep monitor`
- Try a different Wi-Fi channel in `kismet_site.conf`
- Verify the USB Wi-Fi dongle is connected: `lsusb`

### Kismet API unreachable
- Default: `http://127.0.0.1:2501`
- Check if Kismet is listening: `ss -tlnp | grep 2501`

## Reducer

### ghost_state.json not updating
- Is the reducer running? `ps aux | grep reducer`
- Check Kismet credentials in `config/shadow.env`
- Check `GHOST_STATE_PATH` is correct and writable
- Look at reducer output for errors

### ghost_state.json is empty or malformed
- Kismet might not have detected any devices yet (wait ~30s)
- Check that `KISMET_URL` is correct

### No Wi-Fi clients showing
- The reducer fetches clients from a separate Kismet view (`phy-IEEE802.11` or `phydot11_all`)
- Some Kismet installations may not have these views available
- Check reducer logs for "wifi_all_view_used" in the output

## Backend

### MJPEG stream not showing
- Test camera: `rpicam-hello`
- Ensure user is in `video` group: `groups $USER`
- Check backend logs: `journalctl -u shadow-backend -f`

### WebSocket not connecting
- Check browser console for errors
- Verify backend is running on the expected port (`HTTP_PORT` in `.env`)
- Firewall: `sudo ufw status` (if active, allow the port)

### Port already in use
- Find what's using it: `ss -tlnp | grep 8080`
- Kill the process or change `HTTP_PORT` in `config/shadow.env`

### IMU not broadcasting
- Check I2C is enabled: `sudo raspi-config` -> Interface Options -> I2C
- Verify IMU detected: `sudo i2cdetect -y 1` (expect `0x6A`)
- Test IMU directly: `python3 scripts/test/test_lsm6ds_read.py`
- Check backend logs for `[IMU]` messages

### Battery not showing
- Check fuel gauge detected: `sudo i2cdetect -y 1` (expect `0x36`)
- Check backend logs for `[BAT]` messages
- Ensure X1201 UPS is properly seated on GPIO header

## Web Overlay

### Black screen when signals appear (intermittent)
- Check Chromium console / stderr for `SharedImageBackingFactory` or `GPU state invalid` errors
- **Fix:** Launch Chromium with `--disable-gpu-video-decode` (see `scripts/kiosk.sh`)
- This prevents Chromium from attempting Y_UV 420 shared-image allocations that crash the VideoCore GPU command buffer
- The app includes automatic WebGL context-loss detection; if the GPU crashes, the page reloads after 1.5 seconds

### No signals displayed
- Open browser console (F12) for errors
- Check WebSocket connection status
- Verify `ghost_state.json` has entries:
  - Wi-Fi APs: `cat state/ghost_state.json | jq '.wifi.aps'`
  - Wi-Fi clients: `cat state/ghost_state.json | jq '.wifi.clients'`
  - Bluetooth: `cat state/ghost_state.json | jq '.bt.devices'`

### Poor frame rate
- Reduce MJPEG resolution in `server.py` (default is 1280x720)
- Close other browser tabs
- Check Pi CPU usage: `htop`

### Orientation not responding to IMU
- Check WebSocket is receiving IMU messages (browser console)
- Verify IMU is working: `python3 scripts/test/test_lsm6ds_read.py`
- Try toggling orientation source via UI (gyro vs mouse)

## Systemd Services

### Service won't start
- Check logs: `journalctl -u shadow-backend -e`
- Verify `EnvironmentFile` path exists
- Verify `ExecStart` path is correct and executable

### Service keeps restarting
- Check exit code: `systemctl status shadow-backend`
- Usually a missing dependency or wrong path
- Review `config/shadow.env` for typos

### All four services
```bash
sudo systemctl status shadow-kismet shadow-reducer shadow-backend shadow-power
```

## GPIO

### Buttons not responding
- Check wiring on GPIO 12 (snapshot) and GPIO 26 (mode/gallery)
- Ensure user is in `gpio` group: `groups $USER`
- Test manually: `python3 -c "from gpiozero import Button; b=Button(12); print(b.is_pressed)"`
- Run test script: `python3 scripts/test/test_buttons.py`

### LEDs not working
- Power LED on GPIO 20 (pin 38), Sense LED on GPIO 13 (pin 33)
- If `shadow-backend` is running, the GPIO is busy — stop the service first to test manually
- Test: `python3 scripts/test/test_leds.py`

### Button reads wrong voltage (~0.8V idle)
- A power shield on GPIO16 can interfere with nearby pins
- Buttons are on GPIO12 (pin 32) and GPIO26 (pin 37) to avoid this

### Verify GPIO pull-up

`raspi-gpio` was removed in Trixie. Use `pinctrl` instead (pre-installed on Raspberry Pi OS Trixie):

```bash
pinctrl set 12 ip pu
pinctrl get 12
```

Expected: ~3.3V idle, ~0V when pressed.

## X1201 UPS / Power Management

### Pi doesn't power off the shield on shutdown
- Verify EEPROM: `sudo rpi-eeprom-config` — check `POWER_OFF_ON_HALT=1`
- If missing, set it: `sudo rpi-eeprom-config -e`, add `POWER_OFF_ON_HALT=1`, reboot
- The X1201 detects 5V rail drop and enters standby

### Power Loss Detection (PLD) not working
- PLD uses GPIO 6 on gpiochip4 — make sure nothing else claims GPIO 6
- Test PLD manually:
  ```bash
  python3 -c "
  import gpiod
  req = gpiod.request_lines('/dev/gpiochip4', consumer='test',
      config={6: gpiod.LineSettings(direction=gpiod.line.Direction.INPUT)})
  val = req.get_value(6)
  print('AC:', 'connected' if val == gpiod.line.Value.ACTIVE else 'disconnected')
  req.release()
  "
  ```
- Unplug the charger and re-run to confirm it reads 0

### Battery fuel gauge not detected
- Check I2C: `sudo i2cdetect -y 1` — address `0x36` should appear
- If missing, check pogo-pin contact between X1201 and Pi (reseat the board)
- Clear solder residue from GPIO pins 3 and 5 on the Pi's underside

### Shutdown dialog appears on power button press
- **Most likely:** labwc intercepts the key before logind. Check: `grep XF86PowerOff ~/.config/labwc/rc.xml`
  - Fix: `sed -i '/<keybind key="XF86PowerOff"/,/<\/keybind>/d' ~/.config/labwc/rc.xml && labwc --reconfigure`
- **Also check:** logind config: `grep HandlePowerKey /etc/systemd/logind.conf`
  - Should read `HandlePowerKey=ignore`
  - Fix: `sudo sed -i 's/^.*HandlePowerKey=.*/HandlePowerKey=ignore/' /etc/systemd/logind.conf`
  - Reload: `sudo systemctl restart systemd-logind`
- Re-running `scripts/install_services.sh` fixes both layers automatically

### Power monitor service
- Check status: `systemctl status shadow-power`
- Logs: `journalctl -u shadow-power -f`
- If gpiod import fails: `sudo apt install python3-libgpiod`

## IMU (I2C)

### IMU not detected
- Check I2C enabled: `sudo raspi-config` -> Interface Options -> I2C
- Scan bus: `sudo i2cdetect -y 1` (expect `0x6A`)
- Verify wiring: SDA on pin 3, SCL on pin 5, 3V3 on pin 1/17
- IMU must be **3.3V**, not 5V

### IMU readings are erratic
- Check for loose connections on I2C lines
- Try reducing IMU broadcast rate in `server.py` (default 50 Hz)
- Verify complementary filter parameters

## Gallery / Snapshots

### Snapshots not saving
- Check `SNAP_DIR` path in `config/shadow.env`
- Verify directory exists and is writable: `ls -la state/snapshots/`
- Check backend logs for upload errors

### Live Photo not recording
- Live Photo requires MediaRecorder API support (modern Chromium)
- Check browser console for recording errors
- WebM files are saved alongside PNG stills

### Gallery not loading
- Navigate directly to `http://PI_IP:8080/gallery`
- Check that `src/gallery/` files exist
- Verify `GALLERY_DIR` in `config/shadow.env`

### Cannot delete snapshots
- Check file permissions on `state/snapshots/`
- Backend must have write access to the directory
