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
 *
 * Uses direct imports from @decibel/cli for reliability
 * (no PATH issues in sandboxed environments like Claude Desktop)
 */

import { log } from '../config.js';
import { resolveProjectRoot } from '../projectPaths.js';
import { CallerRole, enforceToolAccess } from './dojoPolicy.js';
import { checkRateLimit, recordRequestStart, recordRequestEnd } from './rateLimiter.js';

// Direct imports from @decibel/cli
import {
  compileContextPack,
  pinFact,
  unpinFact,
  listPinnedFacts,
  appendEvent,
  searchEvents,
  listArtifacts,
  readArtifact,
} from '@decibel/cli/lib/compiler';

// ============================================================================
// Types
// ============================================================================

export interface ContextBaseInput {
  project_id: string;
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
// Helper: Build context with policy enforcement
// ============================================================================

async function buildContext(
  projectId: string,
  callerRole: CallerRole = 'human',
  toolName: string,
  agentId?: string
): Promise<{ projectRoot: string }> {
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
  const project = await resolveProjectRoot(projectId);

  // Audit log for AI callers
  if (callerRole !== 'human') {
    log(`context-audit: [${new Date().toISOString()}] agent=${agentId || 'unknown'} role=${callerRole} tool=${toolName} project=${projectId}`);
  }

  return { projectRoot: project.root };
}

// ============================================================================
// Tool Implementations - Direct imports from @decibel/cli
// ============================================================================

/**
 * Refresh context pack - compile full context
 */
export async function contextRefresh(
  input: ContextRefreshInput
): Promise<ContextRefreshOutput | ContextError> {
  const callerRole = input.caller_role || 'human';

  try {
    const { projectRoot } = await buildContext(
      input.project_id,
      callerRole,
      'decibel_context_refresh',
      input.agent_id
    );

    log(`context: Compiling context pack for ${projectRoot}`);
    const contextPack = compileContextPack(projectRoot, input.sections);

    return {
      status: 'executed',
      context_pack: contextPack as unknown as Record<string, unknown>,
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
    const { projectRoot } = await buildContext(
      input.project_id,
      callerRole,
      'decibel_context_pin',
      input.agent_id
    );

    log(`context: Pinning fact "${input.title}" to ${projectRoot}`);
    const fact = pinFact(projectRoot, input.title, input.body, input.trust, input.refs);

    return {
      status: 'pinned',
      id: fact.id,
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
    const { projectRoot } = await buildContext(
      input.project_id,
      callerRole,
      'decibel_context_unpin',
      input.agent_id
    );

    log(`context: Unpinning fact ${input.id} from ${projectRoot}`);
    const success = unpinFact(projectRoot, input.id);

    if (!success) {
      return {
        status: 'error',
        error: `Fact ${input.id} not found`,
        exitCode: 1,
      };
    }

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
    const { projectRoot } = await buildContext(
      input.project_id,
      callerRole,
      'decibel_context_list',
      input.agent_id
    );

    log(`context: Listing pinned facts from ${projectRoot}`);
    const facts = listPinnedFacts(projectRoot);

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
    const { projectRoot } = await buildContext(
      input.project_id,
      callerRole,
      'decibel_event_append',
      input.agent_id
    );

    log(`context: Appending event "${input.title}" to ${projectRoot}`);
    const event = appendEvent(projectRoot, input.title, input.body, input.tags);

    return {
      status: 'appended',
      event_id: event.id,
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
    const { projectRoot } = await buildContext(
      input.project_id,
      callerRole,
      'decibel_event_search',
      input.agent_id
    );

    log(`context: Searching events for "${input.query}" in ${projectRoot}`);
    const events = searchEvents(projectRoot, input.query, input.limit);

    // Map to output format
    const results: EventRecord[] = events.map(e => ({
      id: e.id,
      title: e.title,
      body: e.body,
      tags: e.tags || [],
      timestamp: e.ts,
    }));

    return {
      status: 'executed',
      results,
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
    const { projectRoot } = await buildContext(
      input.project_id,
      callerRole,
      'decibel_artifact_list',
      input.agent_id
    );

    log(`context: Listing artifacts for run ${input.run_id} in ${projectRoot}`);
    const result = listArtifacts(projectRoot, input.run_id);

    if (!result) {
      return {
        status: 'error',
        error: `Run ${input.run_id} not found`,
        exitCode: 1,
      };
    }

    return {
      status: 'executed',
      run_id: result.run_id,
      artifacts: result.artifacts,
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
    const { projectRoot } = await buildContext(
      input.project_id,
      callerRole,
      'decibel_artifact_read',
      input.agent_id
    );

    log(`context: Reading artifact ${input.name} from run ${input.run_id} in ${projectRoot}`);
    const result = readArtifact(projectRoot, input.run_id, input.name);

    if (!result) {
      return {
        status: 'error',
        error: `Artifact ${input.name} not found in run ${input.run_id}`,
        exitCode: 1,
      };
    }

    return {
      status: 'executed',
      run_id: result.run_id,
      name: result.name,
      content: result.content,
      mime_type: result.mime_type,
    };
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
