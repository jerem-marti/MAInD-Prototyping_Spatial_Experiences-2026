#!/usr/bin/env bash
# Install and enable all Shadow Creatures systemd services.
# Run once after first deploy or after adding/changing .service files.
#
# Usage:  bash scripts/install_services.sh

set -e

DEPLOY_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SYSTEMD_DIR="$DEPLOY_DIR/systemd"

echo "=== Shadow Creatures — install systemd services ==="
echo "Deploy dir: $DEPLOY_DIR"

# ── System-level services (kismet, reducer, backend) ──

for unit in shadow-kismet.service shadow-reducer.service shadow-backend.service; do
    echo "  Installing $unit (system)"
    sudo cp "$SYSTEMD_DIR/$unit" /etc/systemd/system/"$unit"
done

sudo systemctl daemon-reload

for unit in shadow-kismet shadow-reducer shadow-backend; do
    sudo systemctl enable "$unit"
    echo "  Enabled $unit"
done

# ── User-level service (kiosk — needs graphical session) ──

USER_UNIT_DIR="$HOME/.config/systemd/user"
mkdir -p "$USER_UNIT_DIR"

echo "  Installing shadow-kiosk.service (user)"
cp "$SYSTEMD_DIR/shadow-kiosk.service" "$USER_UNIT_DIR/shadow-kiosk.service"

systemctl --user daemon-reload
systemctl --user enable shadow-kiosk
echo "  Enabled shadow-kiosk (user)"

# Ensure the user's lingering is enabled so user services start at boot
# even before interactive login (needed for auto-start on headless reboot)
sudo loginctl enable-linger "$USER"
echo "  Enabled linger for $USER"

echo ""
echo "=== Done. Services will start on next boot. ==="
echo ""
echo "Manual control:"
echo "  sudo systemctl start shadow-kismet shadow-reducer shadow-backend"
echo "  systemctl --user start shadow-kiosk"
echo ""
echo "Logs:"
echo "  journalctl -u shadow-backend -f"
echo "  journalctl --user -u shadow-kiosk -f"
