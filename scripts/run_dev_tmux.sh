#!/usr/bin/env bash
# Launch all Shadow Creatures services in a tmux session for development.
set -e

SESSION="shadow"

tmux kill-session -t "$SESSION" 2>/dev/null || true
tmux new-session -d -s "$SESSION" -n "kismet"

# Pane 0: Kismet (fixed channel 11, USB Wi-Fi + Bluetooth)
tmux send-keys -t "$SESSION:kismet" "sudo kismet --no-ncurses -c 'wlan1:type=linuxwifi,name=wifiusb,channel_hop=false,channel=11' -c 'hci0:type=linuxbluetooth,name=bt0'" C-m

# Pane 1: Reducer
tmux split-window -h -t "$SESSION:kismet"
tmux send-keys -t "$SESSION:kismet.1" "sleep 5 && python3 src/reducer/reducer.py" C-m

# Pane 2: Backend
tmux split-window -v -t "$SESSION:kismet.0"
tmux send-keys -t "$SESSION:kismet.2" "sleep 8 && python3 src/backend/server.py" C-m

tmux select-layout -t "$SESSION:kismet" main-horizontal

echo "Attaching to tmux session '$SESSION'..."
tmux attach -t "$SESSION"
