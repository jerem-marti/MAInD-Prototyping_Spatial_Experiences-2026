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

# ── Kiosk (XDG autostart — launches with the desktop session) ──

AUTOSTART_DIR="$HOME/.config/autostart"
mkdir -p "$AUTOSTART_DIR"

echo "  Installing shadow-kiosk.desktop (XDG autostart)"
install_template "$SYSTEMD_DIR/shadow-kiosk.desktop" "$AUTOSTART_DIR/shadow-kiosk.desktop"

# Also add to LXDE autostart file (Raspberry Pi OS uses lxsession)
LXDE_AUTOSTART="$HOME/.config/lxsession/LXDE-pi/autostart"
KIOSK_CMD="@bash ${DEPLOY_DIR}/scripts/kiosk.sh http://localhost:8080"
if [ -d "$(dirname "$LXDE_AUTOSTART")" ] || [ -f "$LXDE_AUTOSTART" ]; then
    if ! grep -qF "kiosk.sh" "$LXDE_AUTOSTART" 2>/dev/null; then
        echo "$KIOSK_CMD" >> "$LXDE_AUTOSTART"
        echo "  Added kiosk to LXDE autostart"
    else
        echo "  LXDE autostart already has kiosk entry"
    fi
else
    # Create LXDE autostart from system default + kiosk line
    mkdir -p "$(dirname "$LXDE_AUTOSTART")"
    if [ -f /etc/xdg/lxsession/LXDE-pi/autostart ]; then
        cp /etc/xdg/lxsession/LXDE-pi/autostart "$LXDE_AUTOSTART"
    fi
    echo "$KIOSK_CMD" >> "$LXDE_AUTOSTART"
    echo "  Created LXDE autostart with kiosk entry"
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
echo "  Kiosk browser:            LXDE/XDG autostart (auto-start with desktop)"
echo ""
echo "Manual control:"
echo "  sudo systemctl start shadow-kismet shadow-reducer shadow-backend"
echo "  bash $DEPLOY_DIR/scripts/kiosk.sh"
echo ""
echo "Logs:"
echo "  journalctl -u shadow-kismet -f"
echo "  journalctl -u shadow-reducer -f"
echo "  journalctl -u shadow-backend -f"
