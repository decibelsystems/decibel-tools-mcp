---
projectId: decibel-tools-mcp
severity: med
status: closed
created_at: 2026-06-07T19:36:38.377Z
closed_at: 2026-09-17T00:43:00.356Z
linked_commits:
  - sha: d91a919245b6405e8247c46a2b2b9b86818b538c
    shortSha: d91a919
    message: "fix(security): fail-closed tier gating in kernel + studio REST tier
      guard; ship guardian push gate"
    relationship: fixes
    linked_at: 2026-09-17T00:43:03.861Z
    linked_by: ai:claude
updated_at: 2026-09-17T00:43:03.861Z

---

# Studio /api/generate-* endpoints execute pro-tier tools without a tier check (crucible re-run)

**Severity:** med
**Status:** closed

## Details

Found by crucible re-run (2026-06-07), verified: the direct REST endpoints /api/generate-flux-kontext-image, /api/generate-kling-video, /api/generate-kling-text-video (httpServer.ts ~1779+) invoke studio (pro-tier) generation tools directly, NOT through the kernel facade dispatch path that enforces tier gating. So they bypass the pro/apps tier check that /call + /mcp now enforce. They ARE below the hosted fail-closed auth gate (so anonymous hosted access is blocked by commit fdd2822), but an authenticated CORE-tier caller can still invoke pro studio tools via these shortcuts. Fix: route these endpoints through the kernel (so tier enforcement applies) or add an explicit resolveTier()/tier guard before invoking the studio tool. Pre-existing (not introduced by the sec-review changes). Lower priority than the auth/queue findings. Report: .crucible/runs/20260607T193352Z-attack.

NOTE: the re-run's "CRITICAL: /api/status and /api/projects bypass the hosted auth gate" finding was a FALSE POSITIVE — those route paths do not exist in the code (adversary hallucinated them); the real /api/* routes (/api/tools, /api/inbox, /api/generate-*) all sit below the auth gate and are covered by the hosted fail-closed fix. The tier-check gap above is the real residual in that area.

## Resolution

Fixed in commit d91a919: one resolveTier guard before the Studio section returns 403 TIER_REQUIRED for core-tier callers on every POST /api/generate-* route.
