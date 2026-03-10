#!/usr/bin/env bash
# Launch Chromium in kiosk mode for the Shadow Creatures overlay.
#
# The --disable-gpu-video-decode flag prevents ChromeGPU from trying to
# create SharedImageBacking for Y_UV 420 video frames on VideoCore,
# which intermittently crashes the GPU command buffer and kills all
# WebGL contexts (black screen).
#
# Works on both Wayland (labwc, Trixie default) and X11.
# When launched from systemd (no display vars), it imports them from
# the running desktop session automatically.
#
# Usage:  bash scripts/kiosk.sh [URL]

URL="${1:-http://localhost:8080}"

# --- Ensure we have a display to connect to ---
# systemd user services don't inherit the graphical session env.
# Import WAYLAND_DISPLAY / DISPLAY / XDG_RUNTIME_DIR from the compositor.
if [ -z "$WAYLAND_DISPLAY" ] && [ -z "$DISPLAY" ]; then
    # Try to import from systemd user manager (set by the session)
    if command -v systemctl &>/dev/null; then
        eval "$(systemctl --user show-environment 2>/dev/null \
            | grep -E '^(WAYLAND_DISPLAY|DISPLAY|XDG_RUNTIME_DIR)=' \
            | sed 's/^/export /')" 2>/dev/null || true
    fi

    # Fallback: scrape the env from a running desktop process
    if [ -z "$WAYLAND_DISPLAY" ] && [ -z "$DISPLAY" ]; then
        for proc in labwc wayfire sway weston openbox; do
            pid=$(pgrep -u "$USER" -x "$proc" | head -1)
            if [ -n "$pid" ] && [ -r "/proc/$pid/environ" ]; then
                while IFS= read -r -d '' line; do
                    case "$line" in
                        WAYLAND_DISPLAY=*|DISPLAY=*|XDG_RUNTIME_DIR=*)
                            export "$line" ;;
                    esac
                done < "/proc/$pid/environ"
                break
            fi
        done
    fi

    # Last resort: assume X11 :0
    if [ -z "$WAYLAND_DISPLAY" ] && [ -z "$DISPLAY" ]; then
        export DISPLAY=:0
    fi
fi

# Ensure XDG_RUNTIME_DIR is set (systemd default)
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"

# --- Build Chromium flags ---
EXTRA_FLAGS=()
if [ -n "$WAYLAND_DISPLAY" ]; then
    EXTRA_FLAGS+=(--ozone-platform=wayland)
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
