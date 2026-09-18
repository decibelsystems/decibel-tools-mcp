---
uid: 01a03b4b-4183-79d4-838c-506cb40f348f
id: ISS-0137
projectId: decibel-tools-mcp
severity: med
status: open
created_at: 2026-08-25T23:39:42.851Z
---

# Split internal-only commands out of the public plugin surface

**Severity:** med
**Status:** open

## Details

Ben, 2026-08-25: "potentially pull out decibel only skills as it's confusing to have them in there for public non use."

WHAT ACTUALLY SHIPS, checked rather than assumed — the two command directories have different audiences and only one is public:

PUBLIC (`commands/`, auto-included by the Claude Code plugin at .claude-plugin/plugin.json):
  decibel-pr.md         "PR review with auto-tracking to decibel"
  decibel-review.md     "Code review with auto-tracking to decibel"
  decibel-security.md   "Security review with auto-tracking to decibel"
  designer-decision.md  Record a design decision
  designer-principle.md Create or update a design principle
  designer-review.md    Review a Figma component against design principles
  designer-sync.md      Sync design tokens from Figma
  init.md, next.md, roadmap.md, scan.md, status.md

LOCAL ONLY (`.claude/commands/` — NOT in the plugin, NOT in package.json `files`):
  decibel, feedback, idea, inbox, investigate, preflight, research, ship, status

That second set is the one visible in this repo's own sessions and is ALREADY private — it never reaches a plugin user. So if the confusion came from seeing those in a session list, no change is needed for them. The real public surface to prune is `commands/`.

SUGGESTED TRIAGE of `commands/` (needs Ben's call, not obvious):
- KEEP — these drive public MCP tools and are the plugin's point: init (project_init), next (oracle_next_actions), roadmap (oracle_roadmap), scan (sentinel_scan), status (project_status).
- LIKELY PULL — decibel-pr / decibel-review / decibel-security. They duplicate Claude Code's built-in /code-review and /security-review while adding Decibel-internal tracking, so a public user gets two overlapping review commands and the worse one is ours. This repo's own CLAUDE.md ranks built-in review plugins LAST, which makes shipping our variants to strangers the wrong default.
- NEEDS A CALL — designer-review and designer-sync require a Figma URL plus configured tokens, so they dead-end for a user who has neither; designer-decision and designer-principle work standalone and are fine.

MECHANISM: package.json `files` is ["dist","templates","README.md","LICENSE"], so npm is unaffected either way — this is purely the plugin path. Options are (a) delete the internal ones, (b) move them to `.claude/commands/` so they stay available here but stop shipping, or (c) keep them but gate on a Decibel-internal marker. (b) is the cheapest and loses nothing locally.

NOT A BUG — nothing is broken; this is public-surface curation. Filed so it survives the session.
