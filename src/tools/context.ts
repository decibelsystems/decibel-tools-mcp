/**
 * Context Pack MCP Tools
 *
 * Provides MCP tools for AI to:
 * - Refresh context pack (compile full context)
 * - Pin/unpin facts (persistent memory)
 * - Append/search events (activity journal)
 * - List/read artifacts (experiment outputs)
 *
 * Based on ADR-002: Context Pack
 */

import fs from 'fs/promises';
import path from 'path';
import { log } from '../config.js';
import { resolveProjectPaths, ResolvedProjectPaths } from '../projectRegistry.js';
import { ensureDir } from '../dataRoot.js';
import { CallerRole, enforceToolAccess } from './dojoPolicy.js';
import { checkRateLimit, recordRequestStart, recordRequestEnd } from './rateLimiter.js';

// ============================================================================
// Types
// ============================================================================

export interface ContextBaseInput {
  projectId?: string;
  caller_role?: CallerRole;
  agent_id?: string;
}

// Context Refresh
export interface ContextRefreshInput extends ContextBaseInput {
  scope?: string;
  sections?: string[];
  max_bytes?: number;
}

export interface ContextRefreshOutput {
  status: 'executed';
  context_pack: Record<string, unknown>;
}

// Pin/Unpin Facts
export interface ContextPinInput extends ContextBaseInput {
  title: string;
  body?: string;
  trust?: 'high' | 'medium' | 'low';
  refs?: string[];
}

export interface ContextPinOutput {
  status: 'pinned';
  id: string;
}

export interface ContextUnpinInput extends ContextBaseInput {
  id: string;
}

export interface ContextUnpinOutput {
  status: 'unpinned';
}

export interface ContextListInput extends ContextBaseInput {}

export interface PinnedFact {
  id: string;
  title: string;
  body?: string;
  trust: string;
  refs?: string[];
  pinned_at: string;
}

export interface ContextListOutput {
  status: 'executed';
  facts: PinnedFact[];
}

// Event Journal
export interface EventAppendInput extends ContextBaseInput {
  title: string;
  body?: string;
  tags?: string[];
}

export interface EventAppendOutput {
  status: 'appended';
  event_id: string;
}

export interface EventSearchInput extends ContextBaseInput {
  query: string;
  limit?: number;
}

export interface EventRecord {
  id: string;
  title: string;
  body?: string;
  tags: string[];
  timestamp: string;
}

export interface EventSearchOutput {
  status: 'executed';
  results: EventRecord[];
}

// Artifact Access
export interface ArtifactListInput extends ContextBaseInput {
  run_id: string;
}

export interface ArtifactInfo {
  name: string;
  size: number;
  ref: string;
}

export interface ArtifactListOutput {
  status: 'executed';
  run_id: string;
  artifacts: ArtifactInfo[];
}

export interface ArtifactReadInput extends ContextBaseInput {
  run_id: string;
  name: string;
}

export interface ArtifactReadOutput {
  status: 'executed';
  run_id: string;
  name: string;
  content: string;
  mime_type: string;
}

export interface ContextError {
  status: 'error';
  error: string;
  exitCode: number;
}

// ============================================================================
// Internal Types
// ============================================================================

interface StoredFact {
  id: string;
  title: string;
  body?: string;
  trust: 'high' | 'medium' | 'low';
  refs?: string[];
  ts: string;
}

interface StoredEvent {
  id: string;
  title: string;
  body?: string;
  tags?: string[];
  ts: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

async function buildContext(
  projectId: string | undefined,
  callerRole: CallerRole = 'human',
  toolName: string,
  agentId?: string
): Promise<{ resolved: ResolvedProjectPaths }> {
  // Check rate limits
  const rateLimitResult = checkRateLimit(callerRole);
  if (!rateLimitResult.allowed) {
    throw new Error(`Rate limit: ${rateLimitResult.reason}`);
  }

  // Enforce policy
  enforceToolAccess(toolName, callerRole);

  // Record request start
  recordRequestStart(callerRole);

  // Resolve paths
  const resolved = resolveProjectPaths(projectId);

  // Audit log for AI callers
  if (callerRole !== 'human') {
    log(`context-audit: [${new Date().toISOString()}] agent=${agentId || 'unknown'} role=${callerRole} tool=${toolName} project=${resolved.id}`);
  }

  return { resolved };
}

// ============================================================================
// Facts Storage
// ============================================================================

async function getFactsPath(resolved: ResolvedProjectPaths): Promise<string> {
  const dir = resolved.subPath('context', 'facts');
  ensureDir(dir);
  return path.join(dir, 'facts.json');
}

async function loadFacts(resolved: ResolvedProjectPaths): Promise<StoredFact[]> {
  const factsPath = await getFactsPath(resolved);
  try {
    const content = await fs.readFile(factsPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return [];
  }
}

async function saveFacts(resolved: ResolvedProjectPaths, facts: StoredFact[]): Promise<void> {
  const factsPath = await getFactsPath(resolved);
  await fs.writeFile(factsPath, JSON.stringify(facts, null, 2), 'utf-8');
}

// ============================================================================
// Events Storage
// ============================================================================

async function getEventsPath(resolved: ResolvedProjectPaths): Promise<string> {
  const dir = resolved.subPath('context', 'events');
  ensureDir(dir);
  return path.join(dir, 'events.json');
}

async function loadEvents(resolved: ResolvedProjectPaths): Promise<StoredEvent[]> {
  const eventsPath = await getEventsPath(resolved);
  try {
    const content = await fs.readFile(eventsPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return [];
  }
}

async function saveEvents(resolved: ResolvedProjectPaths, events: StoredEvent[]): Promise<void> {
  const eventsPath = await getEventsPath(resolved);
  await fs.writeFile(eventsPath, JSON.stringify(events, null, 2), 'utf-8');
}

// ============================================================================
// Context Pack Compilation
// ============================================================================

async function compileContextPack(
  resolved: ResolvedProjectPaths,
  sections?: string[]
): Promise<Record<string, unknown>> {
  const pack: Record<string, unknown> = {
    project_id: resolved.id,
    compiled_at: new Date().toISOString(),
  };

  const includeSections = sections || ['facts', 'events', 'decisions', 'issues'];

  // Load facts
  if (includeSections.includes('facts')) {
    pack.facts = await loadFacts(resolved);
  }

  // Load events (last 50)
  if (includeSections.includes('events')) {
    const events = await loadEvents(resolved);
    pack.events = events.slice(-50);
  }

  // Load recent design decisions
  if (includeSections.includes('decisions')) {
    const designerDir = resolved.subPath('designer');
    const decisions: Array<{ area: string; file: string; summary?: string }> = [];
    try {
      const areas = await fs.readdir(designerDir);
      for (const area of areas.slice(0, 5)) {
        const areaPath = path.join(designerDir, area);
        const stat = await fs.stat(areaPath);
        if (stat.isDirectory()) {
          const files = await fs.readdir(areaPath);
          for (const file of files.slice(-3)) {
            if (file.endsWith('.md')) {
              decisions.push({ area, file });
            }
          }
        }
      }
    } catch {
      // Directory doesn't exist yet
    }
    pack.decisions = decisions;
  }

  // Load open issues
  if (includeSections.includes('issues')) {
    const issuesDir = resolved.subPath('sentinel', 'issues');
    const issues: Array<{ file: string; severity?: string }> = [];
    try {
      const files = await fs.readdir(issuesDir);
      for (const file of files.slice(-10)) {
        if (file.endsWith('.md')) {
          issues.push({ file });
        }
      }
    } catch {
      // Directory doesn't exist yet
    }
    pack.issues = issues;
  }

  return pack;
}

// ============================================================================
// Tool Implementations
// ============================================================================

/**
 * Refresh context pack - compile full context
 */
export async function contextRefresh(
  input: ContextRefreshInput
): Promise<ContextRefreshOutput | ContextError> {
  const callerRole = input.caller_role || 'human';

  try {
    const { resolved } = await buildContext(
      input.projectId,
      callerRole,
      'decibel_context_refresh',
      input.agent_id
    );

    log(`context: Compiling context pack for ${resolved.id}`);
    const contextPack = await compileContextPack(resolved, input.sections);

    return {
      status: 'executed',
      context_pack: contextPack,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`context: Error compiling context pack: ${message}`);
    return {
      status: 'error',
      error: message,
      exitCode: 1,
    };
  } finally {
    recordRequestEnd(callerRole);
  }
}

/**
 * Pin a fact to persistent memory
 */
export async function contextPin(
  input: ContextPinInput
): Promise<ContextPinOutput | ContextError> {
  const callerRole = input.caller_role || 'human';

  try {
    const { resolved } = await buildContext(
      input.projectId,
      callerRole,
      'decibel_context_pin',
      input.agent_id
    );

    log(`context: Pinning fact "${input.title}" to ${resolved.id}`);

    const facts = await loadFacts(resolved);
    const newFact: StoredFact = {
      id: generateId(),
      title: input.title,
      body: input.body,
      trust: input.trust || 'medium',
      refs: input.refs,
      ts: new Date().toISOString(),
    };
    facts.push(newFact);
    await saveFacts(resolved, facts);

    return {
      status: 'pinned',
      id: newFact.id,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`context: Error pinning fact: ${message}`);
    return {
      status: 'error',
      error: message,
      exitCode: 1,
    };
  } finally {
    recordRequestEnd(callerRole);
  }
}

/**
 * Unpin a fact from persistent memory
 */
export async function contextUnpin(
  input: ContextUnpinInput
): Promise<ContextUnpinOutput | ContextError> {
  const callerRole = input.caller_role || 'human';

  try {
    const { resolved } = await buildContext(
      input.projectId,
      callerRole,
      'decibel_context_unpin',
      input.agent_id
    );

    log(`context: Unpinning fact ${input.id} from ${resolved.id}`);

    const facts = await loadFacts(resolved);
    const index = facts.findIndex(f => f.id === input.id);

    if (index === -1) {
      return {
        status: 'error',
        error: `Fact ${input.id} not found`,
        exitCode: 1,
      };
    }

    facts.splice(index, 1);
    await saveFacts(resolved, facts);

    return { status: 'unpinned' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`context: Error unpinning fact: ${message}`);
    return {
      status: 'error',
      error: message,
      exitCode: 1,
    };
  } finally {
    recordRequestEnd(callerRole);
  }
}

/**
 * List pinned facts
 */
export async function contextList(
  input: ContextListInput
): Promise<ContextListOutput | ContextError> {
  const callerRole = input.caller_role || 'human';

  try {
    const { resolved } = await buildContext(
      input.projectId,
      callerRole,
      'decibel_context_list',
      input.agent_id
    );

    log(`context: Listing pinned facts from ${resolved.id}`);
    const facts = await loadFacts(resolved);

    // Map to output format
    const mappedFacts: PinnedFact[] = facts.map(f => ({
      id: f.id,
      title: f.title,
      body: f.body,
      trust: f.trust,
      refs: f.refs,
      pinned_at: f.ts,
    }));

    return {
      status: 'executed',
      facts: mappedFacts,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`context: Error listing facts: ${message}`);
    return {
      status: 'error',
      error: message,
      exitCode: 1,
    };
  } finally {
    recordRequestEnd(callerRole);
  }
}

/**
 * Append an event to the journal
 */
export async function eventAppend(
  input: EventAppendInput
): Promise<EventAppendOutput | ContextError> {
  const callerRole = input.caller_role || 'human';

  try {
    const { resolved } = await buildContext(
      input.projectId,
      callerRole,
      'decibel_event_append',
      input.agent_id
    );

    log(`context: Appending event "${input.title}" to ${resolved.id}`);

    const events = await loadEvents(resolved);
    const newEvent: StoredEvent = {
      id: generateId(),
      title: input.title,
      body: input.body,
      tags: input.tags,
      ts: new Date().toISOString(),
    };
    events.push(newEvent);
    await saveEvents(resolved, events);

    return {
      status: 'appended',
      event_id: newEvent.id,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`context: Error appending event: ${message}`);
    return {
      status: 'error',
      error: message,
      exitCode: 1,
    };
  } finally {
    recordRequestEnd(callerRole);
  }
}

/**
 * Search events in the journal
 */
export async function eventSearch(
  input: EventSearchInput
): Promise<EventSearchOutput | ContextError> {
  const callerRole = input.caller_role || 'human';

  try {
    const { resolved } = await buildContext(
      input.projectId,
      callerRole,
      'decibel_event_search',
      input.agent_id
    );

    log(`context: Searching events for "${input.query}" in ${resolved.id}`);

    const events = await loadEvents(resolved);
    const queryLower = input.query.toLowerCase();

    // Simple text search across title, body, and tags
    let results = events.filter(e => {
      const titleMatch = e.title.toLowerCase().includes(queryLower);
      const bodyMatch = e.body?.toLowerCase().includes(queryLower);
      const tagMatch = e.tags?.some(t => t.toLowerCase().includes(queryLower));
      return titleMatch || bodyMatch || tagMatch;
    });

    // Most recent first, apply limit
    results = results.reverse();
    if (input.limit && input.limit > 0) {
      results = results.slice(0, input.limit);
    }

    // Map to output format
    const mappedResults: EventRecord[] = results.map(e => ({
      id: e.id,
      title: e.title,
      body: e.body,
      tags: e.tags || [],
      timestamp: e.ts,
    }));

    return {
      status: 'executed',
      results: mappedResults,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`context: Error searching events: ${message}`);
    return {
      status: 'error',
      error: message,
      exitCode: 1,
    };
  } finally {
    recordRequestEnd(callerRole);
  }
}

/**
 * List artifacts for a run
 */
export async function artifactList(
  input: ArtifactListInput
): Promise<ArtifactListOutput | ContextError> {
  const callerRole = input.caller_role || 'human';

  try {
    const { resolved } = await buildContext(
      input.projectId,
      callerRole,
      'decibel_artifact_list',
      input.agent_id
    );

    log(`context: Listing artifacts for run ${input.run_id} in ${resolved.id}`);

    const runDir = resolved.subPath('context', 'artifacts', input.run_id);
    const artifacts: ArtifactInfo[] = [];

    try {
      const files = await fs.readdir(runDir);
      for (const file of files) {
        const filePath = path.join(runDir, file);
        const stat = await fs.stat(filePath);
        if (stat.isFile()) {
          artifacts.push({
            name: file,
            size: stat.size,
            ref: filePath,
          });
        }
      }
    } catch {
      return {
        status: 'error',
        error: `Run ${input.run_id} not found`,
        exitCode: 1,
      };
    }

    return {
      status: 'executed',
      run_id: input.run_id,
      artifacts,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`context: Error listing artifacts: ${message}`);
    return {
      status: 'error',
      error: message,
      exitCode: 1,
    };
  } finally {
    recordRequestEnd(callerRole);
  }
}

/**
 * Read an artifact by run_id and name
 */
export async function artifactRead(
  input: ArtifactReadInput
): Promise<ArtifactReadOutput | ContextError> {
  const callerRole = input.caller_role || 'human';

  try {
    const { resolved } = await buildContext(
      input.projectId,
      callerRole,
      'decibel_artifact_read',
      input.agent_id
    );

    log(`context: Reading artifact ${input.name} from run ${input.run_id} in ${resolved.id}`);

    const artifactPath = resolved.subPath('context', 'artifacts', input.run_id, input.name);

    try {
      const content = await fs.readFile(artifactPath, 'utf-8');

      // Determine mime type from extension
      const ext = path.extname(input.name).toLowerCase();
      const mimeTypes: Record<string, string> = {
        '.json': 'application/json',
        '.txt': 'text/plain',
        '.md': 'text/markdown',
        '.html': 'text/html',
        '.csv': 'text/csv',
        '.xml': 'application/xml',
        '.yaml': 'application/yaml',
        '.yml': 'application/yaml',
      };
      const mimeType = mimeTypes[ext] || 'application/octet-stream';

      return {
        status: 'executed',
        run_id: input.run_id,
        name: input.name,
        content,
        mime_type: mimeType,
      };
    } catch {
      return {
        status: 'error',
        error: `Artifact ${input.name} not found in run ${input.run_id}`,
        exitCode: 1,
      };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`context: Error reading artifact: ${message}`);
    return {
      status: 'error',
      error: message,
      exitCode: 1,
    };
  } finally {
    recordRequestEnd(callerRole);
  }
}

/**
 * Type guard for ContextError
 */
export function isContextError(result: unknown): result is ContextError {
  return (
    typeof result === 'object' &&
    result !== null &&
    'status' in result &&
    (result as Record<string, unknown>).status === 'error'
  );
}
