#!/bin/bash
# ============================================================================
# Decibel Claude Code hooks installer
# ============================================================================
# Symlinks the vendored hooks into ~/.decibel/hooks/ and registers them in
# ~/.claude/settings.json (idempotent, backed up). Re-runnable. Requires jq.
#
#   SessionStart        -> session-init.sh          (daemon.meta port discovery
#                                                     + compact ~93-tok digest)
#   PostToolUse (Bash)  -> issue-close-reminder.sh  (Closes:/Fixes:/Resolves:
#                                                     trailer auto-close + lean nudge)
#
# Single source of truth = this repo's hooks/. ~/.decibel/hooks/ symlinks back
# here, so editing the vendored files (or `git pull`) updates the live hooks.
# ============================================================================

set -euo pipefail

REPO_HOOKS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="$HOME/.decibel/hooks"
SETTINGS="$HOME/.claude/settings.json"
HOOKS=(session-init.sh issue-close-reminder.sh)

command -v jq >/dev/null 2>&1 || { echo "error: jq is required to register hooks in $SETTINGS" >&2; exit 1; }

# 1) Symlink the vendored hooks into ~/.decibel/hooks/ (repo = source of truth)
mkdir -p "$DEST"
for h in "${HOOKS[@]}"; do
  chmod +x "$REPO_HOOKS/$h"
  ln -sf "$REPO_HOOKS/$h" "$DEST/$h"
  echo "linked  $DEST/$h -> $REPO_HOOKS/$h"
done

SI="$DEST/session-init.sh"
IC="$DEST/issue-close-reminder.sh"

# 2) Register in ~/.claude/settings.json (idempotent; key on the command path)
mkdir -p "$(dirname "$SETTINGS")"
[ -f "$SETTINGS" ] || echo '{}' > "$SETTINGS"
BACKUP="$SETTINGS.bak.$(date +%Y%m%d%H%M%S)"
cp "$SETTINGS" "$BACKUP"

tmp="$(mktemp)"
jq --arg si "$SI" --arg ic "$IC" '
  .hooks //= {}
  | .hooks.SessionStart //= []
  | .hooks.PostToolUse //= []
  | (if ([.hooks.SessionStart[]?.hooks[]?.command] | any(. == $si))
       then .
       else .hooks.SessionStart += [ { "hooks": [ { "type": "command", "command": $si } ] } ]
     end)
  | (if ([.hooks.PostToolUse[]?.hooks[]?.command] | any(. == $ic))
       then .
       else .hooks.PostToolUse += [ { "matcher": "Bash", "hooks": [ { "type": "command", "command": $ic } ] } ]
     end)
' "$SETTINGS" > "$tmp" && mv "$tmp" "$SETTINGS"

echo "registered hooks in $SETTINGS (backup: $BACKUP)"
echo
echo "Done. Convention: add a 'Closes: <issue-id>' trailer to commit messages and the"
echo "completion hook auto-closes the issue (Fixes:/Resolves: also work). See hooks/README.md."
