#!/bin/bash
# ===========================================================================
# Decibel MCP Server — tmux launch script
# ===========================================================================
# Usage: ./start.sh [port]
#   port defaults to 8787
#
# Layout:
#   ┌─────────────────────────────────┐
#   │  Tool Activity Monitor (top)    │
#   ├─────────────────────────────────┤
#   │  Server Output (bottom)         │
#   └─────────────────────────────────┘
# ===========================================================================

PORT="${1:-8787}"
SESSION="decibel-mcp"
LOGFILE="/tmp/decibel-mcp.log"

# Kill any existing process on the port
lsof -ti :"$PORT" | xargs kill -9 2>/dev/null

# Clear old log
> "$LOGFILE"

# Kill existing tmux session if present
tmux kill-session -t "$SESSION" 2>/dev/null

# Build first
echo "Building..."
npm run build || { echo "Build failed"; exit 1; }

# Create tmux session with the server in the bottom pane
tmux new-session -d -s "$SESSION" -x 200 -y 50 \
  "node dist/server.js --http --port $PORT 2>&1 | tee $LOGFILE; read"

# Split: top pane for tool activity monitor
tmux split-window -t "$SESSION" -b -v -p 35 \
  "tail -f $LOGFILE | grep --line-buffered -E 'Tool called:|/call tool=|/api/tools/|Error in tool'; read"

# Style the panes
tmux select-pane -t "$SESSION:0.0" -T "Tool Activity"
tmux select-pane -t "$SESSION:0.1" -T "Server"

# Focus the bottom pane (server)
tmux select-pane -t "$SESSION:0.1"

# Set status bar
tmux set-option -t "$SESSION" status-style "bg=#1a1a1a,fg=#888888"
tmux set-option -t "$SESSION" status-left "#[fg=#ccc,bold] DECIBEL MCP "
tmux set-option -t "$SESSION" status-right "#[fg=#555]port:$PORT | %H:%M "
tmux set-option -t "$SESSION" pane-border-style "fg=#333333"
tmux set-option -t "$SESSION" pane-active-border-style "fg=#666666"

# Attach
tmux attach -t "$SESSION"
