// ============================================================================
// Vector Domain Tools
// ============================================================================
// MCP tools for Vector - AI session tracking and analysis.
// Enables agents to log events, track runs, and calculate inference load.
// ============================================================================

import { ToolSpec } from '../types.js';
import { toolSuccess, toolError, requireFields } from '../shared/index.js';
import {
  createRun,
  CreateRunInput,
  logEvent,
  LogEventInput,
  completeRun,
  CompleteRunInput,
  listRuns,
  ListRunsInput,
  getRun,
  GetRunInput,
  scorePrompt,
  ScorePromptInput,
  AgentType,
  EventType,
} from '../vector.js';
import {
  buildContextPack,
  checkpoint,
  aggregateAssumptions,
  type ContextPackRequest,
  type CheckpointRequest,
} from '../../lib/agent-services/index.js';

// ============================================================================
// Constants
// ============================================================================

const VALID_AGENT_TYPES: AgentType[] = ['claude-code', 'cursor', 'replit', 'chatgpt', 'custom'];
const VALID_EVENT_TYPES: EventType[] = [
  'prompt_received', 'plan_proposed', 'assumption_made', 'clarifying_question',
  'command_ran', 'file_touched', 'test_result', 'backtrack', 'error',
  'user_correction', 'run_completed'
];

// ============================================================================
// Create Run Tool
// ============================================================================

export const vectorCreateRunTool: ToolSpec = {
  definition: {
    name: 'vector_create_run',
    description: 'Start a new agent run for Vector tracking. Creates a run folder in .decibel/runs/ with prompt.json and events.jsonl. Use this at the start of any significant agent session to enable drift analysis.',
    annotations: {
      title: 'Create Run',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Optional project identifier. Uses default project if not specified.',
        },
        agent: {
          type: 'object',
          description: 'Information about the AI agent',
          properties: {
            type: {
              type: 'string',
              enum: ['claude-code', 'cursor', 'replit', 'chatgpt', 'custom'],
              description: 'The type of AI agent',
            },
            version: {
              type: 'string',
              description: 'Optional version string of the agent',
            },
          },
          required: ['type'],
        },
        raw_prompt: {
          type: 'string',
          description: 'The original prompt from the user',
        },
        intent: {
          type: 'object',
          description: 'Optional parsed intent from the prompt',
          properties: {
            goal: { type: 'string', description: 'What the prompt is trying to achieve' },
            scope: { type: 'array', items: { type: 'string' }, description: 'Files/modules in scope' },
            non_goals: { type: 'array', items: { type: 'string' }, description: 'Explicit exclusions' },
            constraints: { type: 'array', items: { type: 'string' }, description: 'Rules to follow' },
            acceptance: { type: 'array', items: { type: 'string' }, description: 'Success criteria' },
            risk_posture: { type: 'string', enum: ['safe', 'moderate', 'aggressive'] },
          },
        },
      },
      required: ['agent', 'raw_prompt'],
    },
  },
  handler: async (args) => {
    try {
      const input = args as CreateRunInput;
      requireFields(input, 'agent', 'raw_prompt');
      requireFields(input.agent, 'type');

      if (!VALID_AGENT_TYPES.includes(input.agent.type)) {
        throw new Error(`Invalid agent type: ${input.agent.type}. Must be one of: ${VALID_AGENT_TYPES.join(', ')}`);
      }

      const result = await createRun(input);
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// Log Event Tool
// ============================================================================

export const vectorLogEventTool: ToolSpec = {
  definition: {
    name: 'vector_log_event',
    description: 'Log an event to an existing run. Events are appended to events.jsonl and used by Vector to analyze drift, assumptions, and session flow.',
    annotations: {
      title: 'Log Event',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Optional project identifier. Uses default project if not specified.',
        },
        run_id: {
          type: 'string',
          description: 'The run ID to log the event to (e.g., "RUN-2026-01-10T...")',
        },
        type: {
          type: 'string',
          enum: [
            'plan_proposed', 'assumption_made', 'clarifying_question',
            'command_ran', 'file_touched', 'test_result', 'backtrack',
            'error', 'user_correction'
          ],
          description: 'The type of event. Use prompt_received and run_completed via create/complete tools.',
        },
        payload: {
          type: 'object',
          description: 'Event-specific payload data. Structure depends on event type.',
        },
      },
      required: ['run_id', 'type'],
    },
  },
  handler: async (args) => {
    try {
      const input = args as LogEventInput;
      requireFields(input, 'run_id', 'type');

      if (!VALID_EVENT_TYPES.includes(input.type)) {
        throw new Error(`Invalid event type: ${input.type}. Must be one of: ${VALID_EVENT_TYPES.join(', ')}`);
      }

      const result = await logEvent(input);
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// Complete Run Tool
// ============================================================================

export const vectorCompleteRunTool: ToolSpec = {
  definition: {
    name: 'vector_complete_run',
    description: 'Mark a run as complete with a summary. Creates summary.md and logs the run_completed event. Call this when an agent session ends.',
    annotations: {
      title: 'Complete Run',
      readOnlyHint: false,
      destructiveHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Optional project identifier. Uses default project if not specified.',
        },
        run_id: {
          type: 'string',
          description: 'The run ID to complete',
        },
        success: {
          type: 'boolean',
          description: 'Whether the run completed successfully',
        },
        summary: {
          type: 'string',
          description: 'Optional summary of what was accomplished or why it failed',
        },
      },
      required: ['run_id', 'success'],
    },
  },
  handler: async (args) => {
    try {
      const input = args as CompleteRunInput;
      requireFields(input, 'run_id', 'success');

      const result = await completeRun(input);
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// List Runs Tool
// ============================================================================

export const vectorListRunsTool: ToolSpec = {
  definition: {
    name: 'vector_list_runs',
    description: 'List recent runs for a project. Returns run metadata including agent, timestamps, event count, and completion status.',
    annotations: {
      title: 'List Runs',
      readOnlyHint: true,
      destructiveHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Optional project identifier. Uses default project if not specified.',
        },
        limit: {
          type: 'integer',
          description: 'Maximum number of runs to return (default: 20)',
        },
        agent_type: {
          type: 'string',
          enum: ['claude-code', 'cursor', 'replit', 'chatgpt', 'custom'],
          description: 'Filter runs by agent type',
        },
      },
    },
  },
  handler: async (args) => {
    try {
      const input = args as ListRunsInput;

      if (input.agent_type && !VALID_AGENT_TYPES.includes(input.agent_type)) {
        throw new Error(`Invalid agent type: ${input.agent_type}. Must be one of: ${VALID_AGENT_TYPES.join(', ')}`);
      }

      const result = await listRuns(input);
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// Get Run Tool
// ============================================================================

export const vectorGetRunTool: ToolSpec = {
  definition: {
    name: 'vector_get_run',
    description: 'Get details of a specific run including prompt and optionally all events. Use this to analyze a session for drift and assumptions.',
    annotations: {
      title: 'Get Run',
      readOnlyHint: true,
      destructiveHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Optional project identifier. Uses default project if not specified.',
        },
        run_id: {
          type: 'string',
          description: 'The run ID to retrieve',
        },
        include_events: {
          type: 'boolean',
          description: 'Include the full event stream (default: false)',
        },
      },
      required: ['run_id'],
    },
  },
  handler: async (args) => {
    try {
      const input = args as GetRunInput;
      requireFields(input, 'run_id');

      const result = await getRun(input);
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// Score Prompt Tool
// ============================================================================

export const vectorScorePromptTool: ToolSpec = {
  definition: {
    name: 'vector_score_prompt',
    description: 'Calculate the inference load score for a prompt. Returns a 0-100 score indicating how much the agent will have to guess, with breakdown and suggestions for improvement. Higher score = more risk of drift.',
    annotations: {
      title: 'Score Prompt',
      readOnlyHint: true,
      destructiveHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'The prompt text to analyze',
        },
        projectId: {
          type: 'string',
          description: 'Optional project identifier for context-aware scoring (future enhancement)',
        },
      },
      required: ['prompt'],
    },
  },
  handler: async (args) => {
    try {
      const input = args as ScorePromptInput;
      requireFields(input, 'prompt');

      const result = scorePrompt(input);
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// Agent Context Pack Tool
// ============================================================================

export const vectorAgentContextPackTool: ToolSpec = {
  definition: {
    name: 'vector_agent_context_pack',
    description: 'Build a memory brief from past runs before starting a task. Returns relevant past runs, churn hotspots, failure patterns, and suggested questions. Use this at the start of complex tasks to learn from history.',
    annotations: {
      title: 'Agent Context Pack',
      readOnlyHint: true,
      destructiveHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Optional project identifier. Uses default project if not specified.',
        },
        task: {
          type: 'string',
          description: 'The task description or goal you are about to work on',
        },
        files_hint: {
          type: 'array',
          items: { type: 'string' },
          description: 'Hint about which files/modules might be involved (e.g., ["src/auth/*", "api/users"])',
        },
        lookback_days: {
          type: 'integer',
          description: 'How far back to look for relevant runs (default: 30)',
        },
        max_runs: {
          type: 'integer',
          description: 'Maximum number of runs to analyze (default: 50)',
        },
      },
      required: ['task'],
    },
  },
  handler: async (args) => {
    try {
      const input = args as ContextPackRequest & { projectId?: string };
      requireFields(input, 'task');

      const result = await buildContextPack(
        {
          task: input.task,
          files_hint: input.files_hint,
          lookback_days: input.lookback_days,
          max_runs: input.max_runs,
        },
        input.projectId
      );
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// Agent Checkpoint Tool
// ============================================================================

export const vectorAgentCheckpointTool: ToolSpec = {
  definition: {
    name: 'vector_agent_checkpoint',
    description: 'Mid-run checkpoint to detect drift and gate actions. Returns drift analysis, action gate result (if action provided), and overall status (green/yellow/red). Use this periodically during complex tasks.',
    annotations: {
      title: 'Agent Checkpoint',
      readOnlyHint: true,
      destructiveHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Optional project identifier. Uses default project if not specified.',
        },
        run_id: {
          type: 'string',
          description: 'The run ID for this session',
        },
        original_intent: {
          type: 'string',
          description: 'The original task/goal you started with',
        },
        current_plan: {
          type: 'string',
          description: 'What you are currently doing or planning to do',
        },
        files_touched: {
          type: 'array',
          items: { type: 'string' },
          description: 'Files you have modified so far',
        },
        pending_action: {
          type: 'object',
          description: 'Optional action you want to gate before executing',
          properties: {
            action: {
              type: 'string',
              description: 'Description of the action',
            },
            action_type: {
              type: 'string',
              enum: ['file_edit', 'command', 'api_call', 'refactor', 'delete'],
              description: 'Type of action',
            },
            confidence: {
              type: 'number',
              description: 'Your confidence in this action (0-1)',
            },
            affected_files: {
              type: 'array',
              items: { type: 'string' },
              description: 'Files that would be affected',
            },
            reversible: {
              type: 'boolean',
              description: 'Whether this action is easily reversible',
            },
            risk_areas: {
              type: 'array',
              items: { type: 'string' },
              description: 'Risk areas involved (e.g., "auth", "database")',
            },
          },
          required: ['action', 'action_type', 'confidence', 'reversible'],
        },
      },
      required: ['run_id', 'original_intent', 'current_plan', 'files_touched'],
    },
  },
  handler: async (args) => {
    try {
      const input = args as CheckpointRequest & { projectId?: string };
      requireFields(input, 'run_id', 'original_intent', 'current_plan', 'files_touched');

      const result = checkpoint({
        run_id: input.run_id,
        original_intent: input.original_intent,
        current_plan: input.current_plan,
        files_touched: input.files_touched,
        pending_action: input.pending_action,
      });
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// Agent Assumptions Tool
// ============================================================================

export const vectorAgentAssumptionsTool: ToolSpec = {
  definition: {
    name: 'vector_agent_assumptions',
    description: 'Aggregate assumption data across past runs. Returns high-risk categories, specific assumptions to always ask about, and validation rates. Use this to understand what the agent should verify before assuming.',
    annotations: {
      title: 'Agent Assumptions',
      readOnlyHint: true,
      destructiveHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Optional project identifier. Uses default project if not specified.',
        },
        lookback_days: {
          type: 'integer',
          description: 'How far back to look (default: 30)',
        },
        max_runs: {
          type: 'integer',
          description: 'Maximum runs to analyze (default: 100)',
        },
        include_details: {
          type: 'boolean',
          description: 'Include full assumption list (default: false, returns only stats)',
        },
      },
    },
  },
  handler: async (args) => {
    try {
      const input = args as {
        projectId?: string;
        lookback_days?: number;
        max_runs?: number;
        include_details?: boolean;
      };

      const fullResult = await aggregateAssumptions(input.projectId, {
        lookback_days: input.lookback_days,
        max_runs: input.max_runs,
      });

      // Return stats only unless details requested
      if (input.include_details) {
        return toolSuccess(fullResult);
      }

      // Return just the stats
      const { assumptions: _omit, ...stats } = fullResult;
      return toolSuccess(stats);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// Export All Tools
// ============================================================================

export const vectorTools: ToolSpec[] = [
  vectorCreateRunTool,
  vectorLogEventTool,
  vectorCompleteRunTool,
  vectorListRunsTool,
  vectorGetRunTool,
  vectorScorePromptTool,
  vectorAgentContextPackTool,
  vectorAgentCheckpointTool,
  vectorAgentAssumptionsTool,
];
