---
uid: 01a0b695-54e5-7f51-8578-6cb5ee754245
id: ISS-0171
projectId: decibel-tools-mcp
severity: high
status: open
priority: high
tags:
  - security
  - tier-gating
  - studio
  - httpServer
  - pr-75
  - billing
created_at: 2026-09-18T22:13:55.045Z
---
# The studio REST tier guard covers only /api/generate-*, leaving four billed 3D endpoints open to core tier

**Severity:** high
**Status:** open

## Details

SYMPTOM. An unlicensed (core-tier) HTTP caller is refused flux and kling, and
can still trigger billed Meshy and Tripo generation.

THE GUARD (src/httpServer.ts:2043, added by PR #75, commit d91a919):

    if (path.startsWith('/api/generate-') && req.method === 'POST') {
      const tier = await resolveTier(req, configLicenseKey);
      if (tier === 'core') { 403 TIER_REQUIRED }
    }

Its own comment says "Enforce it here once for all /api/generate-* routes" —
and that is exactly what it does. The studio REST surface is wider than that
prefix.

COVERED (4):
  /api/generate-flux-kontext-image    2052
  /api/generate-kling-video           2272
  /api/generate-kling-text-video      2307
  /api/generate-kling-avatar          2340

NOT COVERED (4) — all POST, all calling pro-tier studio tools directly:
  /api/meshy/generate         2114  -> meshyGenerate   2136
  /api/meshy/download         2168  -> meshyDownload   2178
  /api/tripo/generate         2196  -> tripoGenerate   2216
  /api/tripo/download/:id     2248  -> tripoDownload   2254

Verified: no inline tier check exists in any of those four handler bodies.

WHY IT MATTERS. These REST shortcuts exist precisely BECAUSE they bypass kernel
dispatch, which is where tier gating normally lives — that is the reason the
guard was written. So the bypass the guard was created to close is still open
for half the surface, and the half left open is the one that spends money with
a third party (Meshy and Tripo are paid 3D generation APIs). The naming is what
hid it: a prefix match reads like a category, and meshy/tripo are the same
category under a different spelling.

FIX. Guard by route list or by the tool being called, not by path prefix — a
prefix match cannot be audited against "which routes reach a pro tool". The
durable version is to make these shortcuts dispatch through the kernel like
everything else, which is what CLAUDE.md's MCP-infrastructure rules already ask
for ("the executeDojoTool switch is legacy; new tools should go through the
modular map").

FOUND BY. Post-merge review of PR #75, 2026-09-18. Independently verified
against the source before filing.
