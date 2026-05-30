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

const BROKER_URL = `http://127.0.0.1:${process.env.CLAUDE_PEERS_PORT ?? '7899'}`;
const ORG_ID = process.env.DECIBEL_ORG_ID || '1cb79e24-e06f-46c9-8a22-5ee025ffb0f4';
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

async function tick(client: DbClient): Promise<void> {
  const host = os.hostname();
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  const peers = await fetchPeers();
  for (const p of peers) {
    if (!p.id) continue;
    const project_id = await resolveProjectId(client, p.cwd);
    const row = {
      org_id: ORG_ID,
      host,
      session_key: p.id,
      agent: null as string | null,
      summary: p.summary || null,
      cwd: p.cwd || null,
      project_id,
      status: 'active',
      started_at: p.registered_at || nowIso,
      last_seen_at: nowIso,
      ended_at: null as string | null,
      meta: {},
    };
    const { error } = await client.from('agent_sessions').upsert(row, { onConflict: 'org_id,host,session_key' });
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
