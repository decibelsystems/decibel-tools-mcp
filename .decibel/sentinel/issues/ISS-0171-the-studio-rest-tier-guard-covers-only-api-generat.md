---
uid: 01a0b695-54e5-7f51-8578-6cb5ee754245
id: ISS-0171
projectId: decibel-tools-mcp
severity: high
status: open
priority: medium
tags:
  - security
  - tier-gating
  - studio
  - httpServer
  - pr-75
  - billing
created_at: 2026-09-18T22:13:55.045Z
linked_commits:
  - sha: f7360ff74b773293582e0e0767b02666aad9276f
    shortSha: f7360ff
    message: "sentinel: PR #75 review findings — ISS-0171, ISS-0172, ISS-0173"
    relationship: related
    linked_at: 2026-09-18T22:14:49.477Z
    linked_by: ai:claude
  - sha: 232372f804a178573cbca0a556d5690381007ae2
    shortSha: 232372f
    message: "sentinel+dojo: ISS-0171 was overstated — an entitlement bypass, not a
      billing hole"
    relationship: related
    linked_at: 2026-09-19T03:08:17.041Z
    linked_by: ai:claude
  - sha: eac801d3b6e36cab8fc885c558bbdd48cafef69b
    shortSha: eac801d
    message: "sentinel: auto-linked commit metadata for ISS-0171"
    relationship: related
    linked_at: 2026-09-19T10:17:17.309Z
    linked_by: ai:claude
updated_at: 2026-09-19T10:17:17.309Z

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

[2026-09-19] CORRECTION to this issue's own framing, and to how it was reported verbally. It was described as "a core-tier caller can spend money on third-party 3D generation". That is NOT true today, and the correction matters because it changes both the urgency and the reason to fix it.

Three gates stand between an unlicensed caller and a billed 3D generation. Only one is open.

1. REACHING THE SERVER — closed. In hosted (--http) mode, httpServer.ts:727 refuses every route outside PUBLIC_HOSTED_ROUTES with 401 AUTH_NOT_CONFIGURED when no DECIBEL_AUTH_TOKEN is set, and requires the token when one is. In daemon mode the bind is 127.0.0.1, so only local processes reach it. An anonymous internet caller cannot touch these routes at all. (CORS is irrelevant here — it is a browser control and curl ignores it.)

2. THE TIER CHECK — OPEN. This is the actual defect, unchanged: the guard matches path.startsWith('/api/generate-'), so /api/meshy/generate, /api/meshy/download, /api/tripo/generate and /api/tripo/download/:id never consult resolveTier, and no handler body checks tier inline.

3. ACTUALLY SPENDING MONEY — closed, for now. process3DTask in src/tools/studio/index.ts is a STUB. It advances a progress counter with setTimeout and returns https://placeholder.studio/model.glb. It calls no provider. There is no Meshy or Tripo key anywhere in src/ — the only provider keys that exist are OPENAI_API_KEY and TOGETHER_API_KEY, which serve the /api/generate-* routes, and those ARE guarded.

WHAT IS TRUE. An already-authenticated caller holding a core licence bypasses entitlement on four routes. That is a licensing hole, not an exposed door, and its current cost is zero.

WHY IT IS STILL WORTH FIXING, and arguably more interesting than the version that overstated it: the unguarded routes are unguarded BECAUSE nobody finished them. The guard was written around the routes that work. The day the real Meshy API is wired in behind that stub, this becomes a billing hole with nothing to announce it — no test fails, no route changes, no review is triggered, because the guard's shape was decided when the endpoint did nothing. The fix (a route table the S6 sweep enumerates FROM) is what makes finishing the feature safe rather than dangerous.

SEVERITY. Dropped from high priority to medium on the strength of gates 1 and 3. It should be raised again the moment process3DTask stops being a stub — that transition is the trigger, and it belongs in the acceptance criteria of whatever finishes it.

DOJO-PROP-0012 carries the same overstatement in its problem statement and needs the same correction.
