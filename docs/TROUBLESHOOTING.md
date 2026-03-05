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

## Web Overlay

### No ghosts displayed
- Open browser console (F12) for errors
- Check WebSocket connection status
- Verify `ghost_state.json` has entries: `cat state/ghost_state.json | jq '.wifi.aps'`
- For BT: `cat state/ghost_state.json | jq '.bt.devices'`

### Poor frame rate
- Reduce MJPEG resolution in `server.py`
- Close other browser tabs
- Check Pi CPU usage: `htop`

## Systemd Services

### Service won't start
- Check logs: `journalctl -u shadow-backend -e`
- Verify `EnvironmentFile` path exists
- Verify `ExecStart` path is correct and executable

### Service keeps restarting
- Check exit code: `systemctl status shadow-backend`
- Usually a missing dependency or wrong path
- Review `config/shadow.env` for typos

## GPIO

### Buttons not responding
- Check wiring on GPIO 17 and 27
- Ensure user is in `gpio` group
- Test manually: `python3 -c "from gpiozero import Button; b=Button(17); print(b.is_pressed)"`

### Button reads wrong voltage (~0.8V idle)
- A power shield on GPIO16 can interfere with nearby pins
- Move the button to GPIO12 (pin 32) or GPIO26 (pin 37) instead
- Update `BTN_SNAPSHOT` / `BTN_MODE` in `server.py` accordingly

### Verify GPIO pull-up

`raspi-gpio` was removed in Trixie. Use `pinctrl` instead (pre-installed on Raspberry Pi OS Trixie):

```bash
pinctrl set 17 ip pu
pinctrl get 17
```

Expected: ~3.3V idle, ~0V when pressed.

## IMU (I2C)

### IMU not detected
- Check I2C enabled: `sudo raspi-config` -> Interface Options -> I2C
- Scan bus: `sudo i2cdetect -y 1` (expect `0x6A`)
- Verify wiring: SDA on pin 3, SCL on pin 5, 3V3 on pin 1/17
- IMU must be **3.3V**, not 5V
