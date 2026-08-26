// ============================================================================
// Agent-presence writer — heartbeats live claude-peers sessions into Core
// ============================================================================
// Daemon-side telemetry writer for the Plan D agent-presence domain. On a 30s
// loop it:
//   1. reads live peers from the claude-peers broker (POST /list-peers),
//   2. upserts each into hq.agent_sessions via SERVICE_ROLE (deliberate scoped
//      exception — presence is telemetry, peers carry no user JWT, v1 single-org),
//   3. stale-sweeps active rows that stopped heartbeating → idle (>90s) / ended (>5min).
// Never throws into the daemon; no-ops if Supabase isn't configured or the broker
// is down. Contract co-designed with decibel-hq (migration 20260524000005). EPIC-0033.
// ============================================================================

import os from 'os';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { log } from './config.js';
import { withRetryResult } from './supabaseRetry.js';

const BROKER_URL = `http://127.0.0.1:${process.env.CLAUDE_PEERS_PORT ?? '7899'}`;
const ORG_ID = process.env.DECIBEL_ORG_ID || '1cb79e24-e06f-46c9-8a22-5ee025ffb0f4';

/**
 * The daemon's host identity for presence + command targeting. Defaults to
 * os.hostname() but is overridable via DECIBEL_PRESENCE_HOST — needed where the
 * OS hostname isn't a stable/unique daemon identity (containers with shared
 * hostnames, or two daemons on one machine, e.g. a rolling restart or a test
 * harness). target_host on hq.agent_commands matches this, so it must be the same
 * value the presence writer stamps. Shared by the dispatcher (agentCommands.ts).
 */
export function resolveHost(): string {
  return process.env.DECIBEL_PRESENCE_HOST || os.hostname();
}
const HEARTBEAT_MS = 30_000;
const IDLE_AFTER_MS = 90_000;
const ENDED_AFTER_MS = 5 * 60_000;

interface BrokerPeer {
  id: string;
  pid: number;
  cwd: string;
  git_root: string | null;
  summary: string;
  registered_at: string;
  last_seen: string;
}

function serviceClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: 'hq' },
  });
}
type DbClient = NonNullable<ReturnType<typeof serviceClient>>;

async function fetchPeers(): Promise<BrokerPeer[]> {
  try {
    const res = await fetch(`${BROKER_URL}/list-peers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requester_id: 'decibel-presence', scope: 'machine' }),
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return [];
    return (await res.json()) as BrokerPeer[];
  } catch {
    return [];
  }
}

// project label (repo dir basename) → hq.projects.id within the org. Cached;
// refreshed on a miss so newly-onboarded projects resolve.
let projectMap: Map<string, string> | null = null;
async function loadProjects(client: DbClient): Promise<Map<string, string>> {
  const { data, error } = await client.from('projects').select('id,key').eq('org_id', ORG_ID);
  const m = new Map<string, string>();
  if (!error && data) for (const r of data as Array<{ id: string; key: string }>) m.set(r.key, r.id);
  return m;
}
async function resolveProjectId(client: DbClient, cwd: string): Promise<string | null> {
  const key = path.basename(cwd || '');
  if (!key) return null;
  if (!projectMap) projectMap = await loadProjects(client);
  if (!projectMap.has(key)) projectMap = await loadProjects(client); // refresh once on miss
  return projectMap.get(key) ?? null;
}

// ============================================================================
// Durable agent identity — the agent_id seam (ISS-0134 / EPIC-0037)
// ============================================================================
// hq.agent_sessions is EPHEMERAL: session_key dies with the process. hq.agents
// is DURABLE: "this repo's Claude Code agent", stable across restarts, and it
// is what a post-office message is addressed to. agent_sessions.agent_id is the
// resolution edge between them, and HQ cannot populate it — the daemon owns
// this write path, so the column stays inert until the code below fills it.
//
// Without it hq.resolve_agent_session() finds nothing, every message resolves
// to delivered_session_key = NULL, and the post office records traffic it never
// delivers. Honest, but inert.
//
// CARDINALITY IS MANY SESSIONS : ONE AGENT. That is not an assumption — HQ's
// resolve_agent_session() ends in `order by last_seen_at desc limit 1`, which
// only makes sense if several live sessions can share one agent_id. Two Claude
// Code windows open on the same repo are one addressable agent; delivery goes
// to whichever is most recently active.

/**
 * Derive the DURABLE address for a session.
 *
 * Must be stable across restarts, so anything process-scoped is disqualified:
 * not the session key, not a PID, not a TTY. The claude-peers broker id looks
 * stable but is not — it carries a random suffix (`decibel-hq-nby9`), so a
 * restart would silently mint a second agent and split the thread history.
 *
 * Repo identity + runtime is the stable pair: the same checkout on the same
 * runtime is the same logical agent, session after session.
 *
 * DELIBERATELY NOT caller-supplied. `reg.agent` is an untrusted display label
 * from a local process, and a local caller that could name its own durable
 * address could claim an EXISTING agent's name — resolve_agent_session picks
 * the most recently seen session, so a frequent heartbeater would capture that
 * agent's inbound mail. That is the principal-not-label gap (EPIC-0007) which
 * Ben accepted as risk for EPIC-0037; accepting it is not a reason to widen it.
 * An operator can still set the name explicitly via DECIBEL_AGENT_NAME, which
 * is daemon-scoped env (trusted) rather than per-request payload.
 */
export function deriveAgentName(input: {
  gitRoot?: string | null;
  cwd?: string | null;
  runtime: string;
  host: string;
}): string {
  const explicit = process.env.DECIBEL_AGENT_NAME;
  if (explicit && explicit.trim()) return explicit.trim().slice(0, 200);

  // basename of the git root, else of the cwd — the repo IS the identity.
  const root = (input.gitRoot || input.cwd || '').trim();
  const key = root ? path.basename(root) : '';
  // No filesystem context at all (a runtime that registered without a cwd):
  // fall back to the daemon host so the name is still stable, just coarser.
  const scope = key || input.host;
  return `${scope}/${input.runtime}`.slice(0, 200);
}

/**
 * agent name -> hq.agents.id, memoised for the process. The presence loop runs
 * every 30s over every peer; without this each tick would re-round-trip the
 * same handful of names forever.
 */
const agentIdCache = new Map<string, string>();

/**
 * Resolve (or create) the durable hq.agents row for `name` and return its id.
 *
 * Returns null rather than throwing when the table is absent — this ships
 * BEFORE decibel-hq applies the post-office migration, and presence writing
 * must keep working untouched in the meantime. When the migration lands the
 * same code starts populating agent_id with no redeploy.
 *
 * `runtime` is written as a self-declared LABEL only. HQ's schema comment is
 * explicit that it is never a trust signal, so nothing here gates on it.
 */
export async function resolveAgentId(
  client: DbClient,
  name: string,
  runtime: string
): Promise<string | null> {
  const cached = agentIdCache.get(name);
  if (cached) return cached;

  // Upsert on the (org_id, name) unique key, then read the id back. Doing it as
  // an upsert rather than select-then-insert keeps two daemons racing on the
  // same name from both inserting.
  const { data, error } = await withRetryResult(
    () =>
      client
        .from('agents')
        .upsert(
          { org_id: ORG_ID, name, runtime },
          { onConflict: 'org_id,name', ignoreDuplicates: false }
        )
        .select('id')
        .maybeSingle(),
    `presence.agent-resolve ${name}`
  );

  if (error) {
    // Table not yet created (migration unapplied) is the EXPECTED state today,
    // so log it once per name at low volume rather than every 30s tick.
    if (!agentResolveWarned.has(name)) {
      agentResolveWarned.add(name);
      log(`Presence: agent identity unavailable for "${name}" (${error.message}) — agent_id left null.`);
    }
    return null;
  }

  const id = (data as { id?: string } | null)?.id;
  if (!id) return null;
  agentIdCache.set(name, id);
  return id;
}

const agentResolveWarned = new Set<string>();

/** Test seam: drop memoised ids so a test can observe a fresh resolve. */
export function __resetAgentIdCache(): void {
  agentIdCache.clear();
  agentResolveWarned.clear();
}

async function tick(client: DbClient): Promise<void> {
  const host = resolveHost();
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  const peers = await fetchPeers();
  for (const p of peers) {
    if (!p.id) continue;
    const project_id = await resolveProjectId(client, p.cwd);
    // Durable identity for this session. git_root is preferred over cwd: a peer
    // sitting in a subdirectory of the repo is the same agent as one at the top.
    const agent_id = await resolveAgentId(
      client,
      deriveAgentName({ gitRoot: p.git_root, cwd: p.cwd, runtime: 'claude-code', host }),
      'claude-code'
    );
    const row = {
      org_id: ORG_ID,
      host,
      session_key: p.id,
      agent: null as string | null,
      // These are Claude Code sessions read from the claude-peers broker; tag the
      // runtime so HQ's /agents board renders the runtime badge + filter (P1/P5).
      runtime: 'claude-code',
      // Only sent once resolvable. Before the post-office migration lands the
      // column does not exist and PostgREST rejects the ENTIRE row on an
      // unknown key — which would take down presence writing that works today.
      ...(agent_id ? { agent_id } : {}),
      summary: p.summary || null,
      cwd: p.cwd || null,
      project_id,
      status: 'active',
      started_at: p.registered_at || nowIso,
      last_seen_at: nowIso,
      ended_at: null as string | null,
      // last_action_at = the broker's per-peer last_seen → HQ's ActivityLine renders
      // a tool-call pulse from it. Richer self-report fields (tokens, current_file)
      // are a follow-on (agent-side self-report; not daemon-observable).
      meta: { last_action_at: p.last_seen || nowIso },
    };
    const { error } = await withRetryResult(
      () => client.from('agent_sessions').upsert(row, { onConflict: 'org_id,host,session_key' }),
      `presence.upsert ${p.id}`,
    );
    if (error) log(`Presence: upsert ${p.id} failed: ${error.message}`);
  }

  // Stale-sweep: sessions that stopped heartbeating (broker dropped them, or daemon
  // missed beats). idle first, then ended (ended uses status<>'ended' so it also
  // catches idle rows past the longer cutoff).
  const idleCut = new Date(nowMs - IDLE_AFTER_MS).toISOString();
  const endedCut = new Date(nowMs - ENDED_AFTER_MS).toISOString();
  await client.from('agent_sessions').update({ status: 'idle' })
    .eq('org_id', ORG_ID).eq('status', 'active').lt('last_seen_at', idleCut);
  await client.from('agent_sessions').update({ status: 'ended', ended_at: nowIso })
    .eq('org_id', ORG_ID).neq('status', 'ended').lt('last_seen_at', endedCut);
}

// ============================================================================
// Generic local-runtime registration (P2 — swarm multi-runtime)
// ============================================================================
// Any local runtime (Hermes, OpenClaw, Codex, Cursor, custom) registers/heartbeats
// via the daemon's POST /agents/register + /agents/heartbeat endpoints (the SDK
// calls these). This writes the SAME hq.agent_sessions row the claude-peers
// presence writer does, just tagged with the SDK-DECLARED runtime so HQ renders
// the runtime badge + filter.
//
// IDENTITY (confused-deputy rule): the HTTP endpoint MUST restrict these calls to
// the localhost-bind connection principal — that bind IS the auth boundary for the
// local self-host path. The runtime/session_key here is an untrusted LABEL from a
// trusted-LOCATION caller (a local process), acceptable for a local presence write.
// The hosted/BYO path (P4) uses an agent-token instead; that's NOT this code.

export interface LocalAgentRegistration {
  session_key: string;          // the runtime's stable session id
  runtime: string;              // SDK-declared: hermes|openclaw|codex|cursor|mcp|custom
  agent?: string | null;        // human label
  cwd?: string | null;
  summary?: string | null;
  meta?: Record<string, unknown>;
  // Lifecycle: SDK heartbeat keeps a session 'active'; stop() sends 'ended'.
  // Only 'active' | 'ended' accepted (idle is the daemon stale-sweep's job).
  status?: 'active' | 'ended';
}

// ---------------------------------------------------------------------------
// Write-time presence-field belt (NON-encoding) — co-designed with decibel-hq.
// ---------------------------------------------------------------------------
// HQ's /agents board already escapes these at render (React JSX text children),
// so the daemon MUST NOT HTML-encode here — that would double-escape and corrupt
// legitimate data (a real summary like "fix <Button> when a < b"). The correct
// write-time defense-in-depth is non-encoding: cap length + strip control chars /
// null bytes (preserving \t\n\r) so the stored value stays faithful but bounded.
// Also closes the review's "no validation on meta/result blobs" finding.

const FIELD_CAPS = { agent: 200, summary: 500, cwd: 1024 } as const;
const META_VALUE_CAP = 1000;
const META_MAX_BYTES = 4096;
// C0 controls (U+0000..U+001F) + DEL (U+007F), EXCEPT tab/newline/carriage-return.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** Strip control chars/null bytes and cap length. Empty-after-clean → null. */
export function sanitizeText(s: string | null | undefined, maxLen: number): string | null {
  if (s == null) return null;
  const cleaned = String(s).replace(CONTROL_CHARS, '').slice(0, maxLen);
  return cleaned.length ? cleaned : null;
}

/**
 * Flatten meta to display-safe primitives: strings cleaned + capped, numbers/
 * booleans/null kept, nested objects/arrays dropped (HQ typeof-guards numeric
 * meta and renders strings as text). If the result still exceeds META_MAX_BYTES,
 * drop it entirely — the caller re-adds the trusted last_action_at.
 */
export function sanitizeMeta(meta: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!meta || typeof meta !== 'object') return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (typeof v === 'string') out[k] = v.replace(CONTROL_CHARS, '').slice(0, META_VALUE_CAP);
    else if (typeof v === 'number' || typeof v === 'boolean' || v === null) out[k] = v;
    // nested objects/arrays intentionally dropped
  }
  if (Buffer.byteLength(JSON.stringify(out)) > META_MAX_BYTES) return {};
  return out;
}

/**
 * Upsert a local-runtime session into hq.agent_sessions (register or heartbeat).
 * Returns true on success, false if Supabase is unconfigured or the write failed.
 * Reuses the presence writer's org config + cwd→project resolution.
 */
export async function writeLocalAgentSession(reg: LocalAgentRegistration): Promise<boolean> {
  const client = serviceClient();
  if (!client) return false;
  if (!reg.session_key || !reg.runtime) return false;

  const host = resolveHost();
  const nowIso = new Date().toISOString();
  const project_id = await resolveProjectId(client, reg.cwd || '');
  const ended = reg.status === 'ended';
  // Durable identity. The SDK gives us no git_root, so the cwd basename is the
  // repo key. Note the address is derived from WHERE the runtime is, never from
  // reg.agent — see deriveAgentName on why a caller must not name itself.
  const agent_id = await resolveAgentId(
    client,
    deriveAgentName({ cwd: reg.cwd, runtime: reg.runtime, host }),
    reg.runtime
  );
  const row = {
    org_id: ORG_ID,
    host,
    session_key: reg.session_key,
    runtime: reg.runtime,
    // See the claude-peers path: omitted, not nulled, until the column exists.
    ...(agent_id ? { agent_id } : {}),
    // Non-encoding belt on caller-supplied display fields (store-raw / escape-at-
    // render is HQ's job; we only cap length + strip control chars/null bytes).
    agent: sanitizeText(reg.agent, FIELD_CAPS.agent),
    summary: sanitizeText(reg.summary, FIELD_CAPS.summary),
    cwd: sanitizeText(reg.cwd, FIELD_CAPS.cwd),
    project_id,
    status: ended ? 'ended' : 'active',
    started_at: nowIso,
    last_seen_at: nowIso,
    ended_at: ended ? nowIso : null,
    // Default last_action_at to now; a self-reporting SDK may override it via meta
    // (intended richer signal — HQ reads last_seen_at, not this, for liveness).
    meta: { last_action_at: nowIso, ...sanitizeMeta(reg.meta) },
  };
  // started_at only matters on first insert; onConflict updates the rest. We let it
  // re-send started_at — harmless on heartbeat since HQ reads last_seen_at for liveness.
  const { error } = await withRetryResult(
    () => client.from('agent_sessions').upsert(row, { onConflict: 'org_id,host,session_key' }),
    `presence.local-register ${reg.session_key}`,
  );
  if (error) {
    log(`Presence: local register ${reg.session_key} (${reg.runtime}) failed: ${error.message}`);
    return false;
  }
  return true;
}

/** Start the presence writer loop. Returns a stop function. No-ops if Supabase unconfigured. */
export function startPresenceWriter(): () => void {
  const client = serviceClient();
  if (!client) {
    log('Presence: SUPABASE_URL/SERVICE_KEY not set — agent-presence writer disabled.');
    return () => {};
  }
  log(`Presence: writer started (30s heartbeat → hq.agent_sessions, org ${ORG_ID}).`);
  const run = () => {
    tick(client).catch((e) => log(`Presence: tick error: ${e instanceof Error ? e.message : String(e)}`));
  };
  run();
  const iv = setInterval(run, HEARTBEAT_MS);
  if (typeof (iv as { unref?: () => void }).unref === 'function') (iv as { unref: () => void }).unref();
  return () => clearInterval(iv);
}
