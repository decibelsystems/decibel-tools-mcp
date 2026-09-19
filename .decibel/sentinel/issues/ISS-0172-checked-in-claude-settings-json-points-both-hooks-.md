---
uid: 01a0b695-8615-7f41-9223-80347c107a34
id: ISS-0172
projectId: decibel-tools-mcp
severity: high
status: closed
priority: high
tags:
  - hooks
  - config
  - portability
  - pr-75
  - silent-failure
created_at: 2026-09-18T22:14:07.637Z
updated_at: 2026-09-19T00:38:28.410Z
closed_at: 2026-09-19T00:38:12.045Z
resolution: "Resolved by commit 1c0d9ea: Stop hardcoding one machine's paths,
  and unfreeze the epics that hid behind them"
linked_commits:
  - sha: f7360ff74b773293582e0e0767b02666aad9276f
    shortSha: f7360ff
    message: "sentinel: PR #75 review findings — ISS-0171, ISS-0172, ISS-0173"
    relationship: related
    linked_at: 2026-09-18T22:14:49.508Z
    linked_by: ai:claude
  - sha: 7fa43da13b19c6f3931df06c225745a2ce989027
    shortSha: 7fa43da
    message: "sentinel: auto-linked commit metadata for ISS-0170 and ISS-0172"
    relationship: related
    linked_at: 2026-09-19T00:38:28.410Z
    linked_by: ai:claude

---
# Checked-in .claude/settings.json points both hooks at an absolute path on one developer's machine

**Severity:** high
**Status:** closed

## Details

SYMPTOM. .claude/settings.json, committed by PR #75, registers both command
hooks with a hardcoded absolute path:

  :9   "command": "bash \"/media/hiro/AI_Drive/Linux/Projects/Round_3/decibel-tools-mcp/hooks/session-init.sh\""
  :46  "command": "bash \"/media/hiro/AI_Drive/Linux/Projects/Round_3/decibel-tools-mcp/hooks/issue-close-reminder.sh\""

/media/hiro does not exist on this macOS checkout — verified. It is a Linux
mount point on the author's machine. Every other clone runs a failing
SessionStart hook on boot and a failing PostToolUse hook after EVERY Bash call.

IT FAILS QUIETLY. A hook whose command cannot be found produces no digest and
no error the user sees, which is indistinguishable from a daemon being down —
and the fallback text for that case says "Daemon not reachable", sending the
session to the MCP fallback where voice and agentic do not exist as tools.
The one failure mode the session-init nudge was written to prevent.

THE SAME PR GOT IT RIGHT NEXT DOOR. hooks/hooks.json, added in the same commit,
uses the portable form:

  "command": "bash \"${CLAUDE_PLUGIN_ROOT}/hooks/session-init.sh\""

So the plugin manifest already registers both hooks correctly. That makes
.claude/settings.json redundant at best.

SECOND EFFECT, on a machine where the path DOES resolve and the plugin is also
installed: both registrations fire. close_issue and auto_link then run twice
per commit, and the session digest is injected twice. Given ISS-0168 — where
closing an already-closed issue overwrites its resolution — a double-fire is
not harmless.

FIX. Drop .claude/settings.json's command hooks (the plugin manifest covers
them), or rewrite them with $CLAUDE_PROJECT_DIR. Then check that no other
checked-in config carries a machine-specific path.

FOUND BY. Post-merge review of PR #75, 2026-09-18. Verified on this checkout.

## Resolution

Resolved by commit 1c0d9ea: Stop hardcoding one machine's paths, and unfreeze the epics that hid behind them
