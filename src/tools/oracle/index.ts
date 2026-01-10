// ============================================================================
// Oracle Domain Tools
// ============================================================================
// Tools for getting insights, recommendations, and roadmap progress.
// ============================================================================

import { ToolSpec } from '../types.js';
import { toolSuccess, toolError } from '../shared/index.js';
import {
  nextActions,
  NextActionsInput,
  roadmapProgress,
  RoadmapInput,
  isOracleError,
} from '../oracle.js';

// ============================================================================
// Helper: Normalize project_id → projectId
// ============================================================================

function normalizeProjectId(args: Record<string, unknown>): void {
  if (!args.projectId && args.project_id) {
    args.projectId = args.project_id;
  }
}

// ============================================================================
// Next Actions Tool
// ============================================================================

export const oracleNextActionsTool: ToolSpec = {
  definition: {
    name: 'oracle_next_actions',
    description: 'Get recommended next actions for a project based on recent design decisions, architecture changes, and issues.',
    annotations: {
      title: 'Next Actions',
      readOnlyHint: true,
      destructiveHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'The project identifier to analyze',
        },
        focus: {
          type: 'string',
          description: 'Optional focus area to filter actions (e.g., "architect", "sentinel", or a keyword)',
        },
      },
      required: ['project_id'],
    },
  },
  handler: async (args) => {
    try {
      const rawInput = args as Record<string, unknown>;
      normalizeProjectId(rawInput);
      const input = rawInput as unknown as NextActionsInput;
      const result = await nextActions(input);
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// Roadmap Progress Tool
// ============================================================================

export const oracleRoadmapTool: ToolSpec = {
  definition: {
    name: 'oracle_roadmap',
    description: 'Evaluate roadmap progress against milestones and objectives. Reads roadmap from .decibel/architect/roadmap/roadmap.yaml, cross-references epic statuses from Sentinel, and optionally saves progress to .decibel/oracle/progress.yaml.',
    annotations: {
      title: 'Roadmap Progress',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project identifier (optional, auto-detects from cwd)',
        },
        dryRun: {
          type: 'boolean',
          description: 'If true, evaluate without saving progress.yaml',
        },
        noSignals: {
          type: 'boolean',
          description: 'Skip Sentinel signals integration',
        },
      },
    },
  },
  handler: async (args) => {
    try {
      const input = args as RoadmapInput;
      const result = await roadmapProgress(input);
      if (isOracleError(result)) {
        return toolError(JSON.stringify(result, null, 2));
      }
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// Export All Tools
// ============================================================================

export const oracleTools: ToolSpec[] = [
  oracleNextActionsTool,
  oracleRoadmapTool,
];
