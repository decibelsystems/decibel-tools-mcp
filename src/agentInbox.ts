// ============================================================================
// Agent command inbox — daemon-side delivery for SDK (non-broker) runtimes
// ============================================================================
// The HQ→agent command dispatcher (agentCommands.ts) delivers `message` to
// claude-peers sessions via the broker, and answers `request_status` from the
// broker's live registry. But SDK-registered runtimes (hermes/openclaw/codex/…
// from @decibelsystems/tools/hq) aren't in the broker — they have no transport.
//
// This module bridges that gap WITHOUT giving the SDK any Supabase creds (the
// "no service_role in untrusted hands" rule holds): the dispatcher ENQUEUES a
// command targeting a known SDK session here; the SDK polls GET /agents/commands
// + acks POST /agents/commands/ack (both localhost-only); the daemon settles the
// hq.agent_commands row in Core via service_role on ack.
//
// IDENTITY — capability token, NOT a bare label (security review 2026-06-15):
// session_key is a GUESSABLE label, so localhost-bind alone would let any
// co-resident local runtime drain/ack ANOTHER runtime's commands (the SDK's whole
// premise is several runtimes side-by-side). So the daemon mints a per-session
// SECRET token at /agents/register, returns it to that one SDK process, and
// requires it on poll + ack. session_key says "which inbox"; the token proves
// "I'm the process that registered it." The org-id-first cross-org invariant is
// preserved here too: InboxCommand carries org_id and drainCommands filters on it,
// so even a token-authenticated poll only ever receives its own org's commands.
// ============================================================================

export interface InboxCommand {
  id: string;                 // hq.agent_commands.id (the ack key back to Core)
  org_id: string;             // owning org — drainCommands filters on this (cross-org guard)
  kind: string;               // 'message' | 'request_status'
  payload: Record<string, unknown>;
  enqueued_at: number;        // ms — for inbox TTL eviction
}

// session_key → its pending commands. In-memory: the daemon is the single
// authority for sessions it hosts; a restart re-derives state from Core (pending
// rows get re-dispatched on the next tick).
const inboxes = new Map<string, InboxCommand[]>();

// session_key → its per-session capability token (the secret an SDK must present
// on poll/ack to prove it's the registrant). Minted by the HTTP register/heartbeat
// handler; verified there too (timing-safe). Wiped on a daemon restart — the SDK's
// next heartbeat re-mints, and it stores the fresh token from the response.
const sessionTokens = new Map<string, string>();

// command id → the session_key it was enqueued for, with a timestamp for TTL
// eviction. The ack arrives AFTER drainCommands has already removed the command
// from the inbox, so the inbox itself can't tell us who owns an acked id — this
// map can. The ack handler maps id→session→token to authorize the settle.
const ackOwners = new Map<string, { sessionKey: string; at: number }>();

// Drop inbox entries an SDK never polled, so a vanished runtime doesn't leak
// memory. Slightly longer than the command expiry (5min) so a slow poller still
// gets it; the dispatcher's expiry sweep settles the Core row regardless.
const INBOX_TTL_MS = 6 * 60_000;
const MAX_PER_SESSION = 100; // backstop against unbounded growth per session

/**
 * Enqueue a command for an SDK session to poll. Idempotent on command id. Also
 * records the id→session ownership (for ack authorization). cmd.org_id is the
 * owning org; drainCommands only returns commands whose org matches the caller's.
 */
export function enqueueCommand(sessionKey: string, cmd: InboxCommand): void {
  const list = inboxes.get(sessionKey) ?? [];
  if (list.some((c) => c.id === cmd.id)) return; // already queued (keep first owner)
  list.push(cmd);
  // Trim oldest if a session somehow accumulates a flood (shouldn't happen).
  while (list.length > MAX_PER_SESSION) list.shift();
  inboxes.set(sessionKey, list);
  ackOwners.set(cmd.id, { sessionKey, at: cmd.enqueued_at });
}

/**
 * Drain pending commands for a session (returns + removes them). Evicts stale
 * first. Only returns commands belonging to `orgId` — a cross-org command (which
 * should never be enqueued here given the dispatcher's org-first filter) is
 * dropped, never delivered.
 */
export function drainCommands(sessionKey: string, orgId: string): InboxCommand[] {
  evictStale();
  const list = inboxes.get(sessionKey) ?? [];
  inboxes.delete(sessionKey);
  return list.filter((c) => c.org_id === orgId);
}

/** Is this session_key one the inbox is tracking? (has pending commands) */
export function hasInbox(sessionKey: string): boolean {
  const list = inboxes.get(sessionKey);
  return !!list && list.length > 0;
}

// ---------------------------------------------------------------------------
// Per-session capability tokens (proof-of-possession for poll/ack)
// ---------------------------------------------------------------------------

/** Store (or replace) the capability token for a session. */
export function setSessionToken(sessionKey: string, token: string): void {
  sessionTokens.set(sessionKey, token);
}

/** The capability token for a session, or undefined if none is registered. */
export function getSessionToken(sessionKey: string): string | undefined {
  return sessionTokens.get(sessionKey);
}

/** Forget a session's token (on 'ended' lifecycle). */
export function dropSessionToken(sessionKey: string): void {
  sessionTokens.delete(sessionKey);
}

/** The session_key a command id was enqueued for (for ack authorization). */
export function ackOwnerOf(id: string): string | undefined {
  return ackOwners.get(id)?.sessionKey;
}

/** Forget an id→session ownership once the command has been acked/settled. */
export function clearAckOwner(id: string): void {
  ackOwners.delete(id);
}

/** Evict commands + ack-owners older than the TTL (the dispatcher/DB sweep handles Core-side). */
function evictStale(): void {
  const cutoff = Date.now() - INBOX_TTL_MS;
  for (const [key, list] of inboxes) {
    const kept = list.filter((c) => c.enqueued_at >= cutoff);
    if (kept.length === 0) inboxes.delete(key);
    else if (kept.length !== list.length) inboxes.set(key, kept);
  }
  for (const [id, owner] of ackOwners) {
    if (owner.at < cutoff) ackOwners.delete(id);
  }
}

/** Total queued commands across all sessions (for /health + tests). */
export function inboxDepth(): number {
  let n = 0;
  for (const list of inboxes.values()) n += list.length;
  return n;
}

/** Test/shutdown helper — resets inboxes, tokens, and ack-owners. */
export function clearInbox(): void {
  inboxes.clear();
  sessionTokens.clear();
  ackOwners.clear();
}
