import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import {
  coordRegister,
  coordHeartbeat,
  coordLock,
  coordUnlock,
  coordStatus,
  coordLog,
  isCoordError,
} from '../../src/tools/coordinator/coordinator.js';
import { createTestContext, cleanupTestContext, type TestContext } from '../utils/test-context.js';

describe('Coordinator Tools', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupTestContext(ctx);
  });

  // ========================================================================
  // coordRegister
  // ========================================================================

  describe('coordRegister', () => {
    it('registers a new agent', async () => {
      const result = await coordRegister({
        agent_id: 'agent-1',
        capabilities: ['code', 'test'],
      });

      expect(isCoordError(result)).toBe(false);
      if (isCoordError(result)) return;

      expect(result.agent_id).toBe('agent-1');
      expect(result.capabilities).toEqual(['code', 'test']);
      expect(result.registered_at).toBeTruthy();
    });

    it('re-registers same agent (idempotent update)', async () => {
      await coordRegister({
        agent_id: 'agent-1',
        capabilities: ['code'],
      });

      const result = await coordRegister({
        agent_id: 'agent-1',
        capabilities: ['code', 'refactor'],
      });

      expect(isCoordError(result)).toBe(false);
      if (isCoordError(result)) return;

      expect(result.capabilities).toEqual(['code', 'refactor']);

      // Should only have 1 agent entry, not 2
      const status = await coordStatus({});
      if (isCoordError(status)) return;
      expect(status.agents.filter(a => a.id === 'agent-1')).toHaveLength(1);
    });

    it('creates coordinator directory if missing', async () => {
      const coordDir = path.join(ctx.rootDir, '.decibel', 'coordinator');

      // Ensure it doesn't exist yet
      await fs.rm(coordDir, { recursive: true, force: true });

      const result = await coordRegister({
        agent_id: 'agent-1',
        capabilities: ['code'],
      });

      expect(isCoordError(result)).toBe(false);

      // Directory should now exist with agents.yaml
      const agentsFile = path.join(coordDir, 'agents.yaml');
      const stat = await fs.stat(agentsFile);
      expect(stat.isFile()).toBe(true);
    });

    it('logs registration event to events.jsonl', async () => {
      await coordRegister({
        agent_id: 'agent-1',
        capabilities: ['code'],
      });

      const logResult = await coordLog({});
      if (isCoordError(logResult)) return;

      expect(logResult.events.length).toBeGreaterThanOrEqual(1);
      const regEvent = logResult.events.find(e => e.action === 'registered' && e.agent === 'agent-1');
      expect(regEvent).toBeDefined();
    });
  });

  // ========================================================================
  // coordHeartbeat
  // ========================================================================

  describe('coordHeartbeat', () => {
    it('updates agent last_seen', async () => {
      await coordRegister({ agent_id: 'agent-1', capabilities: ['code'] });

      const result = await coordHeartbeat({ agent_id: 'agent-1' });

      expect(isCoordError(result)).toBe(false);
      if (isCoordError(result)) return;

      expect(result.agent_id).toBe('agent-1');
      expect(result.last_seen).toBeTruthy();
    });

    it('updates status and current_task', async () => {
      await coordRegister({ agent_id: 'agent-1', capabilities: ['code'] });

      await coordHeartbeat({
        agent_id: 'agent-1',
        status: 'busy',
        current_task: 'fixing bug #42',
      });

      const status = await coordStatus({});
      if (isCoordError(status)) return;

      const agent = status.agents.find(a => a.id === 'agent-1');
      expect(agent).toBeDefined();
      expect(agent!.status).toBe('busy');
      expect(agent!.current_task).toBe('fixing bug #42');
    });

    it('returns error for unregistered agent', async () => {
      const result = await coordHeartbeat({ agent_id: 'ghost' });

      expect(isCoordError(result)).toBe(true);
      if (!isCoordError(result)) return;

      expect(result.error).toBe('AGENT_NOT_REGISTERED');
    });

    it('detects stale agents', async () => {
      // Register two agents
      await coordRegister({ agent_id: 'agent-1', capabilities: ['code'] });
      await coordRegister({ agent_id: 'agent-2', capabilities: ['test'] });

      // Make agent-2 stale by backdating its last_seen
      const coordDir = path.join(ctx.rootDir, '.decibel', 'coordinator');
      const agentsPath = path.join(coordDir, 'agents.yaml');
      const YAML = (await import('yaml')).default;
      const content = await fs.readFile(agentsPath, 'utf-8');
      const data = YAML.parse(content);
      const staleTime = new Date(Date.now() - 200_000).toISOString(); // 200s ago > 120s threshold
      const agentIdx = data.agents.findIndex((a: { id: string }) => a.id === 'agent-2');
      data.agents[agentIdx].last_seen = staleTime;
      await fs.writeFile(agentsPath, YAML.stringify(data), 'utf-8');

      // Heartbeat from agent-1 should detect agent-2 as stale
      const result = await coordHeartbeat({ agent_id: 'agent-1' });

      expect(isCoordError(result)).toBe(false);
      if (isCoordError(result)) return;

      expect(result.stale_agents).toContain('agent-2');
    });

    it('releases locks held by stale agents', async () => {
      // Setup: agent-2 holds a lock, then goes stale
      await coordRegister({ agent_id: 'agent-1', capabilities: ['code'] });
      await coordRegister({ agent_id: 'agent-2', capabilities: ['test'] });
      await coordLock({ agent_id: 'agent-2', resource: 'src/main.ts' });

      // Backdate agent-2 to make it stale
      const coordDir = path.join(ctx.rootDir, '.decibel', 'coordinator');
      const agentsPath = path.join(coordDir, 'agents.yaml');
      const YAML = (await import('yaml')).default;
      const content = await fs.readFile(agentsPath, 'utf-8');
      const data = YAML.parse(content);
      const staleTime = new Date(Date.now() - 200_000).toISOString();
      const agentIdx = data.agents.findIndex((a: { id: string }) => a.id === 'agent-2');
      data.agents[agentIdx].last_seen = staleTime;
      await fs.writeFile(agentsPath, YAML.stringify(data), 'utf-8');

      // Heartbeat from agent-1 should release agent-2's lock
      const result = await coordHeartbeat({ agent_id: 'agent-1' });

      expect(isCoordError(result)).toBe(false);
      if (isCoordError(result)) return;

      expect(result.released_locks).toContain('src/main.ts');

      // Verify lock is actually gone
      const status = await coordStatus({});
      if (isCoordError(status)) return;
      expect(status.locks.find(l => l.resource === 'src/main.ts')).toBeUndefined();
    });
  });

  // ========================================================================
  // coordLock
  // ========================================================================

  describe('coordLock', () => {
    it('acquires lock on free resource', async () => {
      const result = await coordLock({
        agent_id: 'agent-1',
        resource: 'src/main.ts',
        reason: 'refactoring',
      });

      expect(isCoordError(result)).toBe(false);
      if (isCoordError(result)) return;

      expect(result.acquired).toBe(true);
      expect(result.resource).toBe('src/main.ts');
      expect(result.holder).toBe('agent-1');
      expect(result.expires_at).toBeTruthy();
    });

    it('re-lock by same agent refreshes (idempotent)', async () => {
      const first = await coordLock({
        agent_id: 'agent-1',
        resource: 'src/main.ts',
      });
      if (isCoordError(first)) return;

      const second = await coordLock({
        agent_id: 'agent-1',
        resource: 'src/main.ts',
        reason: 'updated reason',
      });

      expect(isCoordError(second)).toBe(false);
      if (isCoordError(second)) return;

      expect(second.acquired).toBe(true);
      expect(second.holder).toBe('agent-1');
      // held_since should be the original acquire time
      expect(second.held_since).toBe(first.held_since);
    });

    it('lock by different agent FAILS LOUD', async () => {
      await coordLock({ agent_id: 'agent-1', resource: 'src/main.ts' });

      const result = await coordLock({ agent_id: 'agent-2', resource: 'src/main.ts' });

      expect(isCoordError(result)).toBe(false); // not a CoordError, it's a CoordLockOutput
      if (isCoordError(result)) return;

      expect(result.acquired).toBe(false);
      expect(result.holder).toBe('agent-1');
    });

    it('expired locks get cleaned on acquire', async () => {
      // Create a lock, then backdate its expiry
      await coordLock({ agent_id: 'agent-old', resource: 'src/old.ts' });

      const coordDir = path.join(ctx.rootDir, '.decibel', 'coordinator');
      const locksPath = path.join(coordDir, 'locks.yaml');
      const YAML = (await import('yaml')).default;
      const content = await fs.readFile(locksPath, 'utf-8');
      const data = YAML.parse(content);
      // Set expiry to the past
      data.locks[0].expires_at = new Date(Date.now() - 60_000).toISOString();
      await fs.writeFile(locksPath, YAML.stringify(data), 'utf-8');

      // Now a new agent acquires a different resource — expired lock should be cleaned
      const result = await coordLock({ agent_id: 'agent-new', resource: 'src/new.ts' });
      if (isCoordError(result)) return;
      expect(result.acquired).toBe(true);

      // Old lock should be gone
      const status = await coordStatus({});
      if (isCoordError(status)) return;
      expect(status.locks.find(l => l.resource === 'src/old.ts')).toBeUndefined();
    });

    it('records lock events in log', async () => {
      await coordLock({ agent_id: 'agent-1', resource: 'src/main.ts', reason: 'editing' });

      const logResult = await coordLog({});
      if (isCoordError(logResult)) return;

      const lockEvent = logResult.events.find(
        e => e.action === 'lock_acquired' && e.resource === 'src/main.ts'
      );
      expect(lockEvent).toBeDefined();
      expect(lockEvent!.agent).toBe('agent-1');
      expect(lockEvent!.reason).toBe('editing');
    });
  });

  // ========================================================================
  // coordUnlock
  // ========================================================================

  describe('coordUnlock', () => {
    it('releases own lock', async () => {
      await coordLock({ agent_id: 'agent-1', resource: 'src/main.ts' });

      const result = await coordUnlock({ agent_id: 'agent-1', resource: 'src/main.ts' });

      expect(isCoordError(result)).toBe(false);
      if (isCoordError(result)) return;

      expect(result.released).toBe(true);
      expect(result.was_held_by).toBe('agent-1');

      // Verify lock is gone
      const status = await coordStatus({});
      if (isCoordError(status)) return;
      expect(status.locks).toHaveLength(0);
    });

    it('no-op for unheld resource (idempotent)', async () => {
      const result = await coordUnlock({ agent_id: 'agent-1', resource: 'nonexistent.ts' });

      expect(isCoordError(result)).toBe(false);
      if (isCoordError(result)) return;

      expect(result.released).toBe(true);
      expect(result.was_held_by).toBeUndefined();
    });

    it('error when releasing another agent\'s lock', async () => {
      await coordLock({ agent_id: 'agent-1', resource: 'src/main.ts' });

      const result = await coordUnlock({ agent_id: 'agent-2', resource: 'src/main.ts' });

      expect(isCoordError(result)).toBe(true);
      if (!isCoordError(result)) return;

      expect(result.error).toBe('LOCK_HELD_BY_OTHER');
    });
  });

  // ========================================================================
  // coordStatus
  // ========================================================================

  describe('coordStatus', () => {
    it('returns empty state on fresh project', async () => {
      const result = await coordStatus({});

      expect(isCoordError(result)).toBe(false);
      if (isCoordError(result)) return;

      expect(result.agents).toEqual([]);
      expect(result.locks).toEqual([]);
      expect(result.stale_agents).toEqual([]);
    });

    it('returns agents and locks after setup', async () => {
      await coordRegister({ agent_id: 'agent-1', capabilities: ['code'] });
      await coordRegister({ agent_id: 'agent-2', capabilities: ['test'] });
      await coordLock({ agent_id: 'agent-1', resource: 'src/main.ts' });

      const result = await coordStatus({});

      expect(isCoordError(result)).toBe(false);
      if (isCoordError(result)) return;

      expect(result.agents).toHaveLength(2);
      expect(result.locks).toHaveLength(1);
      expect(result.locks[0].resource).toBe('src/main.ts');
      expect(result.locks[0].owner).toBe('agent-1');
    });

    it('identifies stale agents', async () => {
      await coordRegister({ agent_id: 'stale-agent', capabilities: ['code'] });

      // Backdate agent to make it stale
      const coordDir = path.join(ctx.rootDir, '.decibel', 'coordinator');
      const agentsPath = path.join(coordDir, 'agents.yaml');
      const YAML = (await import('yaml')).default;
      const content = await fs.readFile(agentsPath, 'utf-8');
      const data = YAML.parse(content);
      data.agents[0].last_seen = new Date(Date.now() - 200_000).toISOString();
      await fs.writeFile(agentsPath, YAML.stringify(data), 'utf-8');

      const result = await coordStatus({});

      expect(isCoordError(result)).toBe(false);
      if (isCoordError(result)) return;

      expect(result.stale_agents).toContain('stale-agent');
    });
  });

  // ========================================================================
  // coordLog
  // ========================================================================

  describe('coordLog', () => {
    it('returns empty on fresh project', async () => {
      const result = await coordLog({});

      expect(isCoordError(result)).toBe(false);
      if (isCoordError(result)) return;

      expect(result.events).toEqual([]);
      expect(result.total_count).toBe(0);
    });

    it('returns events in reverse chronological order', async () => {
      await coordRegister({ agent_id: 'agent-1', capabilities: ['code'] });
      await coordLock({ agent_id: 'agent-1', resource: 'file-a.ts' });
      await coordLock({ agent_id: 'agent-1', resource: 'file-b.ts' });

      const result = await coordLog({});
      if (isCoordError(result)) return;

      expect(result.events.length).toBeGreaterThanOrEqual(3);
      // Most recent event should be first
      const timestamps = result.events.map(e => new Date(e.ts).getTime());
      for (let i = 1; i < timestamps.length; i++) {
        expect(timestamps[i - 1]).toBeGreaterThanOrEqual(timestamps[i]);
      }
    });

    it('filters by agent_id', async () => {
      await coordRegister({ agent_id: 'agent-1', capabilities: ['code'] });
      await coordRegister({ agent_id: 'agent-2', capabilities: ['test'] });

      const result = await coordLog({ agent_id: 'agent-1' });
      if (isCoordError(result)) return;

      expect(result.events.length).toBeGreaterThanOrEqual(1);
      expect(result.events.every(e => e.agent === 'agent-1')).toBe(true);
    });

    it('filters by action', async () => {
      await coordRegister({ agent_id: 'agent-1', capabilities: ['code'] });
      await coordLock({ agent_id: 'agent-1', resource: 'file.ts' });
      await coordUnlock({ agent_id: 'agent-1', resource: 'file.ts' });

      const result = await coordLog({ action: 'lock_acquired' });
      if (isCoordError(result)) return;

      expect(result.events.length).toBeGreaterThanOrEqual(1);
      expect(result.events.every(e => e.action === 'lock_acquired')).toBe(true);
    });

    it('respects limit', async () => {
      // Generate several events
      await coordRegister({ agent_id: 'agent-1', capabilities: ['code'] });
      await coordLock({ agent_id: 'agent-1', resource: 'a.ts' });
      await coordLock({ agent_id: 'agent-1', resource: 'b.ts' });
      await coordLock({ agent_id: 'agent-1', resource: 'c.ts' });

      const result = await coordLog({ limit: 2 });
      if (isCoordError(result)) return;

      expect(result.events).toHaveLength(2);
      expect(result.total_count).toBeGreaterThanOrEqual(4); // at least register + 3 locks
    });
  });
});
