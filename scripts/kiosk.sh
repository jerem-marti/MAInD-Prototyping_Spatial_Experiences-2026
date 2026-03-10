#!/usr/bin/env bash
# Launch Chromium in kiosk mode for the Shadow Creatures overlay.
#
# The --disable-gpu-video-decode flag prevents ChromeGPU from trying to
# create SharedImageBacking for Y_UV 420 video frames on VideoCore,
# which intermittently crashes the GPU command buffer and kills all
# WebGL contexts (black screen).
#
# Works on both X11 (startx, Pi default) and Wayland (labwc).
# When launched from systemd, waits for the display server to be ready.
#
# Usage:  bash scripts/kiosk.sh [URL]

URL="${1:-http://localhost:8080}"

# --- Ensure we have display variables ---
# systemd user services may not inherit the graphical session env.
if [ -z "$WAYLAND_DISPLAY" ] && [ -z "$DISPLAY" ]; then
    # Import from systemd user manager
    if command -v systemctl &>/dev/null; then
        eval "$(systemctl --user show-environment 2>/dev/null \
            | grep -E '^(WAYLAND_DISPLAY|DISPLAY|XDG_RUNTIME_DIR|XAUTHORITY)=' \
            | sed 's/^/export /')" 2>/dev/null || true
    fi

    # Fallback: scrape from a running desktop process
    if [ -z "$WAYLAND_DISPLAY" ] && [ -z "$DISPLAY" ]; then
        for proc in labwc wayfire sway weston openbox lxsession; do
            pid=$(pgrep -u "$USER" -x "$proc" | head -1)
            if [ -n "$pid" ] && [ -r "/proc/$pid/environ" ]; then
                while IFS= read -r -d '' line; do
                    case "$line" in
                        WAYLAND_DISPLAY=*|DISPLAY=*|XDG_RUNTIME_DIR=*|XAUTHORITY=*)
                            export "$line" ;;
                    esac
                done < "/proc/$pid/environ"
                break
            fi
        done
    fi

    # Last resort
    if [ -z "$WAYLAND_DISPLAY" ] && [ -z "$DISPLAY" ]; then
        export DISPLAY=:0
    fi
fi

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"

# --- Wait for the display server to be ready ---
# At boot the service may start before X11/Wayland is up.
MAX_WAIT=60
WAITED=0
echo "[kiosk] Waiting for display server (DISPLAY=$DISPLAY)..."
while [ "$WAITED" -lt "$MAX_WAIT" ]; do
    if [ -n "$WAYLAND_DISPLAY" ] && [ -S "$XDG_RUNTIME_DIR/$WAYLAND_DISPLAY" ]; then
        echo "[kiosk] Wayland socket found after ${WAITED}s"
        break
    elif [ -n "$DISPLAY" ] && xdpyinfo -display "$DISPLAY" &>/dev/null; then
        echo "[kiosk] X11 display ready after ${WAITED}s"
        break
    fi
    sleep 2
    WAITED=$((WAITED + 2))
done

if [ "$WAITED" -ge "$MAX_WAIT" ]; then
    echo "[kiosk] ERROR: display server not ready after ${MAX_WAIT}s — aborting"
    exit 1
fi

# --- Wait for the backend to be reachable ---
echo "[kiosk] Waiting for backend at $URL ..."
WAITED=0
while [ "$WAITED" -lt "$MAX_WAIT" ]; do
    if curl -s --max-time 2 "$URL" >/dev/null 2>&1; then
        echo "[kiosk] Backend ready after ${WAITED}s"
        break
    fi
    sleep 2
    WAITED=$((WAITED + 2))
done

# --- Build Chromium flags ---
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
