// ============================================================================
// Agent-command dispatcher — HQ → agent control surface (Plan D, v1)
// ============================================================================
// The inverse of agentPresence: HQ (org admin) WRITES commands into
// hq.agent_commands under RLS; this daemon picks up pending commands targeted at
// sessions IT hosts and dispatches them, writing status/result back via
// SERVICE_ROLE. v1 kinds (Ben-scoped, allowlisted): 'message' + 'request_status'.
// No shell, no lifecycle. Contract co-designed with decibel-hq (hq.agent_commands
// migration + cancel RPC + expire sweep). EPIC-0033.
//
// SAFETY: a 'message' is delivered to the target peer as untrusted-channel DATA
// (via the claude-peers broker) — it is NOT an auto-executed instruction. The
// daemon only transports it.
//
// ⚠️ LOAD-BEARING CROSS-ORG INVARIANT (per HQ /security-review):
//   target_session_key / target_host are FREE TEXT on hq.agent_commands — HQ does
//   NOT bind them to a same-org live session (keys churn). The ENTIRE cross-org
//   targeting defense therefore rests on THIS query: it MUST filter on org_id
//   FIRST (the org this daemon is authorized to serve), with target_host ==
//   own hostname + target_session_key ∈ live registry as defense-in-depth.
//   An org-A admin can write a row naming an org-B peer's guessable session_key,
//   but that row carries org_id=A; as long as org-B's daemon only ever dispatches
//   rows scoped to org B's org_id, the A-row never reaches B. DO NOT refactor this
//   to key purely on (host, session_key) ignoring org_id — that opens cross-org
//   targeting on a shared host.
//
// Other boundaries:
//   - host-match: only dispatch commands whose target_host == this host.
//   - expiry: skip expires_at < now; also call the DB sweep each cycle.
//   - poll every 5s (robust; realtime is HQ's status view, not our pickup path).
// ============================================================================

import os from 'os';
import { createClient } from '@supabase/supabase-js';
import { log } from './config.js';

const BROKER_URL = `http://127.0.0.1:${process.env.CLAUDE_PEERS_PORT ?? '7899'}`;
const ORG_ID = process.env.DECIBEL_ORG_ID || '1cb79e24-e06f-46c9-8a22-5ee025ffb0f4';
const POLL_MS = 5_000;
const ALLOWED_KINDS = new Set(['message', 'request_status']);
// Ben-scoped staged rollout: the FIRST run dispatches request_status ONLY so he can
// watch a read-only round-trip before any message reaches a live agent. 'message'
// dispatch stays held (rows left pending → they expire) until DECIBEL_ENABLE_AGENT_MESSAGES=1.
const MESSAGES_ENABLED = process.env.DECIBEL_ENABLE_AGENT_MESSAGES === '1';

interface CommandRow {
  id: string;
  org_id: string;
  target_session_key: string;
  target_host: string | null;
  kind: string;
  payload: { text?: string; from_label?: string } | null;
  expires_at: string | null;
  status: string;
}

interface BrokerPeer {
  id: string;
  cwd: string;
  git_root: string | null;
  summary: string;
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

async function brokerListPeers(): Promise<BrokerPeer[]> {
  try {
    const res = await fetch(`${BROKER_URL}/list-peers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requester_id: 'decibel-daemon', scope: 'machine' }),
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return [];
    return (await res.json()) as BrokerPeer[];
  } catch {
    return [];
  }
}

/** Send a peer message via the claude-peers broker. Returns ok + optional error. */
async function brokerSend(to: string, message: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${BROKER_URL}/send-message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Broker contract: {from_id, to_id, text} (claude-peers broker.ts:280,
      // shared/types.ts:59 — confirmed line-by-line by the claude-peers owner).
      // from_id="decibel-daemon": a plainly NON-privileged relay label. Deliberately
      // NOT "system" — a "system" sender reads to the receiving agent as a trusted/
      // privileged directive, the OPPOSITE of the required posture (an HQ command is
      // untrusted-channel DATA, not an auto-executed instruction). Human provenance
      // rides in `text` ("HQ · <issuer>: ..."). FK is off in the broker so any
      // from_id delivers; if FK is ever enabled, register decibel-daemon then.
      body: JSON.stringify({ from_id: 'decibel-daemon', to_id: to, text: message }),
      signal: AbortSignal.timeout(3000),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    return { ok: body.ok === true, error: body.error ?? (res.ok ? undefined : `HTTP ${res.status}`) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

const TERMINAL = new Set(['done', 'failed', 'cancelled', 'expired']);

async function settle(client: DbClient, id: string, patch: Record<string, unknown>): Promise<void> {
  // Stamp completed_at on terminal transitions so HQ can show completion timing.
  if (typeof patch.status === 'string' && TERMINAL.has(patch.status) && !('completed_at' in patch)) {
    patch = { ...patch, completed_at: new Date().toISOString() };
  }
  // org_id-scoped settle too — never update a row outside our authorized org.
  const { error } = await client.from('agent_commands').update(patch).eq('id', id).eq('org_id', ORG_ID);
  if (error) log(`Commands: settle ${id} failed: ${error.message}`);
}

async function dispatchOne(client: DbClient, cmd: CommandRow, peers: BrokerPeer[]): Promise<void> {
  // Defensive expiry + kind allowlist (DB also enforces, belt-and-suspenders).
  if (cmd.expires_at && Date.parse(cmd.expires_at) < Date.now()) return;
  if (!ALLOWED_KINDS.has(cmd.kind)) {
    await settle(client, cmd.id, { status: 'failed', error: `unsupported kind '${cmd.kind}'` });
    return;
  }

  // Staged rollout: hold 'message' until explicitly enabled. Leave the row pending
  // (untouched) so it simply expires — do NOT settle, so it can dispatch later if
  // messages are enabled before it expires.
  if (cmd.kind === 'message' && !MESSAGES_ENABLED) return;

  // Mark delivered (picked up by this daemon).
  await settle(client, cmd.id, { status: 'delivered', delivered_at: new Date().toISOString() });

  const peer = peers.find((p) => p.id === cmd.target_session_key);

  if (cmd.kind === 'request_status') {
    if (!peer) {
      await settle(client, cmd.id, { status: 'failed', error: 'target session not found in live registry' });
      return;
    }
    await settle(client, cmd.id, {
      status: 'done',
      result: { summary: peer.summary || null, cwd: peer.cwd || null, last_seen: peer.last_seen, status: 'active' },
    });
    return;
  }

  // kind === 'message'
  const text = cmd.payload?.text;
  if (!text) {
    await settle(client, cmd.id, { status: 'failed', error: 'message payload missing text' });
    return;
  }
  if (!peer) {
    await settle(client, cmd.id, { status: 'failed', error: 'target session not found in live registry' });
    return;
  }
  const label = cmd.payload?.from_label ? `${cmd.payload.from_label}: ` : '';
  const r = await brokerSend(cmd.target_session_key, `${label}${text}`);
  if (r.ok) {
    await settle(client, cmd.id, { status: 'done', result: { delivered: true } });
  } else {
    await settle(client, cmd.id, { status: 'failed', error: r.error || 'broker send failed' });
  }
}

async function tick(client: DbClient): Promise<void> {
  const host = os.hostname();

  // DB-side sweep: flip pending->expired where past expiry (idempotent, service_role).
  try {
    await client.rpc('expire_stale_agent_commands');
  } catch { /* RPC optional/non-fatal */ }

  // Pending commands for OUR org (primary cross-org filter — see invariant above),
  // targeted at sessions THIS daemon hosts.
  const { data, error } = await client
    .from('agent_commands')
    .select('id,org_id,target_session_key,target_host,kind,payload,expires_at,status')
    .eq('org_id', ORG_ID)
    .eq('status', 'pending')
    .eq('target_host', host);
  if (error) {
    log(`Commands: poll failed: ${error.message}`);
    return;
  }
  const pending = (data ?? []) as CommandRow[];
  if (pending.length === 0) return;

  const peers = await brokerListPeers();
  for (const cmd of pending) {
    try {
      await dispatchOne(client, cmd, peers);
    } catch (e) {
      log(`Commands: dispatch ${cmd.id} error: ${e instanceof Error ? e.message : String(e)}`);
      await settle(client, cmd.id, { status: 'failed', error: 'dispatch exception' }).catch(() => {});
    }
  }
}

/** Start the command dispatcher loop. Returns a stop function. No-ops if Supabase unconfigured. */
export function startCommandDispatcher(): () => void {
  const client = serviceClient();
  if (!client) {
    log('Commands: SUPABASE_URL/SERVICE_KEY not set — agent-command dispatcher disabled.');
    return () => {};
  }
  log(`Commands: dispatcher started (5s poll of hq.agent_commands, host ${os.hostname()}, org ${ORG_ID}).`);
  const run = () => {
    tick(client).catch((e) => log(`Commands: tick error: ${e instanceof Error ? e.message : String(e)}`));
  };
  run();
  const iv = setInterval(run, POLL_MS);
  if (typeof (iv as { unref?: () => void }).unref === 'function') (iv as { unref: () => void }).unref();
  return () => clearInterval(iv);
}
