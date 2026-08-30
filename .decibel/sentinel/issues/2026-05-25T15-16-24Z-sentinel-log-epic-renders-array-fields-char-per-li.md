---
uid: 019e5fb5-6684-7c08-b1c2-6e97f79b5e3a
id: 2026-05-25T15-16-24Z-sentinel-log-epic-renders-array-fields-char-per-li
projectId: decibel-tools-mcp
severity: high
status: open
created_at: 2026-05-25T15:16:24.324Z
---

# sentinel log_epic renders array fields char-per-line (corrupts epic .md; can hard-stop the calling agent)

**Severity:** high
**Status:** open

## Details

Reported by the machina peer (EPIC-0039) and reproduced in my own EPIC-0033 + EPIC-0034 this session.

SYMPTOM: log_epic's array fields (motivation, outcomes, acceptance_criteria) render ONE CHARACTER PER LINE in the epic .md body — e.g. `- [`, `- "`, `- s`, `- e`, ... (EPIC-0033 = 632 garbage lines, EPIC-0034 = 1003). Frontmatter + summary render fine; only array→`- ` list fields break.

CAUSE: a "list" field reaches the renderer as a STRING (the MCP facade passes array params as JSON-stringified arrays) and the renderer maps over the string's characters instead of array items. Same class as the `tags.join is not a function` failure seen earlier (tags arrived as a string).

FIX (per machina): before mapping a list field to `- ` lines, coerce — if it's a string, JSON.parse when it looks like an array (trimmed starts with `[`), else wrap as `[value]`; apply the same guard to `tags` before `.join`. Apply in log_epic (motivation/outcomes/acceptance_criteria/tags) and audit other facades that render array params (e.g. create_test_spec test_cases/policy_refs).

BLAST RADIUS (not cosmetic): the resulting wall of single-char lines tripped a content-filter / "policy violation" on machina's side and HARD-STOPPED the calling agent mid-write, aborting the session. So this bug can abort the caller, not just produce ugly output.

STATUS: my EPIC-0033/0034 bodies repaired by hand. Repro artifacts: git history of EPIC-0039 (machina) and EPIC-0033/0034 (this repo).
