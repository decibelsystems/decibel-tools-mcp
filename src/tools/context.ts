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

import { spawn } from 'child_process';
import { log } from '../config.js';
import { resolveProjectRoot } from '../projectPaths.js';
import { CallerRole, enforceToolAccess } from './dojoPolicy.js';
import { checkRateLimit, recordRequestStart, recordRequestEnd } from './rateLimiter.js';

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
// Constants
// ============================================================================

const DECIBEL_COMMAND = 'decibel';

// ============================================================================
// Helper: Execute decibel CLI command
// ============================================================================

async function execDecibel(
  args: string[],
  cwd?: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  log(`context: Running ${DECIBEL_COMMAND} ${args.join(' ')}${cwd ? ` (cwd: ${cwd})` : ''}`);

  return new Promise((resolve) => {
    const proc = spawn(DECIBEL_COMMAND, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
      cwd: cwd || process.cwd(),
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('error', (err) => {
      log(`context: Process error: ${err.message}`);
      resolve({
        stdout: '',
        stderr: err.message,
        exitCode: -1,
      });
    });

    proc.on('close', (code) => {
      resolve({
        stdout,
        stderr,
        exitCode: code ?? -1,
      });
    });
  });
}

/**
 * Strip ANSI escape codes from string
 */
function stripAnsi(str: string): string {
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
}

/**
 * Build context with policy enforcement
 */
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
    const { projectRoot } = await buildContext(
      input.project_id,
      callerRole,
      'decibel_context_refresh',
      input.agent_id
    );

    const args = ['context', 'refresh', '--json'];

    if (input.sections && input.sections.length > 0) {
      args.push('--sections', input.sections.join(','));
    }

    const { stdout, stderr, exitCode } = await execDecibel(args, projectRoot);

    if (exitCode !== 0) {
      return {
        status: 'error',
        error: stripAnsi(stderr).slice(0, 500) || `Exit code ${exitCode}`,
        exitCode,
      };
    }

    try {
      const contextPack = JSON.parse(stripAnsi(stdout));
      return {
        status: 'executed',
        context_pack: contextPack,
      };
    } catch {
      return {
        status: 'executed',
        context_pack: { raw: stripAnsi(stdout) },
      };
    }
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

    const args = ['context', 'pin', '--title', input.title];

    if (input.body) {
      args.push('--body', input.body);
    }

    if (input.trust) {
      args.push('--trust', input.trust);
    }

    if (input.refs && input.refs.length > 0) {
      args.push('--refs', input.refs.join(','));
    }

    args.push('--json');

    const { stdout, stderr, exitCode } = await execDecibel(args, projectRoot);

    if (exitCode !== 0) {
      return {
        status: 'error',
        error: stripAnsi(stderr).slice(0, 500) || `Exit code ${exitCode}`,
        exitCode,
      };
    }

    try {
      const result = JSON.parse(stripAnsi(stdout));
      return {
        status: 'pinned',
        id: result.id || result.fact_id || 'unknown',
      };
    } catch {
      // Parse ID from text output
      const match = stripAnsi(stdout).match(/(?:id|ID):\s*(\S+)/);
      return {
        status: 'pinned',
        id: match?.[1] || 'unknown',
      };
    }
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

    const args = ['context', 'unpin', input.id, '--json'];

    const { stdout, stderr, exitCode } = await execDecibel(args, projectRoot);

    if (exitCode !== 0) {
      return {
        status: 'error',
        error: stripAnsi(stderr).slice(0, 500) || `Exit code ${exitCode}`,
        exitCode,
      };
    }

    return { status: 'unpinned' };
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

    const args = ['context', 'list', '--json'];

    const { stdout, stderr, exitCode } = await execDecibel(args, projectRoot);

    if (exitCode !== 0) {
      return {
        status: 'error',
        error: stripAnsi(stderr).slice(0, 500) || `Exit code ${exitCode}`,
        exitCode,
      };
    }

    try {
      const result = JSON.parse(stripAnsi(stdout));
      return {
        status: 'executed',
        facts: result.facts || result || [],
      };
    } catch {
      return {
        status: 'executed',
        facts: [],
      };
    }
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

    const args = ['event', 'append', '--title', input.title];

    if (input.body) {
      args.push('--body', input.body);
    }

    if (input.tags && input.tags.length > 0) {
      args.push('--tags', input.tags.join(','));
    }

    args.push('--json');

    const { stdout, stderr, exitCode } = await execDecibel(args, projectRoot);

    if (exitCode !== 0) {
      return {
        status: 'error',
        error: stripAnsi(stderr).slice(0, 500) || `Exit code ${exitCode}`,
        exitCode,
      };
    }

    try {
      const result = JSON.parse(stripAnsi(stdout));
      return {
        status: 'appended',
        event_id: result.id || result.event_id || 'unknown',
      };
    } catch {
      const match = stripAnsi(stdout).match(/(?:id|ID):\s*(\S+)/);
      return {
        status: 'appended',
        event_id: match?.[1] || 'unknown',
      };
    }
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

    const args = ['event', 'search', input.query];

    if (input.limit) {
      args.push('--limit', input.limit.toString());
    }

    args.push('--json');

    const { stdout, stderr, exitCode } = await execDecibel(args, projectRoot);

    if (exitCode !== 0) {
      return {
        status: 'error',
        error: stripAnsi(stderr).slice(0, 500) || `Exit code ${exitCode}`,
        exitCode,
      };
    }

    try {
      const result = JSON.parse(stripAnsi(stdout));
      return {
        status: 'executed',
        results: result.results || result || [],
      };
    } catch {
      return {
        status: 'executed',
        results: [],
      };
    }
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

    const args = ['artifact', 'list', input.run_id, '--json'];

    const { stdout, stderr, exitCode } = await execDecibel(args, projectRoot);

    if (exitCode !== 0) {
      return {
        status: 'error',
        error: stripAnsi(stderr).slice(0, 500) || `Exit code ${exitCode}`,
        exitCode,
      };
    }

    try {
      const result = JSON.parse(stripAnsi(stdout));
      return {
        status: 'executed',
        run_id: input.run_id,
        artifacts: result.artifacts || result || [],
      };
    } catch {
      return {
        status: 'executed',
        run_id: input.run_id,
        artifacts: [],
      };
    }
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

    const args = ['artifact', 'read', input.run_id, input.name, '--json'];

    const { stdout, stderr, exitCode } = await execDecibel(args, projectRoot);

    if (exitCode !== 0) {
      return {
        status: 'error',
        error: stripAnsi(stderr).slice(0, 500) || `Exit code ${exitCode}`,
        exitCode,
      };
    }

    try {
      const result = JSON.parse(stripAnsi(stdout));
      return {
        status: 'executed',
        run_id: result.run_id || input.run_id,
        name: result.name || input.name,
        content: result.content || '',
        mime_type: result.mime_type || 'text/plain',
      };
    } catch {
      return {
        status: 'executed',
        run_id: input.run_id,
        name: input.name,
        content: stripAnsi(stdout),
        mime_type: 'text/plain',
      };
    }
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
