#!/usr/bin/env bash
# Launch Chromium in kiosk mode for the Shadow Creatures overlay.
#
# Instead of waiting for the backend in bash (showing a bare desktop),
# Chromium opens immediately with a local splash page that polls the
# backend and redirects when it's ready.
#
# The --disable-gpu-video-decode flag prevents ChromeGPU from trying to
# create SharedImageBacking for Y_UV 420 video frames on VideoCore,
# which intermittently crashes the GPU command buffer and kills all
# WebGL contexts (black screen).
#
# Usage:  bash scripts/kiosk.sh [URL]

URL="${1:-http://localhost:8080}"

# Resolve project root (scripts/ lives one level below)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOY_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

SPLASH_FILE="$DEPLOY_DIR/src/web/splash.html"

# Fallback if not running inside a desktop session (e.g. manual SSH launch)
if [ -z "$DISPLAY" ] && [ -z "$WAYLAND_DISPLAY" ]; then
    export DISPLAY=:0
fi

# Wayland flag if applicable
EXTRA_FLAGS=()
if [ -n "$WAYLAND_DISPLAY" ]; then
    EXTRA_FLAGS+=(--ozone-platform=wayland)
fi

# If the backend is already up, go straight to it; otherwise show splash
if curl -s --max-time 2 "$URL" >/dev/null 2>&1; then
    LAUNCH_URL="$URL"
    echo "[kiosk] Backend already up — launching directly"
else
    LAUNCH_URL="file://${SPLASH_FILE}"
    echo "[kiosk] Backend not ready — launching splash screen"
fi

echo "[kiosk] Launching chromium -> $LAUNCH_URL"
exec chromium \
  --app="$LAUNCH_URL" \
  --start-fullscreen \
  --kiosk \
  --noerrdialogs \
  --disable-infobars \
  --password-store=basic \
  --disable-gpu-video-decode \
  --disable-software-rasterizer \
  --allow-file-access-from-files \
  "${EXTRA_FLAGS[@]}"
