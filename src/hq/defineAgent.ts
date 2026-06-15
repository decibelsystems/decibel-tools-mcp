// ============================================================================
// @decibelsystems/tools/hq — defineAgent()
// ============================================================================
// register → heartbeat → poll command inbox → onCommand → ack. All over the local
// daemon's localhost HTTP endpoints; the SDK never holds Supabase creds.
// ============================================================================

import os from 'os';
import fs from 'fs';
import path from 'path';
import type {
  DefineAgentOptions,
  AgentHandle,
  AgentCommand,
  CommandResult,
  AgentContext,
} from './types.js';

// Exported for unit tests only — NOT re-exported from index.ts, so it stays off
// the public @decibelsystems/tools/hq surface.
export function toMs(v: number | string | undefined, fallback: number): number {
  if (v === undefined) return fallback;
  if (typeof v === 'number') return v;
  const m = v.trim().match(/^(\d+)(ms|s|m)?$/);
  if (!m) return fallback;
  const n = parseInt(m[1], 10);
  return m[2] === 's' ? n * 1000 : m[2] === 'm' ? n * 60_000 : m[2] === 'ms' ? n : n * 1000;
}

/** Discover the daemon URL: explicit > ~/.decibel/daemon.meta port > :4888. */
function resolveDaemonUrl(explicit?: string): string {
  if (explicit) return explicit.replace(/\/$/, '');
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.decibel', 'daemon.meta'), 'utf-8'));
    if (meta && typeof meta.port === 'number') return `http://127.0.0.1:${meta.port}`;
  } catch { /* fall through */ }
  return 'http://127.0.0.1:4888';
}

async function postJson(url: string, body: unknown, timeoutMs = 4000): Promise<{ ok: boolean; status: number; json: any }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

/**
 * Register a local runtime with the Decibel daemon: it appears on HQ's /agents
 * board tagged with `runtime`, heartbeats presence, and (if onCommand is given)
 * receives + acks HQ commands. Returns a handle with stop(). Idempotent per
 * sessionKey. Never throws from the loops — transient daemon/network errors are
 * logged and retried on the next tick.
 */
export async function defineAgent(opts: DefineAgentOptions): Promise<AgentHandle> {
  const runtime = opts.runtime;
  const sessionKey = opts.sessionKey || `${runtime}-${opts.name}-${process.pid}`;
  const cwd = opts.cwd ?? process.cwd();
  const base = resolveDaemonUrl(opts.daemonUrl);
  const heartbeatMs = toMs(opts.heartbeat, 30_000);
  const pollMs = toMs(opts.pollInterval, 5_000);
  const logger = opts.logger ?? ((m: string) => console.error(`[hq:${sessionKey}] ${m}`));

  const presenceBody = (extraMeta?: Record<string, unknown>, extraSummary?: string) => ({
    session_key: sessionKey,
    runtime,
    agent: opts.name,
    cwd,
    summary: extraSummary ?? opts.summary ?? null,
    meta: { ...(opts.meta ?? {}), ...(extraMeta ?? {}) },
  });

  const ctx: AgentContext = {
    sessionKey,
    runtime,
    updatePresence: async (patch) => {
      try {
        await postJson(`${base}/agents/heartbeat`, presenceBody(patch.meta, patch.summary));
      } catch (e) {
        logger(`updatePresence failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  };

  // Per-session capability token the daemon mints at register/heartbeat. The SDK
  // must present it on poll + ack to prove it's the registrant (session_key alone
  // is a guessable label). Refreshed from every register/heartbeat response, so a
  // daemon restart (which wipes its token store) self-heals on the next heartbeat.
  let token: string | undefined;
  const captureToken = (json: any) => {
    if (json && typeof json.token === 'string') token = json.token;
  };

  // --- register (first presence write) ---
  try {
    const r = await postJson(`${base}/agents/register`, presenceBody());
    if (!r.ok) logger(`register returned HTTP ${r.status}: ${JSON.stringify(r.json)}`);
    else { captureToken(r.json); logger(`registered (runtime=${runtime}) with daemon ${base}`); }
  } catch (e) {
    logger(`register failed (will retry on heartbeat): ${e instanceof Error ? e.message : String(e)}`);
  }

  let stopped = false;

  // --- heartbeat loop ---
  const heartbeat = async () => {
    if (stopped) return;
    try {
      const r = await postJson(`${base}/agents/heartbeat`, presenceBody());
      captureToken(r.json);
    } catch (e) {
      logger(`heartbeat failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const hbTimer = setInterval(heartbeat, heartbeatMs);
  if (typeof (hbTimer as any).unref === 'function') (hbTimer as any).unref();

  // --- command inbox poll → onCommand → ack ---
  const handle = opts.onCommand;
  const pollOnce = async () => {
    if (stopped) return;
    if (!token) return; // not yet authorized (register hasn't landed); next tick retries
    let commands: AgentCommand[] = [];
    try {
      const res = await fetch(
        `${base}/agents/commands?session_key=${encodeURIComponent(sessionKey)}&token=${encodeURIComponent(token)}`,
        { signal: AbortSignal.timeout(4000) },
      );
      if (!res.ok) return;
      const json = await res.json().catch(() => ({}));
      commands = (json?.commands ?? []) as AgentCommand[];
    } catch (e) {
      logger(`poll failed: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    for (const cmd of commands) {
      let outcome: CommandResult;
      if (!handle) {
        outcome = { status: 'failed', error: 'no onCommand handler registered' };
      } else {
        try {
          outcome = await handle(cmd, ctx);
        } catch (e) {
          outcome = { status: 'failed', error: e instanceof Error ? e.message : String(e) };
        }
      }
      try {
        await postJson(`${base}/agents/commands/ack`, {
          id: cmd.id,
          token,
          status: outcome.status,
          result: outcome.result ?? null,
          error: outcome.error ?? null,
        });
      } catch (e) {
        logger(`ack ${cmd.id} failed (HQ will see it expire): ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  };
  // Only poll if the agent declared a handler OR capabilities (else there's nothing
  // to receive). Always safe to poll though — drain returns [] for unknown sessions.
  const pollTimer = setInterval(() => { pollOnce().catch(() => {}); }, pollMs);
  if (typeof (pollTimer as any).unref === 'function') (pollTimer as any).unref();

  return {
    sessionKey,
    runtime,
    stop: async () => {
      stopped = true;
      clearInterval(hbTimer);
      clearInterval(pollTimer);
      // Best-effort: mark the session ended so the board reflects it promptly
      // (else it ages out via the daemon stale-sweep in ~5min).
      try {
        await postJson(`${base}/agents/heartbeat`, { ...presenceBody(), status: 'ended' });
      } catch { /* best effort */ }
    },
  };
}
