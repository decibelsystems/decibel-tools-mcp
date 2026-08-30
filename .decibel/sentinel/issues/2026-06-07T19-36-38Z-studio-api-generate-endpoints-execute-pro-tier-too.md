---
uid: 019ea396-52e9-76ba-90b2-7ece747bee84
id: 2026-06-07T19-36-38Z-studio-api-generate-endpoints-execute-pro-tier-too
projectId: decibel-tools-mcp
severity: med
status: open
created_at: 2026-06-07T19:36:38.377Z
---

# Studio /api/generate-* endpoints execute pro-tier tools without a tier check (crucible re-run)

**Severity:** med
**Status:** open

## Details

Found by crucible re-run (2026-06-07), verified: the direct REST endpoints /api/generate-flux-kontext-image, /api/generate-kling-video, /api/generate-kling-text-video (httpServer.ts ~1779+) invoke studio (pro-tier) generation tools directly, NOT through the kernel facade dispatch path that enforces tier gating. So they bypass the pro/apps tier check that /call + /mcp now enforce. They ARE below the hosted fail-closed auth gate (so anonymous hosted access is blocked by commit fdd2822), but an authenticated CORE-tier caller can still invoke pro studio tools via these shortcuts. Fix: route these endpoints through the kernel (so tier enforcement applies) or add an explicit resolveTier()/tier guard before invoking the studio tool. Pre-existing (not introduced by the sec-review changes). Lower priority than the auth/queue findings. Report: .crucible/runs/20260607T193352Z-attack.

NOTE: the re-run's "CRITICAL: /api/status and /api/projects bypass the hosted auth gate" finding was a FALSE POSITIVE — those route paths do not exist in the code (adversary hallucinated them); the real /api/* routes (/api/tools, /api/inbox, /api/generate-*) all sit below the auth gate and are covered by the hosted fail-closed fix. The tier-check gap above is the real residual in that area.
