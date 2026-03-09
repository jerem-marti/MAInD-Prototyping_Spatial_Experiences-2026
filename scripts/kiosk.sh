#!/usr/bin/env bash
# Launch Chromium in kiosk mode for the Shadow Creatures overlay.
#
# The --disable-gpu-video-decode flag prevents ChromeGPU from trying to
# create SharedImageBacking for Y_UV 420 video frames on VideoCore,
# which intermittently crashes the GPU command buffer and kills all
# WebGL contexts (black screen).
#
# Usage:  bash scripts/kiosk.sh [URL]

URL="${1:-http://localhost:8080}"

exec chromium \
  --app="$URL" \
  --start-fullscreen \
  --kiosk \
  --noerrdialogs \
  --disable-infobars \
  --password-store=basic \
  --disable-gpu-video-decode \
  --disable-software-rasterizer
