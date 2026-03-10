#!/usr/bin/env bash
set -e
sudo systemctl daemon-reload
sudo systemctl restart shadow-kismet  || true
sudo systemctl restart shadow-reducer || true
sudo systemctl restart shadow-backend || true

# Kiosk runs via XDG autostart (launches with the desktop session).
# Kill any running instance so the user can relaunch or reboot.
pkill -f 'chromium.*--kiosk' 2>/dev/null || true
