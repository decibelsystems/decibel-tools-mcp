import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  deriveAgentName,
  resolveAgentId,
  listAgentRoster,
  __resetAgentIdCache,
} from '../../src/agentPresence.js';

/**
 * ISS-0134 / EPIC-0037 — the agent_id seam.
 *
 * hq.agent_sessions is ephemeral; hq.agents is the durable address a
 * post-office message is delivered to. These tests pin the two properties the
 * seam actually rests on:
 *
 *   1. the derived name SURVIVES A RESTART (nothing process-scoped in it), and
 *   2. resolving it NEVER breaks presence writing, because this ships before
 *      decibel-hq applies the migration that creates the table.
 */

/** Minimal stand-in for the postgrest builder chain used by resolveAgentId. */
function fakeClient(result: { data?: unknown; error?: { message: string } }) {
  const calls: Array<{ table: string; row: unknown; opts: unknown }> = [];
  const client = {
    calls,
    from(table: string) {
      return {
        upsert(row: unknown, opts: unknown) {
          calls.push({ table, row, opts });
          return {
            select() {
              return {
                async maybeSingle() {
                  return { data: result.data ?? null, error: result.error ?? null };
                },
              };
            },
          };
        },
      };
    },
  };
  return client as unknown as Parameters<typeof resolveAgentId>[0] & { calls: typeof calls };
}

describe('durable agent identity (ISS-0134)', () => {
  const savedName = process.env.DECIBEL_AGENT_NAME;

  beforeEach(() => {
    delete process.env.DECIBEL_AGENT_NAME;
    __resetAgentIdCache();
  });

  afterEach(() => {
    if (savedName === undefined) delete process.env.DECIBEL_AGENT_NAME;
    else process.env.DECIBEL_AGENT_NAME = savedName;
    __resetAgentIdCache();
  });

  describe('deriveAgentName', () => {
    it('is stable across restarts — same repo and runtime yield the same address', () => {
      // The broker mints a new session id every run; the address must not move.
      const first = deriveAgentName({
        gitRoot: '/Users/ben/code/decibel-tools-mcp',
        runtime: 'claude-code',
        host: 'ashitaka',
      });
      const afterRestart = deriveAgentName({
        gitRoot: '/Users/ben/code/decibel-tools-mcp',
        runtime: 'claude-code',
        host: 'ashitaka',
      });
      expect(afterRestart).toBe(first);
      expect(first).toBe('decibel-tools-mcp/claude-code');
    });

    it('prefers git_root over cwd, so a subdirectory is the same agent', () => {
      const atRoot = deriveAgentName({
        gitRoot: '/Users/ben/code/decibel-tools-mcp',
        cwd: '/Users/ben/code/decibel-tools-mcp',
        runtime: 'claude-code',
        host: 'ashitaka',
      });
      const inSubdir = deriveAgentName({
        gitRoot: '/Users/ben/code/decibel-tools-mcp',
        cwd: '/Users/ben/code/decibel-tools-mcp/src/tools',
        runtime: 'claude-code',
        host: 'ashitaka',
      });
      expect(inSubdir).toBe(atRoot);
    });

    it('falls back to cwd when there is no git root', () => {
      expect(
        deriveAgentName({ gitRoot: null, cwd: '/tmp/scratch', runtime: 'hermes', host: 'ashitaka' })
      ).toBe('scratch/hermes');
    });

    it('falls back to the host when there is no filesystem context at all', () => {
      expect(deriveAgentName({ runtime: 'codex', host: 'ashitaka' })).toBe('ashitaka/codex');
    });

    it('separates agents by runtime in the same repo', () => {
      const claude = deriveAgentName({ gitRoot: '/x/repo', runtime: 'claude-code', host: 'h' });
      const hermes = deriveAgentName({ gitRoot: '/x/repo', runtime: 'hermes', host: 'h' });
      expect(claude).not.toBe(hermes);
    });

    it('honours an explicit DECIBEL_AGENT_NAME override', () => {
      process.env.DECIBEL_AGENT_NAME = 'design-reviewer';
      expect(
        deriveAgentName({ gitRoot: '/x/repo', runtime: 'claude-code', host: 'h' })
      ).toBe('design-reviewer');
    });

    it('ignores a blank override rather than producing an empty address', () => {
      process.env.DECIBEL_AGENT_NAME = '   ';
      expect(deriveAgentName({ gitRoot: '/x/repo', runtime: 'claude-code', host: 'h' })).toBe(
        'repo/claude-code'
      );
    });

    it('caps the name to the column bound', () => {
      process.env.DECIBEL_AGENT_NAME = 'z'.repeat(500);
      expect(deriveAgentName({ runtime: 'mcp', host: 'h' }).length).toBe(200);
    });
  });

  describe('resolveAgentId', () => {
    it('upserts on the (org_id, name) unique key so racing daemons converge', async () => {
      const client = fakeClient({ data: { id: 'uuid-1' } });

      const id = await resolveAgentId(client, 'decibel-tools-mcp/claude-code', 'claude-code');

      expect(id).toBe('uuid-1');
      expect(client.calls).toHaveLength(1);
      expect(client.calls[0].table).toBe('agents');
      expect(client.calls[0].opts).toMatchObject({ onConflict: 'org_id,name' });
      expect(client.calls[0].row).toMatchObject({
        name: 'decibel-tools-mcp/claude-code',
        runtime: 'claude-code',
      });
    });

    it('memoises, so a 30s presence loop does not re-round-trip every tick', async () => {
      const client = fakeClient({ data: { id: 'uuid-1' } });

      await resolveAgentId(client, 'repo/claude-code', 'claude-code');
      await resolveAgentId(client, 'repo/claude-code', 'claude-code');
      await resolveAgentId(client, 'repo/claude-code', 'claude-code');

      expect(client.calls).toHaveLength(1);
    });

    it('returns null WITHOUT THROWING when the table does not exist yet', async () => {
      // The expected state today: decibel-hq has not applied the post-office
      // migration. Presence writing must survive this untouched.
      const client = fakeClient({
        error: { message: 'relation "hq.agents" does not exist' },
      });

      await expect(
        resolveAgentId(client, 'repo/claude-code', 'claude-code')
      ).resolves.toBeNull();
    });

    it('does not cache a failure, so it recovers once the migration lands', async () => {
      const failing = fakeClient({ error: { message: 'relation "hq.agents" does not exist' } });
      expect(await resolveAgentId(failing, 'repo/claude-code', 'claude-code')).toBeNull();

      const working = fakeClient({ data: { id: 'uuid-9' } });
      expect(await resolveAgentId(working, 'repo/claude-code', 'claude-code')).toBe('uuid-9');
    });

    it('returns null when the upsert reports no row rather than inventing an id', async () => {
      const client = fakeClient({ data: null });
      await expect(resolveAgentId(client, 'repo/claude-code', 'claude-code')).resolves.toBeNull();
    });
  });
});

/** Builder stub for the two-query roster path. */
function rosterClient(opts: {
  agents?: unknown[];
  agentsError?: { message: string };
  sessions?: unknown[];
}) {
  const queries: Array<{ table: string; filters: Record<string, unknown> }> = [];
  const client = {
    queries,
    from(table: string) {
      const filters: Record<string, unknown> = {};
      queries.push({ table, filters });
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      builder.select = chain;
      builder.eq = (k: string, v: unknown) => {
        filters[k] = v;
        return builder;
      };
      builder.gt = (k: string, v: unknown) => {
        filters[`gt:${k}`] = v;
        return builder;
      };
      builder.order = chain;
      // Awaited by withRetryResult.
      builder.then = (resolve: (r: unknown) => unknown) =>
        resolve(
          table === 'agents'
            ? { data: opts.agents ?? [], error: opts.agentsError ?? null }
            : { data: opts.sessions ?? [], error: null }
        );
      return builder;
    },
  };
  return client as unknown as Parameters<typeof listAgentRoster>[0] & { queries: typeof queries };
}

describe('agents.list roster — durable agents LEFT JOIN liveness (ISS-0134)', () => {
  const AGENTS = [
    { id: 'a1', name: 'decibel-tools-mcp/claude-code', runtime: 'claude-code', role: null, capabilities: [], status: 'active' },
    { id: 'a2', name: 'decibel-hq/claude-code', runtime: 'claude-code', role: null, capabilities: [], status: 'active' },
  ];

  it('keeps an OFFLINE agent visible instead of letting it vanish', async () => {
    // The whole point: a roster built from live sessions would silently drop
    // the agent you are trying and failing to reach.
    const client = rosterClient({
      agents: AGENTS,
      sessions: [{ agent_id: 'a1', session_key: 'sess-1', last_seen_at: '2026-08-26T00:00:10Z' }],
    });

    const roster = await listAgentRoster(client);

    expect(roster).toHaveLength(2);
    expect(roster!.find((a) => a.id === 'a2')).toMatchObject({
      name: 'decibel-hq/claude-code',
      online: false,
      session_key: null,
    });
  });

  it('reports the resolvable session for an online agent', async () => {
    const client = rosterClient({
      agents: AGENTS,
      sessions: [{ agent_id: 'a1', session_key: 'sess-1', last_seen_at: '2026-08-26T00:00:10Z' }],
    });

    const roster = await listAgentRoster(client);

    expect(roster!.find((a) => a.id === 'a1')).toMatchObject({
      online: true,
      session_key: 'sess-1',
    });
  });

  it('picks the MOST RECENT session when one agent has several live ones', async () => {
    // Mirrors resolve_agent_session's `order by last_seen_at desc limit 1` —
    // two Claude Code windows on one repo are one agent.
    const client = rosterClient({
      agents: AGENTS,
      sessions: [
        { agent_id: 'a1', session_key: 'newest', last_seen_at: '2026-08-26T00:00:30Z' },
        { agent_id: 'a1', session_key: 'older', last_seen_at: '2026-08-26T00:00:05Z' },
      ],
    });

    const roster = await listAgentRoster(client);

    expect(roster!.find((a) => a.id === 'a1')!.session_key).toBe('newest');
  });

  it('applies the 60s liveness window as a server-side filter', async () => {
    const client = rosterClient({ agents: AGENTS, sessions: [] });

    await listAgentRoster(client);

    const sessionQuery = client.queries.find((q) => q.table === 'agent_sessions')!;
    expect(sessionQuery.filters.status).toBe('active');
    const cutoff = Date.parse(sessionQuery.filters['gt:last_seen_at'] as string);
    // ~60s ago, allowing for test execution time.
    expect(Date.now() - cutoff).toBeGreaterThanOrEqual(59_000);
    expect(Date.now() - cutoff).toBeLessThan(65_000);
  });

  it('ignores sessions with no agent_id rather than inventing a roster entry', async () => {
    const client = rosterClient({
      agents: AGENTS,
      sessions: [{ agent_id: null, session_key: 'unstamped', last_seen_at: '2026-08-26T00:00:30Z' }],
    });

    const roster = await listAgentRoster(client);

    expect(roster!.every((a) => a.online === false)).toBe(true);
  });

  it('returns null (not empty) when the table is absent, so "not deployed" is distinguishable', async () => {
    const client = rosterClient({ agentsError: { message: 'relation "hq.agents" does not exist' } });

    await expect(listAgentRoster(client)).resolves.toBeNull();
  });

  it('returns an empty roster when the org genuinely has no agents', async () => {
    const client = rosterClient({ agents: [], sessions: [] });

    await expect(listAgentRoster(client)).resolves.toEqual([]);
  });
});
