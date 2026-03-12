#!/usr/bin/env bash
# Launch all Shadow Creatures services in a tmux session for development.
set -e

SESSION="shadow"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$PROJECT_DIR/config/shadow.env"

if [ ! -f "$ENV_FILE" ]; then
    echo "ERROR: $ENV_FILE not found. Copy config/shadow.env.example and configure it."
    exit 1
fi

# Build an export string so each tmux pane inherits the env vars
ENV_EXPORT="set -a && source $ENV_FILE && set +a"

tmux kill-session -t "$SESSION" 2>/dev/null || true
tmux new-session -d -s "$SESSION" -n "kismet"

# Pane 0: Kismet (fixed channel 11, USB Wi-Fi + Bluetooth)
tmux send-keys -t "$SESSION:kismet" "sudo kismet --no-ncurses -c 'wlan1:type=linuxwifi,name=wifiusb,channel_hop=false,channel=11' -c 'hci0:type=linuxbluetooth,name=bt0'" C-m

# Pane 1: Reducer
tmux split-window -h -t "$SESSION:kismet"
tmux send-keys -t "$SESSION:kismet.1" "$ENV_EXPORT && sleep 5 && python3 $PROJECT_DIR/src/reducer/reducer.py" C-m

# Pane 2: Backend
tmux split-window -v -t "$SESSION:kismet.0"
tmux send-keys -t "$SESSION:kismet.2" "$ENV_EXPORT && sleep 8 && python3 $PROJECT_DIR/src/backend/server.py" C-m

tmux select-layout -t "$SESSION:kismet" main-horizontal

echo "Attaching to tmux session '$SESSION'..."
tmux attach -t "$SESSION"
