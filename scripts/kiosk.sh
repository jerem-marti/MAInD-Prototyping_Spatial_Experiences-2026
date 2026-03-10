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

# Fallback if not running inside a desktop session (e.g. manual SSH launch)
if [ -z "$DISPLAY" ] && [ -z "$WAYLAND_DISPLAY" ]; then
    export DISPLAY=:0
fi

# Wait for the backend to be reachable (at boot it may still be starting)
echo "[kiosk] Waiting for backend at $URL ..."
for i in $(seq 1 30); do
    if curl -s --max-time 2 "$URL" >/dev/null 2>&1; then
        echo "[kiosk] Backend ready"
        break
    fi
    sleep 2
done

# Wayland flag if applicable
EXTRA_FLAGS=()
if [ -n "$WAYLAND_DISPLAY" ]; then
    EXTRA_FLAGS+=(--ozone-platform=wayland)
fi

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
