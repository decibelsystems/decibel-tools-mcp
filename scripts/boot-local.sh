#!/bin/bash
# =============================================================================
# boot-local.sh — Start daemon + cymoril agent for local multi-agent testing
# =============================================================================
# Usage:
#   ./scripts/boot-local.sh           # Start both (tmux)
#   ./scripts/boot-local.sh --stop    # Stop both
#   ./scripts/boot-local.sh --status  # Check status
# =============================================================================

set -euo pipefail

DAEMON_DIR="/Volumes/Ashitaka/Documents/GitHub/decibel-tools-mcp"
AGENT_DIR="/Volumes/Ashitaka/Documents/GitHub/decibel-agent"
DAEMON_PORT=4888
SESSION="decibel-multi"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# ── Helpers ──────────────────────────────────────────────────────────────────

log()  { echo -e "${GREEN}[boot]${NC} $1"; }
warn() { echo -e "${YELLOW}[boot]${NC} $1"; }
err()  { echo -e "${RED}[boot]${NC} $1"; }
info() { echo -e "${CYAN}[boot]${NC} $1"; }

check_daemon_health() {
  curl -sf "http://localhost:${DAEMON_PORT}/health" >/dev/null 2>&1
}

# ── Stop ─────────────────────────────────────────────────────────────────────

stop_all() {
  log "Stopping multi-agent session..."

  # Kill tmux session if it exists
  if tmux has-session -t "$SESSION" 2>/dev/null; then
    tmux kill-session -t "$SESSION"
    log "Killed tmux session: $SESSION"
  fi

  # Stop daemon via PID file
  if [ -f ~/.decibel/daemon.pid ]; then
    local pid
    pid=$(cat ~/.decibel/daemon.pid)
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid"
      log "Stopped daemon (PID $pid)"
      sleep 1
    else
      warn "Stale PID file (PID $pid not running)"
    fi
    rm -f ~/.decibel/daemon.pid
  fi

  log "All stopped."
}

# ── Status ───────────────────────────────────────────────────────────────────

show_status() {
  info "=== Multi-Agent Status ==="

  # Daemon
  if [ -f ~/.decibel/daemon.pid ]; then
    local pid
    pid=$(cat ~/.decibel/daemon.pid)
    if kill -0 "$pid" 2>/dev/null; then
      echo -e "  Daemon:  ${GREEN}running${NC} (PID $pid, port $DAEMON_PORT)"
      if check_daemon_health; then
        local health
        health=$(curl -sf "http://localhost:${DAEMON_PORT}/health")
        local agents
        agents=$(echo "$health" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('connected_agents', 0))" 2>/dev/null || echo "?")
        echo -e "  Health:  ${GREEN}ok${NC} ($agents connected agents)"
      else
        echo -e "  Health:  ${YELLOW}not responding${NC}"
      fi
    else
      echo -e "  Daemon:  ${RED}dead${NC} (stale PID $pid)"
    fi
  else
    echo -e "  Daemon:  ${RED}not running${NC}"
  fi

  # Tmux session
  if tmux has-session -t "$SESSION" 2>/dev/null; then
    echo -e "  Tmux:    ${GREEN}$SESSION${NC} (active)"
  else
    echo -e "  Tmux:    ${RED}no session${NC}"
  fi

  # Connected agents
  if check_daemon_health; then
    echo ""
    info "=== Connected Agents ==="
    curl -sf "http://localhost:${DAEMON_PORT}/agents" | python3 -m json.tool 2>/dev/null || echo "  (none)"
  fi
}

# ── Build ────────────────────────────────────────────────────────────────────

build_daemon() {
  if [ ! -f "$DAEMON_DIR/dist/server.js" ] || \
     [ "$(find "$DAEMON_DIR/src" -name '*.ts' -newer "$DAEMON_DIR/dist/server.js" 2>/dev/null | head -1)" ]; then
    log "Building decibel-tools-mcp..."
    (cd "$DAEMON_DIR" && npx tsc --noEmit 2>&1 | tail -5 && npx tsc)
    log "Daemon built."
  else
    log "Daemon dist is up to date."
  fi
}

build_agent() {
  if [ ! -f "$AGENT_DIR/apps/cymoril/dist/index.js" ] || \
     [ "$(find "$AGENT_DIR/apps/cymoril/src" -name '*.ts' -newer "$AGENT_DIR/apps/cymoril/dist/index.js" 2>/dev/null | head -1)" ]; then
    log "Building cymoril agent..."
    (cd "$AGENT_DIR" && pnpm -F cymoril build 2>&1 | tail -5)
    log "Cymoril built."
  else
    log "Cymoril dist is up to date."
  fi
}

# ── Start ────────────────────────────────────────────────────────────────────

start_all() {
  # Pre-flight: check nothing already running
  if tmux has-session -t "$SESSION" 2>/dev/null; then
    warn "Session '$SESSION' already exists. Use --stop first or --status to check."
    exit 1
  fi

  if check_daemon_health; then
    warn "Daemon already responding on port $DAEMON_PORT. Use --stop first."
    exit 1
  fi

  # Clean up stale PID
  if [ -f ~/.decibel/daemon.pid ]; then
    local pid
    pid=$(cat ~/.decibel/daemon.pid)
    if ! kill -0 "$pid" 2>/dev/null; then
      rm -f ~/.decibel/daemon.pid
    fi
  fi

  # Build if needed
  build_daemon
  build_agent

  log "Starting multi-agent session..."

  # Create tmux session with daemon in first pane
  tmux new-session -d -s "$SESSION" -c "$DAEMON_DIR" -n "daemon"
  tmux send-keys -t "$SESSION:daemon" \
    "node dist/server.js --daemon --port $DAEMON_PORT" Enter

  # Wait for daemon health
  log "Waiting for daemon health check..."
  for i in $(seq 1 30); do
    if check_daemon_health; then
      log "Daemon healthy after ${i}s"
      break
    fi
    if [ "$i" -eq 30 ]; then
      err "Daemon did not become healthy in 30s"
      tmux kill-session -t "$SESSION" 2>/dev/null
      exit 1
    fi
    sleep 1
  done

  # Start cymoril in second pane
  tmux new-window -t "$SESSION" -n "cymoril" -c "$AGENT_DIR/apps/cymoril"
  tmux send-keys -t "$SESSION:cymoril" \
    "MCP_SERVER_URL=http://localhost:${DAEMON_PORT} node dist/index.js" Enter

  # Wait a moment for cymoril to connect
  sleep 3

  # Add a status pane
  tmux new-window -t "$SESSION" -n "status" -c "$DAEMON_DIR"
  tmux send-keys -t "$SESSION:status" \
    "watch -n5 'curl -sf http://localhost:${DAEMON_PORT}/health | python3 -m json.tool'" Enter

  # Select daemon pane
  tmux select-window -t "$SESSION:daemon"

  echo ""
  log "Multi-agent session started!"
  echo ""
  info "  tmux session:  $SESSION"
  info "  Daemon:        http://localhost:$DAEMON_PORT"
  info "  Agent:         cymoril (FacadeSDK → daemon)"
  echo ""
  info "  Windows:"
  info "    0: daemon   — decibel-tools-mcp daemon logs"
  info "    1: cymoril  — cymoril agent logs"
  info "    2: status   — live health monitor"
  echo ""
  info "  Commands:"
  info "    tmux attach -t $SESSION          # Attach to session"
  info "    ./scripts/boot-local.sh --status # Check status"
  info "    ./scripts/boot-local.sh --stop   # Stop everything"
  echo ""
  info "  Test the agent:"
  info "    curl -X POST http://localhost:3000/chat \\"
  info "      -H 'Content-Type: application/json' \\"
  info "      -H 'X-Api-Key: <from .env>' \\"
  info "      -d '{\"text\": \"what are the open issues?\"}'"
  echo ""
  info "  Test the daemon directly:"
  info "    curl http://localhost:$DAEMON_PORT/health"
  info "    curl http://localhost:$DAEMON_PORT/agents"
  info "    curl -N http://localhost:$DAEMON_PORT/events/stream  # SSE stream"
  echo ""

  # Optionally attach
  read -p "Attach to tmux session? [Y/n] " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Nn]$ ]]; then
    tmux attach -t "$SESSION"
  fi
}

# ── Main ─────────────────────────────────────────────────────────────────────

case "${1:-start}" in
  --stop|-s)
    stop_all
    ;;
  --status|-t)
    show_status
    ;;
  start|--start|*)
    start_all
    ;;
esac
