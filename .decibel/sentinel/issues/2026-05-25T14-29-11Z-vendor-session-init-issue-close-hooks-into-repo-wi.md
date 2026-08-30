---
uid: 019e5f8a-2ade-73bf-8816-cb82f252ad7a
id: 2026-05-25T14-29-11Z-vendor-session-init-issue-close-hooks-into-repo-wi
projectId: decibel-tools-mcp
severity: med
status: closed
created_at: 2026-05-25T14:29:11.006Z
closed_at: 2026-05-25T15:13:30.824Z
---

# Vendor session-init + issue-close hooks into repo with an installer (currently machine-local, untracked)

**Severity:** med
**Status:** closed

## Details

The two Claude Code hooks are hand-maintained at ~/.decibel/hooks/ and not version-controlled anywhere. Vendor them into decibel-tools-mcp (e.g. hooks/) + ship an installer. Pairs with the discovery/port issue 2026-05-23T23-32-49Z (the installer should also kill the stale 4888 default).

LIVE, WORKING SOURCE (copy from these — they're verified):
- ~/.decibel/hooks/session-init.sh — SessionStart. Discovers daemon port from ~/.decibel/daemon.meta (fallback 4888); POST /batch for oracle.next_actions, voice.inbox_sync, agentic.queue_sync, sentinel.list_issues; injects a COMPACT digest (counts + top 3 next actions, ~93 tok) or a nudge if daemon down.
- ~/.decibel/hooks/issue-close-reminder.sh — PostToolUse(Bash). On a successful `git commit`: auto-closes issues named in Closes:/Fixes:/Resolves: trailers via sentinel.close_issue, auto_links the commit, and (once per session, one line) reminds about open issues.

INSTALLER should: copy/symlink both into ~/.decibel/hooks/, register them in ~/.claude/settings.json (SessionStart → session-init.sh; PostToolUse matcher "Bash" → issue-close-reminder.sh), and add the CLAUDE.md convention line (commit trailer `Closes: <issue-id>` auto-closes).

DESIGN CONSTRAINTS to preserve (learned the hard way):
- Token-lean output: never dump raw JSON or full issue lists into context; counts + top 3 only; nudges once/session.
- Port discovery via daemon.meta (not hardcoded).
- Facade action names are snake_case (list_issues, not listIssues).
- Use printf '%s' (not echo) when piping daemon JSON to jq — zsh echo mangles \n/\" escapes; bash echo is fine but printf is safe in both.

## Resolution

Resolved by commit 1663523: chore(hooks): vendor session-init + issue-close hooks + installer
