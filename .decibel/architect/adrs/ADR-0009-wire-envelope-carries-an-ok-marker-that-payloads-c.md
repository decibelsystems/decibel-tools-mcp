---
id: ADR-0009
projectId: decibel-tools-mcp
status: accepted
created_at: 2026-08-30T03:15:13.670Z
updated_at: 2026-08-30T03:15:13.670Z
related_epics: [EPIC-0038]
---

# Wire envelope carries an `ok` marker that payloads cannot overwrite

## Context

Every non-MCP surface — /call, /batch, the REST shorthands — returns a "status envelope". It was built as `wrapSuccess(data) => ({status: 'executed', ...data})`.

The payload spreads last. So any tool returning its own `status` overwrites the envelope's marker with a domain value, and a great many do: every sentinel issue (`open`, `closed`), every epic (`in_progress`), every queued job. Failure remained detectable only because `wrapError` builds the field explicitly.

The result is an envelope where failure is detectable and success is not. Every consumer independently discovered the same workaround — test `status === 'error'`, never `status === 'executed'` — and HQ's client carries a comment saying exactly that (daemon.ts:168). Nobody could ask the direct question "did this call succeed?".

Two live bugs traced to the collision:
- 22 REST sites derived the HTTP status code from the clobbered field, so a successful call whose payload legitimately reports `status: 'error'` (a job whose state is error) answered HTTP 400.
- FacadeClient's HTTP transport stripped the envelope with `const {status: _status, ...result}`, silently deleting the domain value from every record that has one. `read_issue` over HTTP came back with no `status` field at all.

Phase 4 of EPIC-0038 turns three-plus adapters into clients of this envelope. Whatever it says now gets encoded in all of them, which is why this was decided before Phase 4 rather than during it.

Three options were considered: nest the payload under `result` (clean, breaks HQ, the VS Code extension, the iOS app, FacadeClient and senken.pro simultaneously); leave it and document the negative test (free now, permanent afterwards); or add a non-colliding marker alongside the existing field.

## Decision

Add `ok: boolean` to the envelope. Keep `status` exactly as it behaves today.

`ok` is written LAST in wrapSuccess, so no payload field can overwrite it, and it is a boolean, so it cannot collide with any domain vocabulary. wrapError sets `ok: false` explicitly.

Consumers read `ok` when present and fall back to `status === 'error'` only when talking to a runtime old enough not to send it. That fallback is implemented once, in `envelopeFailed()`, rather than re-derived per client.

The envelope moves out of httpServer.ts into src/lib/envelope.ts. It is a contract between processes, not a detail of one server; httpServer was merely the only place that spoke it so far. Phase 4's adapters and the client SDK now import the same helpers, and the contract is unit-testable without booting a server.

Adding rather than replacing was chosen deliberately (Ben, 2026-08-30). Nesting the payload is the cleaner shape and remains available later, but it would require HQ, the extension, the iOS app and senken.pro to change in lockstep for a benefit that `ok` delivers on its own. Retiring the ambiguous `status` becomes a separate cleanup once consumers have moved.

## Consequences

GOOD:
- Success becomes a positive, reliable test for the first time.
- No consumer has to change. HQ, the extension, the iOS app and senken.pro keep working untouched; they migrate to `ok` when convenient.
- The HTTP status code now reflects whether the CALL failed, not what the payload happens to say about a domain object.
- FacadeClient stops eating the `status` field of every record it returns.
- One implementation of "did this fail?" instead of one per client.

COST / RISK:
- Two markers now exist and only one is trustworthy. That is strictly better than one untrustworthy marker, but it needs the comment in src/lib/envelope.ts to stay attached to the code, because the shape alone does not explain why `status` is there.
- A payload field genuinely named `ok` is now shadowed by the envelope. No tool does this today; a test pins the precedence so it fails loudly rather than silently if one ever does.
- The fallback path `status === 'error'` keeps the old ambiguity alive for old runtimes. Its limits are pinned in a test so they are visible rather than surprising.

FOLLOW-UP:
- Once HQ, the extension and the iOS app key off `ok`, decide whether `status` is retired or nested. That is a 3.x call, not a 3.0 one.
- Phase 4 adapters must import from src/lib/envelope.ts rather than re-implementing the check. This is the whole reason the module exists.
