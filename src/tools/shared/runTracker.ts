// ============================================================================
// Run Tracker
// ============================================================================
// Automatic Vector run tracking for significant tool calls.
// Tracks tool invocations as events within agent sessions.
// ============================================================================

import { log } from '../../config.js';
import { createRun, logEvent, AgentInfo } from '../vector.js';

// ============================================================================
// Constants
// ============================================================================

/** Active run timeout in milliseconds (30 minutes) */
const ACTIVE_RUN_TIMEOUT_MS = 30 * 60 * 1000;

/** Default agent info for auto-tracked runs */
const DEFAULT_AGENT: AgentInfo = {
  type: 'claude-code',
  version: 'auto-tracked',
};

// ============================================================================
// In-Memory State
// ============================================================================

interface ActiveRunState {
  runId: string;
  timestamp: number;
}

/** Map of projectId -> active run state */
const activeRuns = new Map<string, ActiveRunState>();

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Get or create an active run for a project.
 * Returns the run ID for use in event logging.
 *
 * @param projectId - The project identifier
 * @returns The active run ID, or null if creation failed
 */
export async function getOrCreateActiveRun(projectId: string): Promise<string | null> {
  const now = Date.now();
  const existing = activeRuns.get(projectId);

  // Check if we have an active run within timeout
  if (existing && (now - existing.timestamp) < ACTIVE_RUN_TIMEOUT_MS) {
    // Update timestamp to extend the session
    existing.timestamp = now;
    return existing.runId;
  }

  // Create a new run
  try {
    const result = await createRun({
      projectId,
      agent: DEFAULT_AGENT,
      raw_prompt: '[Auto-tracked session via MCP tool calls]',
      intent: {
        goal: 'Tool usage session tracked automatically',
      },
    });

    activeRuns.set(projectId, {
      runId: result.run_id,
      timestamp: now,
    });

    log(`RunTracker: Created new run ${result.run_id} for project ${projectId}`);
    return result.run_id;
  } catch (err) {
    log(`RunTracker: Failed to create run for project ${projectId}: ${err}`);
    return null;
  }
}

/**
 * Log a tool event to the active run for a project.
 * Fails silently if no active run or if logging fails.
 *
 * @param projectId - The project identifier
 * @param toolName - Name of the tool that was called
 * @param result - 'success' or 'error'
 * @param summary - Brief summary of what happened
 */
export async function logToolEvent(
  projectId: string,
  toolName: string,
  result: 'success' | 'error',
  summary: string
): Promise<void> {
  try {
    const runId = await getOrCreateActiveRun(projectId);
    if (!runId) {
      log(`RunTracker: No active run for project ${projectId}, skipping event`);
      return;
    }

    await logEvent({
      projectId,
      run_id: runId,
      type: 'command_ran',
      payload: {
        tool: toolName,
        result,
        summary,
      },
    });

    log(`RunTracker: Logged ${toolName} event (${result}) to run ${runId}`);
  } catch (err) {
    // Fail silently - don't block tool execution
    log(`RunTracker: Failed to log event for ${toolName}: ${err}`);
  }
}

// ============================================================================
// Handler Wrapper
// ============================================================================

/** Configuration for a tracked tool */
export interface TrackedToolConfig {
  /** Tool name for logging */
  toolName: string;
  /** Function to extract projectId from args (default: args.projectId || args.project_id) */
  getProjectId?: (args: Record<string, unknown>) => string | undefined;
  /** Function to generate summary from result (default: JSON.stringify) */
  getSummary?: (args: Record<string, unknown>, result: unknown) => string;
}

/**
 * Wrap a tool handler to automatically log successful calls.
 * Tracking failures are silently ignored to avoid blocking tool execution.
 *
 * @param handler - The original tool handler
 * @param config - Configuration for tracking
 * @returns Wrapped handler that logs events after successful execution
 */
export function withRunTracking<T extends Record<string, unknown>>(
  handler: (args: T) => Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }>,
  config: TrackedToolConfig
): (args: T) => Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  return async (args: T) => {
    const result = await handler(args);

    // Only track successful calls
    if (!result.isError) {
      const projectId = config.getProjectId
        ? config.getProjectId(args as Record<string, unknown>)
        : (args.projectId as string) || (args.project_id as string);

      if (projectId) {
        // Parse the result to generate summary
        let summary: string;
        try {
          if (config.getSummary) {
            const parsedResult = JSON.parse(result.content[0]?.text || '{}');
            summary = config.getSummary(args as Record<string, unknown>, parsedResult);
          } else {
            summary = `${config.toolName} completed`;
          }
        } catch {
          summary = `${config.toolName} completed`;
        }

        // Fire and forget - don't await to avoid blocking
        logToolEvent(projectId, config.toolName, 'success', summary).catch(() => {
          // Silently ignore tracking errors
        });
      }
    }

    return result;
  };
}

// ============================================================================
// Summary Generators
// ============================================================================

/** Common summary generators for different tool types */
export const summaryGenerators = {
  /** Summary for issue creation */
  issue: (args: Record<string, unknown>, result: unknown): string => {
    const r = result as { id?: string };
    return `Created issue ${r.id || ''}: ${args.title || 'untitled'}`;
  },

  /** Summary for epic creation */
  epic: (args: Record<string, unknown>, result: unknown): string => {
    const r = result as { epic_id?: string };
    return `Created epic ${r.epic_id || ''}: ${args.title || 'untitled'}`;
  },

  /** Summary for issue closure */
  closeIssue: (args: Record<string, unknown>, result: unknown): string => {
    const r = result as { id?: string; status?: string };
    return `Closed issue ${r.id || args.issue_id}: ${r.status || 'closed'}`;
  },

  /** Summary for proposal creation */
  proposal: (args: Record<string, unknown>, result: unknown): string => {
    const r = result as { proposal_id?: string };
    return `Created proposal ${r.proposal_id || ''}: ${args.title || 'untitled'}`;
  },

  /** Summary for wish creation */
  wish: (args: Record<string, unknown>, result: unknown): string => {
    const r = result as { wish_id?: string };
    return `Added wish ${r.wish_id || ''}: ${args.capability || 'unnamed'}`;
  },

  /** Summary for experiment scaffold */
  scaffold: (args: Record<string, unknown>, result: unknown): string => {
    const r = result as { experiment_id?: string };
    return `Scaffolded experiment ${r.experiment_id || ''} from ${args.proposal_id || 'unknown'}`;
  },

  /** Summary for learning append */
  learning: (args: Record<string, unknown>): string => {
    return `Appended learning: ${args.title || 'untitled'}`;
  },

  /** Summary for friction log */
  friction: (args: Record<string, unknown>, result: unknown): string => {
    const r = result as { id?: string };
    return `Logged friction ${r.id || ''}: ${args.context || 'unknown context'}`;
  },

  /** Summary for ADR creation */
  adr: (args: Record<string, unknown>, result: unknown): string => {
    const r = result as { adr_id?: string };
    return `Created ADR ${r.adr_id || ''}: ${args.title || args.change || 'untitled'}`;
  },

  /** Summary for design decision */
  designDecision: (args: Record<string, unknown>): string => {
    return `Recorded design decision (${args.area || 'general'}): ${args.summary || 'untitled'}`;
  },
};

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get the current active run for a project (if any).
 * Useful for debugging or external inspection.
 */
export function getActiveRunId(projectId: string): string | null {
  const state = activeRuns.get(projectId);
  if (!state) return null;

  const now = Date.now();
  if ((now - state.timestamp) >= ACTIVE_RUN_TIMEOUT_MS) {
    // Run has expired
    activeRuns.delete(projectId);
    return null;
  }

  return state.runId;
}

/**
 * Clear all active runs (useful for testing).
 */
export function clearActiveRuns(): void {
  activeRuns.clear();
}

/**
 * Get count of active runs (useful for debugging).
 */
export function getActiveRunCount(): number {
  return activeRuns.size;
}
