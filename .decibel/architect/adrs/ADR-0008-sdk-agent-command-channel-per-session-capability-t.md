---
id: ADR-0008
projectId: decibel-tools-mcp
status: accepted
created_at: 2026-06-15T20:06:07.166Z
updated_at: 2026-06-15T20:06:07.166Z
---

# SDK agent command-channel: per-session capability tokens

## Context

The new @decibelsystems/tools/hq SDK (defineAgent) lets any local runtime (hermes/openclaw/codex/cursor/custom) register with the daemon and receive HQ->agent commands over localhost HTTP, without holding Supabase credentials. The dispatcher enqueues commands targeting an SDK session into an in-memory inbox; the SDK polls GET /agents/commands and acks POST /agents/commands/ack; the daemon settles the hq.agent_commands row in Core via service_role.

The original design gated these endpoints on the localhost bind alone (req.socket.remoteAddress in {127.0.0.1, ::1}) and identified the session purely by a caller-supplied session_key. An adversarial security review (2026-06-15, 5 lenses) found that session_key is a GUESSABLE label, so any co-resident local process could (a) GET /agents/commands?session_key=<another runtime's key> to drain/read another runtime's HQ commands, and (b) POST /agents/commands/ack {id,status:'done',result:<forged>} to forge another runtime's command outcome — written to Core under service_role and displayed by HQ as authoritative. This is precisely the threat model the SDK creates: its whole premise is several local runtimes side by side. Bounded today by localhost-only, UUID command ids, single-org v1, and 'message' dispatch held behind a flag — but it is the security core of the feature. Tracked under EPIC-0033.

## Decision

Add a per-session capability token (proof-of-possession) on top of the localhost-bind principal. The daemon mints a random 32-byte hex token at /agents/register (and /agents/heartbeat), stores it in-memory keyed by session_key, and returns it to that one registrant. Poll and ack must present the token; the daemon verifies it timing-safe (timingSafeTokenCompare). Semantics: session_key answers "which inbox", the token proves "I'm the process that registered it".

Ack authorization maps command id -> owning session_key (recorded at enqueue, persists past drain) -> that session's token, so only the session a command was enqueued for can settle it. The org-id-first cross-org invariant is preserved on the new read path: InboxCommand carries org_id and drainCommands filters on it, so even a token-authenticated poll only ever receives its own org's commands. The empty-remoteAddress allowance was removed (a genuine TCP loopback connection always presents 127.0.0.1/::1). Token store is wiped on daemon restart; the SDK adopts a fresh token from the next heartbeat response, so it self-heals. Defense-in-depth: ack result blob capped at 64KB; error field coerced to string.

## Consequences

Closes the four high-severity cross-session findings (inbox drain IDOR, ack ownership bypass, result forgery, cross-session payload exposure) plus the org_id-on-inbox and empty-remoteAddress mediums.

SDK contract change (the SDK is unpublished, so no compatibility cost): /agents/register and /agents/heartbeat responses now include token; GET /agents/commands requires &token=; POST /agents/commands/ack requires token in the body. The token never leaves the daemon-SDK localhost boundary, so HQ's command-issue contract is unchanged — HQ writes rows to Core under RLS exactly as before.

Verified end-to-end against live Supabase + a real isolated-host test daemon: register->token->dispatch->poll(token)->onCommand->ack(token)->settle reaches DONE; poll/ack without (or with a wrong) token return 403. 16 new unit tests cover the inbox token registry, ack-owner map, and org guard.

Still OPEN and flagged to HQ for sign-off (out of this repo): HQ MUST HTML-escape agent presence fields (summary/agent/meta) before rendering the /agents board — they are untrusted, caller-supplied strings written to Core under service_role. Deferred (documented in the PR, not exploitable in daemon mode which binds 127.0.0.1): global session-map eviction cap, DECIBEL_PRESENCE_HOST validation, and verifying expire_stale_agent_commands sweeps 'delivered' rows.
