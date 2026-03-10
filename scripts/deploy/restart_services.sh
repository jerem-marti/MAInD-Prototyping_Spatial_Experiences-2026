#!/usr/bin/env bash
set -e

DEPLOY_DIR="$(cd "$(dirname "$0")/../.." && pwd)"

sudo systemctl daemon-reload
sudo systemctl restart shadow-kismet  || true
sudo systemctl restart shadow-reducer || true
sudo systemctl restart shadow-backend || true

# Kiosk runs via lxsession autostart (launches with the desktop).
# Kill the running instance and relaunch with fresh code.
pkill -f 'chromium.*--kiosk' 2>/dev/null || true
sleep 2
bash "$DEPLOY_DIR/scripts/kiosk.sh" &
