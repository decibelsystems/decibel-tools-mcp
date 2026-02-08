/**
 * Minimal Coordinator for Multi-Chat v1 (ADR-0004)
 *
 * Three primitives:
 * 1. Lock Table - exclusive locks for resources
 * 2. Agent Registry - who's online and what they can do
 * 3. Event Log - append-only audit trail
 *
 * Design principles:
 * - Fail loud: lock conflicts return failure, don't queue
 * - File-based: YAML/JSONL in .decibel/coordinator/
 * - Idempotent: re-locking same resource by same agent = OK
 * - Auto-cleanup: stale agents (120s) get locks released
 */

import fs from 'fs/promises';
import path from 'path';
import YAML from 'yaml';
import { log } from '../../config.js';
import { ensureDir } from '../../dataRoot.js';
import { resolveProjectPaths, ResolvedProjectPaths } from '../../projectRegistry.js';

// ============================================================================
// Constants
// ============================================================================

const LOCK_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
const STALE_THRESHOLD_MS = 120 * 1000; // 2 minutes (2 missed heartbeats)
const DEFAULT_EVENT_LIMIT = 50;

// ============================================================================
// Types
// ============================================================================

export interface Lock {
  resource: string;
  owner: string;
  acquired_at: string;
  expires_at: string;
  reason?: string;
}

export interface Agent {
  id: string;
  capabilities: string[];
  status: 'active' | 'busy' | 'idle';
  last_seen: string;
  current_task?: string;
}

export interface CoordEvent {
  ts: string;
  agent: string;
  action: string;
  resource?: string;
  reason?: string;
  details?: Record<string, unknown>;
}

// Input/Output types
export interface CoordRegisterInput {
  agent_id: string;
  capabilities: string[];
  project_id?: string;
}

export interface CoordRegisterOutput {
  agent_id: string;
  registered_at: string;
  capabilities: string[];
}

export interface CoordHeartbeatInput {
  agent_id: string;
  current_task?: string;
  status?: 'active' | 'busy' | 'idle';
  project_id?: string;
}

export interface CoordHeartbeatOutput {
  agent_id: string;
  last_seen: string;
  stale_agents: string[];
  released_locks: string[];
}

export interface CoordLockInput {
  agent_id: string;
  resource: string;
  reason?: string;
  project_id?: string;
}

export interface CoordLockOutput {
  acquired: boolean;
  resource: string;
  holder?: string;
  held_since?: string;
  expires_at?: string;
}

export interface CoordUnlockInput {
  agent_id: string;
  resource: string;
  project_id?: string;
}

export interface CoordUnlockOutput {
  released: boolean;
  resource: string;
  was_held_by?: string;
}

export interface CoordStatusInput {
  project_id?: string;
}

export interface CoordStatusOutput {
  agents: Agent[];
  locks: Lock[];
  stale_agents: string[];
}

export interface CoordLogInput {
  project_id?: string;
  limit?: number;
  agent_id?: string;
  action?: string;
}

export interface CoordLogOutput {
  events: CoordEvent[];
  total_count: number;
}

// Error type
export interface CoordError {
  error: string;
  message: string;
}

// ============================================================================
// Helpers
// ============================================================================

function isCoordError(result: unknown): result is CoordError {
  return typeof result === 'object' && result !== null && 'error' in result;
}

function makeError(code: string, message: string): CoordError {
  return { error: code, message };
}

function getCoordDir(resolved: ResolvedProjectPaths): string {
  return resolved.subPath('coordinator');
}

async function readLocks(coordDir: string): Promise<Lock[]> {
  const locksPath = path.join(coordDir, 'locks.yaml');
  try {
    const content = await fs.readFile(locksPath, 'utf-8');
    const data = YAML.parse(content);
    return data?.locks || [];
  } catch {
    return [];
  }
}

async function writeLocks(coordDir: string, locks: Lock[]): Promise<void> {
  const locksPath = path.join(coordDir, 'locks.yaml');
  const content = YAML.stringify({ locks });
  await fs.writeFile(locksPath, content, 'utf-8');
}

async function readAgents(coordDir: string): Promise<Agent[]> {
  const agentsPath = path.join(coordDir, 'agents.yaml');
  try {
    const content = await fs.readFile(agentsPath, 'utf-8');
    const data = YAML.parse(content);
    return data?.agents || [];
  } catch {
    return [];
  }
}

async function writeAgents(coordDir: string, agents: Agent[]): Promise<void> {
  const agentsPath = path.join(coordDir, 'agents.yaml');
  const content = YAML.stringify({ agents });
  await fs.writeFile(agentsPath, content, 'utf-8');
}

async function appendEvent(coordDir: string, event: CoordEvent): Promise<void> {
  const eventsPath = path.join(coordDir, 'events.jsonl');
  const line = JSON.stringify(event) + '\n';
  await fs.appendFile(eventsPath, line, 'utf-8');
}

async function readEvents(coordDir: string, limit: number): Promise<CoordEvent[]> {
  const eventsPath = path.join(coordDir, 'events.jsonl');
  try {
    const content = await fs.readFile(eventsPath, 'utf-8');
    const lines = content.trim().split('\n').filter(l => l.length > 0);
    const events = lines.map(l => JSON.parse(l) as CoordEvent);
    // Return most recent first
    return events.reverse().slice(0, limit);
  } catch {
    return [];
  }
}

function isExpired(expiresAt: string): boolean {
  return new Date(expiresAt).getTime() < Date.now();
}

function isStale(lastSeen: string): boolean {
  return Date.now() - new Date(lastSeen).getTime() > STALE_THRESHOLD_MS;
}

function cleanExpiredLocks(locks: Lock[]): { active: Lock[]; expired: Lock[] } {
  const now = Date.now();
  const active: Lock[] = [];
  const expired: Lock[] = [];

  for (const lock of locks) {
    if (new Date(lock.expires_at).getTime() < now) {
      expired.push(lock);
    } else {
      active.push(lock);
    }
  }

  return { active, expired };
}

// ============================================================================
// Tool Implementations
// ============================================================================

export async function coordRegister(
  input: CoordRegisterInput
): Promise<CoordRegisterOutput | CoordError> {
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.project_id);
  } catch {
    return makeError('PROJECT_NOT_FOUND', 'Could not resolve project. Specify project_id or run from project directory.');
  }

  const coordDir = getCoordDir(resolved);
  ensureDir(coordDir);

  const now = new Date().toISOString();
  const agents = await readAgents(coordDir);

  // Find or create agent
  const existingIdx = agents.findIndex(a => a.id === input.agent_id);
  const agent: Agent = {
    id: input.agent_id,
    capabilities: input.capabilities,
    status: 'active',
    last_seen: now,
  };

  if (existingIdx >= 0) {
    agents[existingIdx] = agent;
  } else {
    agents.push(agent);
  }

  await writeAgents(coordDir, agents);

  // Log event
  await appendEvent(coordDir, {
    ts: now,
    agent: input.agent_id,
    action: 'registered',
    details: { capabilities: input.capabilities },
  });

  log(`Coordinator: Agent ${input.agent_id} registered (project: ${resolved.id})`);

  return {
    agent_id: input.agent_id,
    registered_at: now,
    capabilities: input.capabilities,
  };
}

export async function coordHeartbeat(
  input: CoordHeartbeatInput
): Promise<CoordHeartbeatOutput | CoordError> {
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.project_id);
  } catch {
    return makeError('PROJECT_NOT_FOUND', 'Could not resolve project.');
  }

  const coordDir = getCoordDir(resolved);
  ensureDir(coordDir);

  const now = new Date().toISOString();

  // Update agent
  const agents = await readAgents(coordDir);
  const agentIdx = agents.findIndex(a => a.id === input.agent_id);

  if (agentIdx < 0) {
    return makeError('AGENT_NOT_REGISTERED', `Agent ${input.agent_id} not registered. Call coord_register first.`);
  }

  agents[agentIdx].last_seen = now;
  if (input.status) agents[agentIdx].status = input.status;
  if (input.current_task !== undefined) agents[agentIdx].current_task = input.current_task;

  // Find stale agents
  const staleAgents = agents.filter(a => a.id !== input.agent_id && isStale(a.last_seen)).map(a => a.id);

  // Release locks held by stale agents
  let locks = await readLocks(coordDir);
  const releasedLocks: string[] = [];

  for (const staleId of staleAgents) {
    const staleLocks = locks.filter(l => l.owner === staleId);
    for (const lock of staleLocks) {
      releasedLocks.push(lock.resource);
      await appendEvent(coordDir, {
        ts: now,
        agent: staleId,
        action: 'lock_expired_stale',
        resource: lock.resource,
        details: { released_by_heartbeat_from: input.agent_id },
      });
    }
    locks = locks.filter(l => l.owner !== staleId);
  }

  // Also clean expired locks
  const { active, expired } = cleanExpiredLocks(locks);
  for (const lock of expired) {
    if (!releasedLocks.includes(lock.resource)) {
      releasedLocks.push(lock.resource);
      await appendEvent(coordDir, {
        ts: now,
        agent: lock.owner,
        action: 'lock_expired_timeout',
        resource: lock.resource,
      });
    }
  }

  await writeAgents(coordDir, agents);
  await writeLocks(coordDir, active);

  log(`Coordinator: Heartbeat from ${input.agent_id} (stale: ${staleAgents.length}, released: ${releasedLocks.length})`);

  return {
    agent_id: input.agent_id,
    last_seen: now,
    stale_agents: staleAgents,
    released_locks: releasedLocks,
  };
}

export async function coordLock(
  input: CoordLockInput
): Promise<CoordLockOutput | CoordError> {
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.project_id);
  } catch {
    return makeError('PROJECT_NOT_FOUND', 'Could not resolve project.');
  }

  const coordDir = getCoordDir(resolved);
  ensureDir(coordDir);

  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + LOCK_EXPIRY_MS).toISOString();

  // Clean expired locks first
  let locks = await readLocks(coordDir);
  const { active } = cleanExpiredLocks(locks);
  locks = active;

  // Check if resource is already locked
  const existing = locks.find(l => l.resource === input.resource);

  if (existing) {
    // Same owner = idempotent success
    if (existing.owner === input.agent_id) {
      // Refresh the lock
      existing.expires_at = expiresAt;
      if (input.reason) existing.reason = input.reason;
      await writeLocks(coordDir, locks);

      return {
        acquired: true,
        resource: input.resource,
        holder: input.agent_id,
        held_since: existing.acquired_at,
        expires_at: expiresAt,
      };
    }

    // Different owner = FAIL LOUD
    await appendEvent(coordDir, {
      ts: nowIso,
      agent: input.agent_id,
      action: 'lock_denied',
      resource: input.resource,
      details: { holder: existing.owner, held_since: existing.acquired_at },
    });

    log(`Coordinator: Lock DENIED for ${input.agent_id} on ${input.resource} (held by ${existing.owner})`);

    return {
      acquired: false,
      resource: input.resource,
      holder: existing.owner,
      held_since: existing.acquired_at,
    };
  }

  // Acquire lock
  const newLock: Lock = {
    resource: input.resource,
    owner: input.agent_id,
    acquired_at: nowIso,
    expires_at: expiresAt,
    reason: input.reason,
  };

  locks.push(newLock);
  await writeLocks(coordDir, locks);

  await appendEvent(coordDir, {
    ts: nowIso,
    agent: input.agent_id,
    action: 'lock_acquired',
    resource: input.resource,
    reason: input.reason,
  });

  log(`Coordinator: Lock acquired by ${input.agent_id} on ${input.resource}`);

  return {
    acquired: true,
    resource: input.resource,
    holder: input.agent_id,
    held_since: nowIso,
    expires_at: expiresAt,
  };
}

export async function coordUnlock(
  input: CoordUnlockInput
): Promise<CoordUnlockOutput | CoordError> {
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.project_id);
  } catch {
    return makeError('PROJECT_NOT_FOUND', 'Could not resolve project.');
  }

  const coordDir = getCoordDir(resolved);
  const now = new Date().toISOString();

  let locks = await readLocks(coordDir);
  const existing = locks.find(l => l.resource === input.resource);

  if (!existing) {
    // Not held - idempotent success
    return {
      released: true,
      resource: input.resource,
    };
  }

  if (existing.owner !== input.agent_id) {
    // Held by different agent - error
    return makeError(
      'LOCK_HELD_BY_OTHER',
      `Cannot release lock on ${input.resource}: held by ${existing.owner}, not ${input.agent_id}`
    );
  }

  // Release lock
  locks = locks.filter(l => l.resource !== input.resource);
  await writeLocks(coordDir, locks);

  await appendEvent(coordDir, {
    ts: now,
    agent: input.agent_id,
    action: 'lock_released',
    resource: input.resource,
  });

  log(`Coordinator: Lock released by ${input.agent_id} on ${input.resource}`);

  return {
    released: true,
    resource: input.resource,
    was_held_by: input.agent_id,
  };
}

export async function coordStatus(
  input: CoordStatusInput
): Promise<CoordStatusOutput | CoordError> {
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.project_id);
  } catch {
    return makeError('PROJECT_NOT_FOUND', 'Could not resolve project.');
  }

  const coordDir = getCoordDir(resolved);

  const agents = await readAgents(coordDir);
  let locks = await readLocks(coordDir);

  // Clean expired locks for accurate status
  const { active } = cleanExpiredLocks(locks);
  locks = active;

  // Find stale agents
  const staleAgents = agents.filter(a => isStale(a.last_seen)).map(a => a.id);

  return {
    agents,
    locks,
    stale_agents: staleAgents,
  };
}

export async function coordLog(
  input: CoordLogInput
): Promise<CoordLogOutput | CoordError> {
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.project_id);
  } catch {
    return makeError('PROJECT_NOT_FOUND', 'Could not resolve project.');
  }

  const coordDir = getCoordDir(resolved);
  const limit = input.limit || DEFAULT_EVENT_LIMIT;

  let events = await readEvents(coordDir, 1000); // Read more for filtering

  // Apply filters
  if (input.agent_id) {
    events = events.filter(e => e.agent === input.agent_id);
  }
  if (input.action) {
    events = events.filter(e => e.action === input.action);
  }

  const totalCount = events.length;
  events = events.slice(0, limit);

  return {
    events,
    total_count: totalCount,
  };
}

// ============================================================================
// Type guard export
// ============================================================================

export { isCoordError };
