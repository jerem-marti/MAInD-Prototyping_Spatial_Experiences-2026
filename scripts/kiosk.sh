#!/usr/bin/env bash
# Launch Chromium in kiosk mode for the Shadow Creatures overlay.
#
# The --disable-gpu-video-decode flag prevents ChromeGPU from trying to
# create SharedImageBacking for Y_UV 420 video frames on VideoCore,
# which intermittently crashes the GPU command buffer and kills all
# WebGL contexts (black screen).
#
# Works on both Wayland (labwc, Trixie default) and X11.
#
# Usage:  bash scripts/kiosk.sh [URL]

URL="${1:-http://localhost:8080}"

# Detect display server
EXTRA_FLAGS=()
if [ -n "$WAYLAND_DISPLAY" ]; then
    EXTRA_FLAGS+=(--ozone-platform=wayland)
elif [ -z "$DISPLAY" ]; then
    export DISPLAY=:0
fi

exec chromium \
  --app="$URL" \
  --start-fullscreen \
  --kiosk \
  --noerrdialogs \
  --disable-infobars \
  --password-store=basic \
  --disable-gpu-video-decode \
  --disable-software-rasterizer \
  "${EXTRA_FLAGS[@]}"
