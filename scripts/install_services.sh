#!/usr/bin/env bash
# Install and enable all Shadow Creatures services.
# Resolves paths dynamically — no hardcoded deploy directory.
#
# Usage:  bash scripts/install_services.sh

set -e

DEPLOY_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SYSTEMD_DIR="$DEPLOY_DIR/systemd"

echo "=== Shadow Creatures — install services ==="
echo "Deploy dir: $DEPLOY_DIR"

# ── Helper: copy a template file, replacing __DEPLOY_DIR__ with actual path ──
install_template() {
    local src="$1" dst="$2"
    sed "s|__DEPLOY_DIR__|${DEPLOY_DIR}|g" "$src" > "$dst"
}

# ── System-level services (kismet, reducer, backend) ──

for unit in shadow-kismet.service shadow-reducer.service shadow-backend.service; do
    echo "  Installing $unit (system)"
    install_template "$SYSTEMD_DIR/$unit" "/tmp/$unit"
    sudo mv "/tmp/$unit" "/etc/systemd/system/$unit"
done

sudo systemctl daemon-reload

for unit in shadow-kismet shadow-reducer shadow-backend; do
    sudo systemctl enable "$unit"
    echo "  Enabled $unit"
done

# ── Kiosk (lxsession autostart — launches with the desktop) ──

# Detect the active lxsession profile: use /etc/xdg/lxsession/* as source of truth
SESSION_NAME=""
for candidate in rpd-x LXDE-pi LXDE; do
    if [ -d "/etc/xdg/lxsession/$candidate" ]; then
        SESSION_NAME="$candidate"
        break
    fi
done

KIOSK_CMD="@bash ${DEPLOY_DIR}/scripts/kiosk.sh http://localhost:8080"

if [ -n "$SESSION_NAME" ]; then
    USER_AUTOSTART="$HOME/.config/lxsession/$SESSION_NAME/autostart"
    SYS_AUTOSTART="/etc/xdg/lxsession/$SESSION_NAME/autostart"

    mkdir -p "$(dirname "$USER_AUTOSTART")"

    # If user override doesn't exist yet, copy system default first
    if [ ! -f "$USER_AUTOSTART" ] && [ -f "$SYS_AUTOSTART" ]; then
        cp "$SYS_AUTOSTART" "$USER_AUTOSTART"
    fi

    # Append kiosk entry if not already there
    if ! grep -qF "kiosk.sh" "$USER_AUTOSTART" 2>/dev/null; then
        echo "$KIOSK_CMD" >> "$USER_AUTOSTART"
        echo "  Added kiosk to lxsession/$SESSION_NAME/autostart"
    else
        echo "  lxsession/$SESSION_NAME/autostart already has kiosk entry"
    fi
else
    echo "  WARNING: no lxsession profile found, skipping desktop autostart"
    echo "  You may need to add the kiosk manually to your session autostart"
fi

# Clean up old systemd user service if present
OLD_UNIT="$HOME/.config/systemd/user/shadow-kiosk.service"
if [ -f "$OLD_UNIT" ]; then
    echo "  Removing old systemd user service"
    systemctl --user disable shadow-kiosk 2>/dev/null || true
    systemctl --user stop shadow-kiosk 2>/dev/null || true
    rm -f "$OLD_UNIT"
    systemctl --user daemon-reload 2>/dev/null || true
fi

echo ""
echo "=== Done. Services will start on next boot. ==="
echo ""
echo "  Kismet, Reducer, Backend: systemd (auto-start at boot)"
echo "  Kiosk browser:            lxsession/${SESSION_NAME}/autostart"
echo ""
echo "Manual control:"
echo "  sudo systemctl start shadow-kismet shadow-reducer shadow-backend"
echo "  bash $DEPLOY_DIR/scripts/kiosk.sh"
echo ""
echo "Logs:"
echo "  journalctl -u shadow-kismet -f"
echo "  journalctl -u shadow-reducer -f"
echo "  journalctl -u shadow-backend -f"
