---
projectId: decibel-tools-mcp
severity: high
status: open
created_at: 2026-06-04T23:51:44.007Z
---

# Kernel tier guard bypassable when a pro tool's name doesn't prefix-match its facade (crucible)

**Severity:** high
**Status:** open

## Details

Found by crucible (2026-06-04), VERIFIED against src/kernel.ts dispatch tier-enforcement. The core-tier guard for DIRECT tool calls derives the facade from `const facadePrefix = name.split('_')[0]; facadeMap.get(facadePrefix)`. When a pro/apps facade has internal tools whose names do NOT start with `${facade.name}_`, facadeMap.get(prefix) returns undefined → the tier check is skipped → dispatch falls through to toolMap and the pro tool runs for a core-tier caller. Studio tool names (kling_*, tripo_*, meshy_* under the `studio` facade) are exactly this shape. Chained with the NODE_ENV tier bypass (existing issue 2026-04-29...) the whole pro surface is reachable unauthenticated.

FIX: don't infer the facade from the tool-name prefix. Maintain a tool→facade (and tool→tier) reverse map built from the facade registry, and resolve tier from that for direct tool calls. Report: .crucible/runs/20260604T235029Z-attack/attack_report.md
