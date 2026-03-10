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

for unit in shadow-kismet.service shadow-reducer.service shadow-backend.service shadow-power.service; do
    echo "  Installing $unit (system)"
    install_template "$SYSTEMD_DIR/$unit" "/tmp/$unit"
    sudo mv "/tmp/$unit" "/etc/systemd/system/$unit"
done

sudo systemctl daemon-reload

for unit in shadow-kismet shadow-reducer shadow-backend shadow-power; do
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

    # Remove the LXDE panel (taskbar) from autostart so the desktop is clean
    if grep -qF "@lxpanel" "$USER_AUTOSTART" 2>/dev/null; then
        sed -i '/@lxpanel/d' "$USER_AUTOSTART"
        echo "  Removed lxpanel from autostart (hide taskbar)"
    fi

    # Remove pcmanfm desktop manager (draws wallpaper/icons — causes visible flash)
    if grep -qF "@pcmanfm" "$USER_AUTOSTART" 2>/dev/null; then
        sed -i '/@pcmanfm/d' "$USER_AUTOSTART"
        echo "  Removed pcmanfm desktop (prevents wallpaper flash)"
    fi

    # Remove screensaver if present
    if grep -qF "@xscreensaver" "$USER_AUTOSTART" 2>/dev/null; then
        sed -i '/@xscreensaver/d' "$USER_AUTOSTART"
        echo "  Removed xscreensaver from autostart"
    fi

    # Paint the X root window black immediately (first thing the user sees)
    if ! grep -qF "xsetroot" "$USER_AUTOSTART" 2>/dev/null; then
        sed -i "1i @xsetroot -solid '#0a0a0c'" "$USER_AUTOSTART"
        echo "  Added xsetroot black background as first autostart entry"
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

# ── Desktop cleanup (hide OS GUI for kiosk appearance) ──

echo ""
echo "--- Desktop kiosk cleanup ---"

# Install unclutter to hide the mouse cursor system-wide
if ! command -v unclutter >/dev/null 2>&1; then
    echo "  Installing unclutter (hides mouse cursor)..."
    sudo apt-get install -y unclutter-xfixes 2>/dev/null \
        || sudo apt-get install -y unclutter 2>/dev/null \
        || echo "  WARNING: could not install unclutter"
fi

# Set PCManFM desktop to black background with no icons (safety net if pcmanfm is re-added)
PCMANFM_CONF_DIR="$HOME/.config/pcmanfm/$SESSION_NAME"
PCMANFM_CONF="$PCMANFM_CONF_DIR/desktop-items-0.conf"

if [ -n "$SESSION_NAME" ]; then
    mkdir -p "$PCMANFM_CONF_DIR"
    cat > "$PCMANFM_CONF" << 'DESKEOF'
[*]
wallpaper_mode=color
wallpaper_common=1
desktop_bg=#0a0a0c
desktop_fg=#0a0a0c
show_documents=0
show_trash=0
show_mounts=0
DESKEOF
    echo "  Set PCManFM fallback background to #0a0a0c"
fi

# Configure lightdm greeter to show black background (covers DM → session gap)
LIGHTDM_GREETER="/etc/lightdm/lightdm-gtk-greeter.conf"
if [ -f "$LIGHTDM_GREETER" ]; then
    if ! grep -qF "background=#0a0a0c" "$LIGHTDM_GREETER" 2>/dev/null; then
        sudo sed -i 's/^background=.*/background=#0a0a0c/' "$LIGHTDM_GREETER" 2>/dev/null \
            || sudo sh -c "echo '[greeter]\nbackground=#0a0a0c' >> $LIGHTDM_GREETER"
        echo "  Set lightdm greeter background to black"
    fi
fi

# Disable RPi boot splash and text console for clean boot (requires reboot)
BOOT_CONFIG="/boot/firmware/config.txt"
[ -f "$BOOT_CONFIG" ] || BOOT_CONFIG="/boot/config.txt"
if [ -f "$BOOT_CONFIG" ]; then
    if ! grep -qF "disable_splash=1" "$BOOT_CONFIG" 2>/dev/null; then
        sudo sh -c "echo 'disable_splash=1' >> $BOOT_CONFIG"
        echo "  Disabled RPi rainbow splash screen"
    fi
fi
BOOT_CMDLINE="/boot/firmware/cmdline.txt"
[ -f "$BOOT_CMDLINE" ] || BOOT_CMDLINE="/boot/cmdline.txt"
if [ -f "$BOOT_CMDLINE" ]; then
    if ! grep -qF "quiet" "$BOOT_CMDLINE" 2>/dev/null; then
        sudo sed -i 's/$/ quiet splash logo.nologo vt.global_cursor_default=0/' "$BOOT_CMDLINE"
        echo "  Added quiet boot params (hides console text)"
    fi
fi

# Add unclutter to lxsession autostart if not already present
if [ -n "$SESSION_NAME" ] && [ -f "$USER_AUTOSTART" ]; then
    if ! grep -qF "unclutter" "$USER_AUTOSTART" 2>/dev/null; then
        echo "@unclutter -idle 0.1 -root" >> "$USER_AUTOSTART"
        echo "  Added unclutter to autostart (hides cursor)"
    fi
fi

# ── Power button: ignore single press (X1201 long-press handles shutdown) ──

echo ""
echo "--- Power button / X1201 UPS config ---"

LOGIND_CONF="/etc/systemd/logind.conf"
if [ -f "$LOGIND_CONF" ]; then
    # Set HandlePowerKey=ignore (suppress shutdown dialog on single press)
    if grep -q "^HandlePowerKey=" "$LOGIND_CONF" 2>/dev/null; then
        sudo sed -i 's/^HandlePowerKey=.*/HandlePowerKey=ignore/' "$LOGIND_CONF"
    elif grep -q "^#HandlePowerKey=" "$LOGIND_CONF" 2>/dev/null; then
        sudo sed -i 's/^#HandlePowerKey=.*/HandlePowerKey=ignore/' "$LOGIND_CONF"
    else
        sudo sh -c "echo 'HandlePowerKey=ignore' >> $LOGIND_CONF"
    fi
    echo "  Set HandlePowerKey=ignore in logind.conf"
fi

# Remove XF86PowerOff keybind from labwc (Wayland compositor intercepts it before logind)
LABWC_SYS="/etc/xdg/labwc/rc.xml"
LABWC_USER="$HOME/.config/labwc/rc.xml"
if [ -f "$LABWC_SYS" ] && grep -q "XF86PowerOff" "$LABWC_SYS" 2>/dev/null; then
    if [ ! -f "$LABWC_USER" ]; then
        mkdir -p "$(dirname "$LABWC_USER")"
        cp "$LABWC_SYS" "$LABWC_USER"
    fi
    if grep -q "XF86PowerOff" "$LABWC_USER" 2>/dev/null; then
        sed -i '/<keybind key="XF86PowerOff"/,/<\/keybind>/d' "$LABWC_USER"
        echo "  Removed XF86PowerOff keybind from labwc user config"
    fi
    # Live-reload labwc if running
    labwc --reconfigure 2>/dev/null || true
fi

# ── EEPROM reminder (cannot be automated safely — needs interactive rpi-eeprom-config) ──

echo ""
echo "--- EEPROM check ---"
echo "  Ensure the following EEPROM settings are applied (run once manually):"
echo ""
echo "    sudo rpi-eeprom-config -e"
echo ""
echo "  Set / verify these values:"
echo "    POWER_OFF_ON_HALT=1      (Pi cuts 5V on halt -> X1201 enters standby)"
echo "    PSU_MAX_CURRENT=5000     (suppress 5A warning)"
echo ""

# ── Disk space hardening ──

echo ""
echo "--- Disk space hardening ---"

# Cap journald log size
JOURNALD_CONF="/etc/systemd/journald.conf"
if [ -f "$JOURNALD_CONF" ]; then
    for key_val in "SystemMaxUse=50M" "RuntimeMaxUse=20M"; do
        key="${key_val%%=*}"
        if grep -q "^${key}=" "$JOURNALD_CONF" 2>/dev/null; then
            sudo sed -i "s/^${key}=.*/${key_val}/" "$JOURNALD_CONF"
        elif grep -q "^#${key}=" "$JOURNALD_CONF" 2>/dev/null; then
            sudo sed -i "s/^#${key}=.*/${key_val}/" "$JOURNALD_CONF"
        else
            sudo sh -c "echo '${key_val}' >> $JOURNALD_CONF"
        fi
    done
    echo "  Capped journald: SystemMaxUse=50M, RuntimeMaxUse=20M"
fi

# Disable core dumps (a single Chromium/Kismet crash can drop hundreds of MB)
COREDUMP_CONF="/etc/sysctl.d/50-no-coredump.conf"
if [ ! -f "$COREDUMP_CONF" ]; then
    sudo sh -c "echo 'kernel.core_pattern=/dev/null' > $COREDUMP_CONF"
    sudo sysctl -p "$COREDUMP_CONF" 2>/dev/null || true
    echo "  Disabled core dumps (kernel.core_pattern=/dev/null)"
else
    echo "  Core dumps already disabled"
fi

# Enable weekly apt cache cleanup
if ! systemctl is-enabled apt-daily.timer >/dev/null 2>&1; then
    sudo systemctl enable apt-daily.timer 2>/dev/null || true
fi
sudo apt clean 2>/dev/null || true
echo "  Cleaned apt cache"

echo ""
echo "=== Done. Services will start on next boot. ==="
echo ""
echo "  Kismet, Reducer, Backend: systemd (auto-start at boot)"
echo "  Power monitor (X1201):    systemd (auto-start at boot)"
echo "  Kiosk browser:            lxsession/${SESSION_NAME}/autostart"
echo "  Desktop:                  black background, no panel, cursor hidden"
echo "  Power button:             single press ignored, long press = shield shutdown"
echo ""
echo "Manual control:"
echo "  sudo systemctl start shadow-kismet shadow-reducer shadow-backend"
echo "  sudo systemctl start shadow-power"
echo "  bash $DEPLOY_DIR/scripts/kiosk.sh"
echo ""
echo "Logs:"
echo "  journalctl -u shadow-kismet -f"
echo "  journalctl -u shadow-reducer -f"
echo "  journalctl -u shadow-backend -f"
echo "  journalctl -u shadow-power -f"
