#!/usr/bin/env bash
# ============================================================================
# Install the agentic stop-hook into ~/.claude/ so it works across every
# project on this machine, independent of where decibel-tools-mcp lives.
#
# What this does (idempotent — safe to re-run):
#   1. Copies scripts/agentic-stop-hook.mjs → ~/.claude/scripts/
#   2. Ensures ~/.claude/package.json + node_modules/yaml exist so the script
#      can resolve its one external dep regardless of cwd
#   3. Prints the exact JSON snippet to add to ~/.claude/settings.json (does
#      NOT edit settings.json automatically — it may already contain other
#      hooks and merging JSON safely is the user's call)
#
# After running this once, opt any individual repo in with:
#     mkdir -p .decibel/agentic && touch .decibel/agentic/auto-pickup.on
#
# See docs/AGENTIC-STOP-HOOK-SETUP.md for the full story.
# ============================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT_SRC="$REPO_ROOT/scripts/agentic-stop-hook.mjs"
CLAUDE_DIR="$HOME/.claude"
SCRIPT_DST="$CLAUDE_DIR/scripts/agentic-stop-hook.mjs"

if [ ! -f "$SCRIPT_SRC" ]; then
  echo "ERROR: cannot find $SCRIPT_SRC" >&2
  echo "       run this from a checkout of decibel-tools-mcp" >&2
  exit 1
fi

echo "→ Installing global agentic stop-hook into $CLAUDE_DIR"

# 1. Copy the script
mkdir -p "$CLAUDE_DIR/scripts"
if [ -f "$SCRIPT_DST" ] && cmp -s "$SCRIPT_SRC" "$SCRIPT_DST"; then
  echo "  ✓ $SCRIPT_DST already up-to-date"
else
  cp "$SCRIPT_SRC" "$SCRIPT_DST"
  chmod +x "$SCRIPT_DST"
  echo "  ✓ copied to $SCRIPT_DST"
fi

# 2. Ensure yaml is resolvable from ~/.claude
if [ -d "$CLAUDE_DIR/node_modules/yaml" ]; then
  echo "  ✓ yaml dep already installed in $CLAUDE_DIR/node_modules"
else
  echo "  → installing yaml in $CLAUDE_DIR"
  # npm init -y fails on ".claude" (leading dot), so write package.json directly.
  if [ ! -f "$CLAUDE_DIR/package.json" ]; then
    cat > "$CLAUDE_DIR/package.json" <<'PKG'
{
  "private": true,
  "description": "Local deps for ~/.claude/scripts/ hooks",
  "dependencies": {}
}
PKG
  fi
  (cd "$CLAUDE_DIR" && npm install yaml --silent 2>&1 | tail -3)
  echo "  ✓ yaml installed"
fi

# 3. Verify the script can run end-to-end from its new location
echo "→ Smoke-testing the script"
if echo '' | node "$SCRIPT_DST" 2>&1 | grep -q "ERR_MODULE_NOT_FOUND"; then
  echo "  ✗ script still cannot resolve yaml — investigate $CLAUDE_DIR/node_modules" >&2
  exit 2
fi
echo "  ✓ script runs cleanly (silent no-op outside a decibel project — expected)"

# 4. Show the settings.json snippet the user should ensure is present
HOOK_CMD='test -f $HOME/.claude/scripts/agentic-stop-hook.mjs && node $HOME/.claude/scripts/agentic-stop-hook.mjs || true'
SETTINGS="$CLAUDE_DIR/settings.json"
echo
if [ -f "$SETTINGS" ] && grep -q "agentic-stop-hook.mjs" "$SETTINGS"; then
  if grep -q "\$HOME/.claude/scripts/agentic-stop-hook.mjs" "$SETTINGS"; then
    echo "✓ $SETTINGS already points at the global script. Nothing else to do."
  else
    echo "⚠ $SETTINGS references a different copy of agentic-stop-hook.mjs."
    echo "  Update the Stop hook command line to:"
    echo
    echo "      \"command\": \"$HOOK_CMD\""
  fi
else
  echo "ℹ Add this Stop-hook entry to $SETTINGS:"
  cat <<JSON

  {
    "hooks": {
      "Stop": [
        {
          "hooks": [
            {
              "type": "command",
              "command": "$HOOK_CMD"
            }
          ]
        }
      ]
    }
  }
JSON
  echo "  (If settings.json already has other hooks, merge — don't overwrite.)"
fi

echo
echo "→ Done. To opt a specific repo into auto-pickup, run inside that repo:"
echo "      mkdir -p .decibel/agentic && touch .decibel/agentic/auto-pickup.on"
