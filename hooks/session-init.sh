#!/bin/bash
# Decibel session init — runs on Claude Code boot via SessionStart hook
# Calls 4 tools via daemon HTTP batch endpoint, falls back to nudge if daemon is down

PROJECT_ID=$(basename "$PWD")
# Discover the daemon port from ~/.decibel/daemon.meta (written by the daemon),
# matching HQ's vite.config discovery. Env var wins; fallback 4888 (the daemon default).
PORT="${DECIBEL_DAEMON_PORT:-$(python3 -c "import json,os;print(json.load(open(os.path.expanduser('~/.decibel/daemon.meta')))['port'])" 2>/dev/null || echo 4888)}"
URL="http://localhost:${PORT}/batch"

PAYLOAD="{
    \"calls\": [
      {\"facade\": \"oracle\", \"action\": \"next_actions\", \"params\": {\"project_id\": \"${PROJECT_ID}\"}},
      {\"facade\": \"voice\", \"action\": \"inbox_sync\", \"params\": {\"project_id\": \"${PROJECT_ID}\"}},
      {\"facade\": \"agentic\", \"action\": \"queue_sync\", \"params\": {\"project_id\": \"${PROJECT_ID}\"}},
      {\"facade\": \"sentinel\", \"action\": \"list_issues\", \"params\": {\"project_id\": \"${PROJECT_ID}\", \"status\": \"open\"}}
    ]
  }"

# Try the daemon batch endpoint, with retries.
# A cold daemon takes a moment to bind its port, and a single attempt loses that
# race often enough that the "not reachable" nudge fires while the daemon is fine
# — which then sends the session down the MCP fallback, where voice and agentic
# do not exist as tools at all. Retry before believing the daemon is down.
OK=0
for attempt in 1 2 3; do
  RESULT=$(curl -s -m 5 -X POST "$URL" -H "Content-Type: application/json" -d "$PAYLOAD" 2>/dev/null)
  if [ $? -eq 0 ] && printf '%s' "$RESULT" | grep -q '"status"'; then OK=1; break; fi
  [ "$attempt" -lt 3 ] && sleep 2
done

if [ "$OK" -eq 1 ]; then
  # Daemon responded — inject a COMPACT digest (counts + top 3 next actions), not raw JSON.
  # Select by action name (order-independent); printf (not echo) preserves JSON escapes.
  pick() { printf '%s' "$RESULT" | jq -r --arg a "$1" '.results[] | select(.action==$a) | .result.content[0].text' 2>/dev/null; }

  # Did this call actually SUCCEED — as opposed to not running, not existing on
  # this daemon, or returning an error payload?
  ok() {
    printf '%s' "$RESULT" \
      | jq -e --arg a "$1" '[.results[] | select(.action==$a)] | length == 1 and (.[0].result.isError // false) == false' \
      >/dev/null 2>&1
  }

  # Render a count that cannot lie about its own absence.
  #
  # `jq '.synced // 0'` was returning 0 for THREE different things: an empty
  # inbox, an error payload, and a facade this daemon does not serve at all.
  # A broken voice sync therefore rendered byte-identically to a quiet one —
  # which is the exact silent-zero shape as the voice incident that went
  # unnoticed for five and a half hours. A number here now means a real number
  # from a call that really ran; anything else says so out loud.
  #   $1 = action name, $2 = jq expression yielding the count
  num() {
    local txt n
    ok "$1" || { printf 'ERR'; return; }
    txt=$(pick "$1")
    [ -z "$txt" ] && { printf 'ERR'; return; }
    n=$(printf '%s' "$txt" | jq -r "$2" 2>/dev/null)
    case "$n" in
      ''|null) printf '?' ;;
      *[!0-9]*) printf 'ERR' ;;
      *) printf '%s' "$n" ;;
    esac
  }

  NACT=$(num next_actions '.actions | length')
  BLOCK=$(num next_actions '.friction_summary.blocking // 0')
  TOP=$(pick next_actions | jq -r '.actions[0:3][]? | "  \u2022 [\(.priority)] \(.description)"' 2>/dev/null | cut -c1-100)
  NVOICE=$(num inbox_sync '.synced // 0')
  NQ=$(num queue_sync '.synced // 0')
  NISS=$(num list_issues '.issues | length')

  # A sync that reports its own internal errors is not a clean sync either.
  # Only annotate a real count: "ERR" already says everything, and "ERR/ERRerr"
  # says it twice while looking like a bug in the hook.
  suffix() {  # $1 = base count, $2 = error count, $3 = label
    case "$1$2" in
      *[!0-9]*) printf '%s' "$1" ;;
      *) [ "$2" = "0" ] && printf '%s' "$1" || printf '%s/%s%s' "$1" "$2" "$3" ;;
    esac
  }
  NVOICE=$(suffix "$NVOICE" "$(num inbox_sync '.errors // 0')" err)
  NQ=$(suffix "$NQ" "$(num queue_sync '.failed // 0')" fail)

  # Name what did not run, so a partial init can never read as a whole one.
  DOWN=""
  for a in next_actions inbox_sync queue_sync list_issues; do
    ok "$a" || DOWN="${DOWN}${DOWN:+,}${a}"
  done

  CTX="DECIBEL ${PROJECT_ID}: ${NISS} open issues (${BLOCK} blocking) · voice ${NVOICE} · queue ${NQ} · ${NACT} next actions:
${TOP}"
  [ -n "$DOWN" ] && CTX="${CTX}
  ⚠ INIT INCOMPLETE — these did not run: ${DOWN}. Run them via MCP or say so; do NOT report a 4-of-4 init."
  jq -cn --arg ctx "$CTX" '{hookSpecificOutput:{hookEventName:"SessionStart",additionalContext:$ctx}}'
else
  # Daemon not running — fall back to nudge
  printf '%s' "{\"hookSpecificOutput\":{\"hookEventName\":\"SessionStart\",\"additionalContext\":\"DECIBEL SESSION INIT: Daemon not reachable. Run these tools now before doing anything else: 1. oracle next_actions (project_id: ${PROJECT_ID}) 2. voice inbox_sync (project_id: ${PROJECT_ID}) 3. agentic queue_sync (project_id: ${PROJECT_ID}) 4. sentinel list_issues (project_id: ${PROJECT_ID}, status: open). Do NOT skip these.\"}}"
fi
