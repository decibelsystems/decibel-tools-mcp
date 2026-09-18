---
uid: 01a07d17-e2de-73ce-bb93-d3b1cf32203b
id: ISS-0163
projectId: decibel-tools-mcp
severity: high
status: open
priority: high
tags:
  - cloud
  - multi-tenant
  - dead-code
  - adr-0007
  - silent-zero
created_at: 2026-09-07T18:18:32.542Z
---
# The multi-tenant store is unreachable — X-Org-Key threads into the kernel and is then dropped

**Severity:** high
**Status:** open

## Details

SYMPTOM. The hosted/multi-tenant path reads as implemented and is not. It is the release's own failure shape — a surface that looks live and answers as if nothing is wrong.

EVIDENCE (verified 2026-09-07, not recalled).

1. `src/store/` is entirely unreachable from live code. Nothing outside that directory imports `src/store/index.ts`. The only `getStore` hits elsewhere (`src/runtime/projectResolution.ts:80,92,105`) are `storage.getStore()` on AsyncLocalStorage — a different symbol, not the store factory.

2. `DECIBEL_STORE` is therefore inert. `src/store/index.ts:23` reads `process.env.DECIBEL_STORE || 'fs'` to choose between `FsStore` and `SupabaseStore`, but the module holding that switch is never loaded. Setting `DECIBEL_STORE=supabase` selects nothing.

3. `ctx.orgId` has exactly one consumer in the whole codebase: `src/store/supabaseStore.ts:59`, which is inside the unreachable module. Meanwhile the transport threads it faithfully — `X-Org-Key` is accepted at `src/httpServer.ts:387` and `:1396`, allowlisted in CORS at `:706`, and carried on `DispatchContext.orgId` (`src/kernel.ts:62-63`). A hosted caller can send a tenant id, have it validated and threaded through dispatch, and have nothing use it.

4. Separately: the one place org-scoping IS live is not multi-tenant. `src/agentCommands.ts:42` and `src/agentPresence.ts:21` both define `ORG_ID = process.env.DECIBEL_ORG_ID || '1cb79e24-e06f-46c9-8a22-5ee025ffb0f4'` — a process-wide constant with a hardcoded default. `drainCommands(sessionKey, ORG_ID)` (`httpServer.ts:1161`) therefore scopes to one org per process. That is a tenant label on a single-tenant box, and the hardcoded fallback means a deployment that forgets `DECIBEL_ORG_ID` silently adopts that org id rather than refusing to start.

NOT A LIVE VULNERABILITY. Because nothing reads `ctx.orgId` for storage, there is no cross-tenant read path to leak through today. The hazard is entirely one of belief: ADR-0007 / EPIC-0033 is designed and stubbed, and the code reads as though it shipped.

WHAT TO DECIDE. Either wire the factory (and give `orgId` a required-and-checked contract at the dispatch boundary rather than inside the store), or make the dead path fail loudly — reject `X-Org-Key` with an explicit "multi-tenant storage is not enabled in this build" rather than accepting and discarding it. The second is cheap and is the option consistent with 3.0's own principle.

Relates to the src/store dead-code trap already recorded in project memory: only `markdown.ts` is reachable, and `fsStore.ts` has previously caused a confirmed misdiagnosis.
