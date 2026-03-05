#!/usr/bin/env bash
set -e

sudo apt update
sudo apt install -y \
  python3-picamera2 python3-aiohttp python3-requests python3-gpiozero \
  python3-smbus python3-jinja2 \
  i2c-tools \
  jq tmux curl wget gpg chromium

# groupes pour éviter sudo
sudo usermod -aG video,gpio "$USER" || true

echo "Done. Reboot recommended."
