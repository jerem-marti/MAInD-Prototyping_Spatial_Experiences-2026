#!/usr/bin/env bash
set -e
sudo systemctl daemon-reload
sudo systemctl restart shadow-kismet  || true
sudo systemctl restart shadow-reducer || true
sudo systemctl restart shadow-backend || true

# Kiosk is a user-level service (needs the graphical session)
systemctl --user daemon-reload
systemctl --user restart shadow-kiosk || true
