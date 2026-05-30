#!/bin/bash
# Decibel session init — runs on Claude Code boot via SessionStart hook
# Calls 4 tools via daemon HTTP batch endpoint, falls back to nudge if daemon is down

PROJECT_ID=$(basename "$PWD")
# Discover the daemon port from ~/.decibel/daemon.meta (written by the daemon),
# matching HQ's vite.config discovery. Env var wins; fallback 4888 (the daemon default).
PORT="${DECIBEL_DAEMON_PORT:-$(python3 -c "import json,os;print(json.load(open(os.path.expanduser('~/.decibel/daemon.meta')))['port'])" 2>/dev/null || echo 4888)}"
URL="http://localhost:${PORT}/batch"

# Try the daemon batch endpoint
RESULT=$(curl -s -m 5 -X POST "$URL" \
  -H "Content-Type: application/json" \
  -d "{
    \"calls\": [
      {\"facade\": \"oracle\", \"action\": \"next_actions\", \"params\": {\"project_id\": \"${PROJECT_ID}\"}},
      {\"facade\": \"voice\", \"action\": \"inbox_sync\", \"params\": {\"project_id\": \"${PROJECT_ID}\"}},
      {\"facade\": \"agentic\", \"action\": \"queue_sync\", \"params\": {\"project_id\": \"${PROJECT_ID}\"}},
      {\"facade\": \"sentinel\", \"action\": \"list_issues\", \"params\": {\"project_id\": \"${PROJECT_ID}\", \"status\": \"open\"}}
    ]
  }" 2>/dev/null)

if [ $? -eq 0 ] && printf '%s' "$RESULT" | grep -q '"status"'; then
  # Daemon responded — inject a COMPACT digest (counts + top 3 next actions), not raw JSON.
  # Select by action name (order-independent); printf (not echo) preserves JSON escapes.
  pick() { printf '%s' "$RESULT" | jq -r --arg a "$1" '.results[] | select(.action==$a) | .result.content[0].text' 2>/dev/null; }
  NACT=$(pick next_actions | jq -r '.actions | length' 2>/dev/null);                 NACT=${NACT:-0}
  BLOCK=$(pick next_actions | jq -r '.friction_summary.blocking // 0' 2>/dev/null);  BLOCK=${BLOCK:-0}
  TOP=$(pick next_actions | jq -r '.actions[0:3][]? | "  • [\(.priority)] \(.description)"' 2>/dev/null | cut -c1-100)
  NVOICE=$(pick inbox_sync | jq -r '.synced // 0' 2>/dev/null);                      NVOICE=${NVOICE:-0}
  NQ=$(pick queue_sync | jq -r '.synced // 0' 2>/dev/null);                          NQ=${NQ:-0}
  NISS=$(pick list_issues | jq -r '.issues | length' 2>/dev/null);                   NISS=${NISS:-0}
  CTX="DECIBEL ${PROJECT_ID}: ${NISS} open issues (${BLOCK} blocking) · voice ${NVOICE} · queue ${NQ} · ${NACT} next actions:
${TOP}"
  jq -cn --arg ctx "$CTX" '{hookSpecificOutput:{hookEventName:"SessionStart",additionalContext:$ctx}}'
else
  # Daemon not running — fall back to nudge
  printf '%s' "{\"hookSpecificOutput\":{\"hookEventName\":\"SessionStart\",\"additionalContext\":\"DECIBEL SESSION INIT: Daemon not reachable. Run these tools now before doing anything else: 1. oracle next_actions (project_id: ${PROJECT_ID}) 2. voice inbox_sync (project_id: ${PROJECT_ID}) 3. agentic queue_sync (project_id: ${PROJECT_ID}) 4. sentinel list_issues (project_id: ${PROJECT_ID}, status: open). Do NOT skip these.\"}}"
fi
