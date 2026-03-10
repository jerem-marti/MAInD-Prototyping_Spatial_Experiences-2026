#!/usr/bin/env bash
# Launch Chromium in kiosk mode for the Shadow Creatures overlay.
#
# Waits for the backend to respond (user sees a black screen during
# this period thanks to the desktop cleanup), then opens Chromium
# directly to the app. The app itself shows a splash overlay while
# the WebSocket and camera feed initialize.
#
# The --disable-gpu-video-decode flag prevents ChromeGPU from trying to
# create SharedImageBacking for Y_UV 420 video frames on VideoCore,
# which intermittently crashes the GPU command buffer and kills all
# WebGL contexts (black screen).
#
# Usage:  bash scripts/kiosk.sh [URL]

URL="${1:-http://localhost:8080}"

# Fallback if not running inside a desktop session (e.g. manual SSH launch)
if [ -z "$DISPLAY" ] && [ -z "$WAYLAND_DISPLAY" ]; then
    export DISPLAY=:0
fi

# Wayland flag if applicable
EXTRA_FLAGS=()
if [ -n "$WAYLAND_DISPLAY" ]; then
    EXTRA_FLAGS+=(--ozone-platform=wayland)
fi

# Wait for the backend to respond before launching Chromium.
# The desktop is black (no panel, no wallpaper) so the user just sees
# a blank screen during this wait — no OS GUI is visible.
MAX_WAIT=60
ATTEMPT=0
while [ "$ATTEMPT" -lt "$MAX_WAIT" ]; do
    if curl -s --max-time 2 "$URL" >/dev/null 2>&1; then
        echo "[kiosk] Backend ready at $URL"
        break
    fi
    ATTEMPT=$((ATTEMPT + 1))
    echo "[kiosk] Waiting for backend... ($ATTEMPT/$MAX_WAIT)"
    sleep 2
done

echo "[kiosk] Launching chromium -> $URL"
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
