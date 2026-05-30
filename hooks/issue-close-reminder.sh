#!/bin/bash
# Decibel completion ritual — PostToolUse hook.
# After a SUCCESSFUL `git commit`, this:
#   1. Auto-closes any issue named in a `Closes:` / `Fixes:` / `Resolves:` commit trailer
#      (deterministic — the close happens whether or not the agent "remembers").
#   2. Auto-links the commit to artifacts (best effort).
#   3. Reminds to use Closes: trailers — ONE line, AT MOST once per session, never a list.
# Counterpart to session-init.sh (the SessionStart ritual). Daemon discovery mirrors it.
# Always exits 0 and prints JSON (or {}) — never blocks the user's flow.

HOOK_INPUT=$(cat)

# Only Bash tool calls can be a git commit
TOOL_NAME=$(echo "$HOOK_INPUT" | jq -r '.tool_name // ""')
[ "$TOOL_NAME" = "Bash" ] || { printf '{}'; exit 0; }

CMD=$(echo "$HOOK_INPUT" | jq -r '.tool_input.command // ""')
EXIT_CODE=$(echo "$HOOK_INPUT" | jq -r '.tool_response.exit_code // .tool_response.exitCode // 0')

# Must be a git commit that succeeded
echo "$CMD" | grep -qE 'git[[:space:]]+commit' || { printf '{}'; exit 0; }
[ "$EXIT_CODE" = "0" ] || { printf '{}'; exit 0; }

CWD=$(echo "$HOOK_INPUT" | jq -r '.cwd // "."')
PROJECT=$(basename "$CWD")
PORT="${DECIBEL_DAEMON_PORT:-$(jq -r '.port // 4888' "$HOME/.decibel/daemon.meta" 2>/dev/null || echo 4888)}"
BATCH="http://localhost:${PORT}/batch"

SHA=$(git -C "$CWD" rev-parse --short HEAD 2>/dev/null || echo "")
SUBJECT=$(git -C "$CWD" log -1 --pretty=%s 2>/dev/null || echo "")
BODY=$(git -C "$CWD" log -1 --pretty=%B 2>/dev/null || echo "")

# Extract issue ids from Closes:/Fixes:/Resolves: trailers (one id per match)
IDS=$(echo "$BODY" | grep -ioE '(closes|fixes|resolves):[[:space:]]*[A-Za-z0-9._-]+' \
  | sed -E 's/^[^:]*:[[:space:]]*//' | sort -u)

CLOSED=""
for ID in $IDS; do
  RESP=$(curl -s -m 5 -X POST "$BATCH" -H 'Content-Type: application/json' \
    -d "{\"calls\":[{\"facade\":\"sentinel\",\"action\":\"close_issue\",\"params\":{\"project_id\":\"${PROJECT}\",\"issue_id\":\"${ID}\",\"resolution\":\"Resolved by commit ${SHA}: ${SUBJECT}\",\"status\":\"closed\"}}]}" 2>/dev/null)
  echo "$RESP" | grep -q '"status"' && CLOSED="${CLOSED} ${ID}"
done

# Link the commit to artifacts (best effort, non-fatal)
[ -n "$SHA" ] && curl -s -m 4 -X POST "$BATCH" -H 'Content-Type: application/json' \
  -d "{\"calls\":[{\"facade\":\"sentinel\",\"action\":\"auto_link\",\"params\":{\"project_id\":\"${PROJECT}\",\"commitSha\":\"${SHA}\"}}]}" >/dev/null 2>&1 || true

# --- Emit context SPARINGLY (token-lean) ---
# The auto-close above is free (curl, no model tokens). Only inject text when useful,
# and never dump issue lists into the conversation.
SESSION_ID=$(echo "$HOOK_INPUT" | jq -r '.session_id // "nosession"')
MARKER="$HOME/.decibel/runs/${SESSION_ID}/.close-nudged"
MSG=""

if [ -n "$CLOSED" ]; then
  # Terse confirmation only — one line, no list.
  MSG="DECIBEL: closed${CLOSED} (commit ${SHA})."
elif [ ! -f "$MARKER" ]; then
  # No trailer this commit. Remind about the convention AT MOST ONCE per session,
  # one line, count only (no titles). Skip silently if daemon is down or 0 open.
  COUNT=$(curl -s -m 4 -X POST "$BATCH" -H 'Content-Type: application/json' \
    -d "{\"calls\":[{\"facade\":\"sentinel\",\"action\":\"list_issues\",\"params\":{\"project_id\":\"${PROJECT}\",\"status\":\"open\"}}]}" 2>/dev/null \
    | jq -r '.results[0].result.content[0].text | fromjson | .issues | length' 2>/dev/null)
  if [ -n "$COUNT" ] && [ "$COUNT" != "0" ] && [ "$COUNT" != "null" ]; then
    mkdir -p "$(dirname "$MARKER")" 2>/dev/null && touch "$MARKER" 2>/dev/null
    MSG="DECIBEL: ${COUNT} open issue(s) in ${PROJECT}. If a commit resolves one, add a 'Closes: <id>' trailer (auto-closes) or run sentinel close_issue. (Shown once/session.)"
  fi
fi

if [ -n "$MSG" ]; then
  jq -cn --arg ctx "$MSG" '{hookSpecificOutput:{hookEventName:"PostToolUse",additionalContext:$ctx}}'
else
  printf '{}'
fi
exit 0
