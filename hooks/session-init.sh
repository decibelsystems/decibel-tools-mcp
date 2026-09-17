#!/bin/bash
# Decibel session init — runs on Claude Code boot via SessionStart hook
# Calls 4 tools via daemon HTTP batch endpoint, falls back to nudge if daemon is down

PROJECT_ID=$(basename "$PWD")
# Discover the daemon port from ~/.decibel/daemon.meta (written by the daemon),
# matching HQ's vite.config discovery. Env var wins; fallback 4888 (the daemon default).
PORT="${DECIBEL_DAEMON_PORT:-$(jq -r '.port // empty' "$HOME/.decibel/daemon.meta" 2>/dev/null)}"
PORT="${PORT:-$(sed -n 's/^[[:space:]]*port:[[:space:]]*//p' "$HOME/.decibel/config.yaml" 2>/dev/null | head -1)}"
PORT="${PORT:-4888}"
URL="http://localhost:${PORT}/batch"
# Daemon auth token: env var wins, else daemon.auth_token from ~/.decibel/config.yaml.
TOKEN="${DECIBEL_AUTH_TOKEN:-$(sed -n 's/^[[:space:]]*auth_token:[[:space:]]*//p' "$HOME/.decibel/config.yaml" 2>/dev/null | head -1 | tr -d '"'"'"'')}"

# Try the daemon batch endpoint
RESULT=$(curl -s -m 5 -X POST "$URL" \
  -H "Content-Type: application/json" \
  ${TOKEN:+-H "Authorization: Bearer ${TOKEN}"} \
  -d "{
    \"calls\": [
      {\"facade\": \"oracle\", \"action\": \"next_actions\", \"params\": {\"project_id\": \"${PROJECT_ID}\"}},
      {\"facade\": \"voice\", \"action\": \"inbox_sync\", \"params\": {\"project_id\": \"${PROJECT_ID}\"}},
      {\"facade\": \"agentic\", \"action\": \"queue_sync\", \"params\": {\"project_id\": \"${PROJECT_ID}\"}},
      {\"facade\": \"sentinel\", \"action\": \"list_issues\", \"params\": {\"project_id\": \"${PROJECT_ID}\", \"status\": \"open\"}},
      {\"facade\": \"roadmap\", \"action\": \"read\", \"params\": {\"project_id\": \"${PROJECT_ID}\"}}
    ]
  }" 2>/dev/null)

# An auth/error envelope also carries "status", so require the results array.
if [ $? -eq 0 ] && printf '%s' "$RESULT" | grep -q '"results"'; then
  # Daemon responded — inject a COMPACT digest (counts + top 3 next actions), not raw JSON.
  # Select by action name (order-independent); printf (not echo) preserves JSON escapes.
  pick() { printf '%s' "$RESULT" | jq -r --arg a "$1" '.results[] | select(.action==$a) | .result.content[0].text' 2>/dev/null; }
  NACT=$(pick next_actions | jq -r '.actions | length' 2>/dev/null);                 NACT=${NACT:-0}
  BLOCK=$(pick next_actions | jq -r '.friction_summary.blocking // 0' 2>/dev/null);  BLOCK=${BLOCK:-0}
  TOP=$(pick next_actions | jq -r '.actions[0:3][]? | "  • [\(.priority)] \(.description)"' 2>/dev/null | cut -c1-100)
  NVOICE=$(pick inbox_sync | jq -r '.synced // 0' 2>/dev/null);                      NVOICE=${NVOICE:-0}
  NQ=$(pick queue_sync | jq -r '.synced // 0' 2>/dev/null);                          NQ=${NQ:-0}
  NISS=$(pick list_issues | jq -r '.issues | length' 2>/dev/null);                   NISS=${NISS:-0}
  # Roadmap position: the next milestone by target date (or the last one if all are past).
  # Empty when no roadmap exists, and the line is then omitted.
  ROAD=$(pick read | jq -r --arg today "$(date +%F)" '
    ([.milestones[]? | select(.target_date >= $today)] | sort_by(.target_date) | .[0]) as $next
    | ($next // ([.milestones[]?] | sort_by(.target_date) | last)) as $m
    | if $m == null then empty
      else "  ▸ roadmap: \($m.label) (due \($m.target_date), \($m.epics|length) epics) · \(.objectives|length) objectives · \(.summary.unhealthy_epics_count // 0) unhealthy epics"
      end' 2>/dev/null)
  CTX="DECIBEL ${PROJECT_ID}: ${NISS} open issues (${BLOCK} blocking) · voice ${NVOICE} · queue ${NQ} · ${NACT} next actions:
${TOP}${ROAD:+
$ROAD}"
  jq -cn --arg ctx "$CTX" '{hookSpecificOutput:{hookEventName:"SessionStart",additionalContext:$ctx}}'
else
  # Daemon not running — fall back to nudge
  printf '%s' "{\"hookSpecificOutput\":{\"hookEventName\":\"SessionStart\",\"additionalContext\":\"DECIBEL SESSION INIT: Daemon not reachable. Run these tools now before doing anything else: 1. oracle next_actions (project_id: ${PROJECT_ID}) 2. voice inbox_sync (project_id: ${PROJECT_ID}) 3. agentic queue_sync (project_id: ${PROJECT_ID}) 4. sentinel list_issues (project_id: ${PROJECT_ID}, status: open) 5. roadmap read (project_id: ${PROJECT_ID}) to see where the project is. Decibel is the project memory; your session memory is a cache. Do NOT skip these.\"}}"
fi
