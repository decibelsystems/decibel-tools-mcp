---
projectId: decibel-tools-mcp
severity: high
status: closed
created_at: 2026-06-04T23:51:44.007Z
closed_at: 2026-09-17T00:42:07.621Z
linked_commits:
  - sha: 19415c72098c66d3af237575dd407fc603b75e98
    shortSha: 19415c7
    message: "fix(security): close crucible sec-review findings
      (tier/CORS/events/queue/kernel)"
    relationship: fixes
    linked_at: 2026-09-17T00:42:44.046Z
    linked_by: ai:claude
updated_at: 2026-09-17T00:42:44.046Z

---

# Kernel tier guard bypassable when a pro tool's name doesn't prefix-match its facade (crucible)

**Severity:** high
**Status:** closed

## Details

Found by crucible (2026-06-04), VERIFIED against src/kernel.ts dispatch tier-enforcement. The core-tier guard for DIRECT tool calls derives the facade from `const facadePrefix = name.split('_')[0]; facadeMap.get(facadePrefix)`. When a pro/apps facade has internal tools whose names do NOT start with `${facade.name}_`, facadeMap.get(prefix) returns undefined → the tier check is skipped → dispatch falls through to toolMap and the pro tool runs for a core-tier caller. Studio tool names (kling_*, tripo_*, meshy_* under the `studio` facade) are exactly this shape. Chained with the NODE_ENV tier bypass (existing issue 2026-04-29...) the whole pro surface is reachable unauthenticated.

FIX: don't infer the facade from the tool-name prefix. Maintain a tool→facade (and tool→tier) reverse map built from the facade registry, and resolve tier from that for direct tool calls. Report: .crucible/runs/20260604T235029Z-attack/attack_report.md

## Resolution

Fixed in commit 19415c7: kernel direct-tool tier check uses an exact tool->facade reverse map instead of name.split('_')[0]. Verified 2026-09-16.
