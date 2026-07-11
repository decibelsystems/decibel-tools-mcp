---
id: ISS-0112
projectId: decibel-tools-mcp
severity: med
status: open
created_at: 2026-07-11T15:44:43.453Z
---

# Array parameters serialized as strings in MCP facade tools (friction tags, roadmap objectives)

**Severity:** med
**Status:** open

## Details

Symptom: Facade tools that accept array-typed params receive them as strings and then call array methods on them, crashing or misbehaving.

Observed today (2026-07-11) across multiple tools:
- friction.log with tags[] → "tags.join is not a function" (handler got a string, called .join). Reproduced whether tags was passed as a JSON array literal or a comma-separated string. Workaround: omit tags.
- roadmap.link_epic with objectives[] → "Objective '[' not found in roadmap" (handler iterated the raw string "["OBJ-0002"]" character-by-character, first char '['). Workaround: omit objectives, so EPIC-0035 is on the roadmap but not linked to OBJ-0002.

Likely root cause: array params on these facades (which use additionalProperties passthrough) arrive as strings and are not JSON.parsed / normalized to arrays before use. Suspect a shared arg-coercion layer rather than per-tool bugs, given identical failure shape across friction and roadmap.

Impact: any array field on these facades is currently unusable via MCP — tags, objectives, and likely others (motivation[]/outcomes[]/acceptance_criteria[] on sentinel.log_epic happened to work, so the coercion may differ per handler — worth auditing which normalize and which don't).

Fix direction: normalize incoming array params (accept JSON string, comma-separated string, or real array) in the facade arg layer before handlers use them; add a regression test per array-typed param.

Follow-up once fixed: re-link EPIC-0035 to OBJ-0002 (roadmap.link_epic objectives: ["OBJ-0002"]).
