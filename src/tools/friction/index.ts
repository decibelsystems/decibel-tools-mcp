// ============================================================================
// Friction Domain Tools
// ============================================================================
// Tools for tracking persistent pain points and friction in workflows.
// ============================================================================

import { ToolSpec } from '../types.js';
import { toolSuccess, toolError, requireFields, withRunTracking, summaryGenerators } from '../shared/index.js';
import {
  logFriction,
  LogFrictionInput,
  FrictionFrequency,
  FrictionImpact,
  FrictionStatus,
  listFriction,
  ListFrictionInput,
  resolveFriction,
  ResolveFrictionInput,
  bumpFriction,
  BumpFrictionInput,
} from '../friction.js';

// ============================================================================
// Types
// ============================================================================

const VALID_FREQUENCIES: FrictionFrequency[] = ['once', 'occasional', 'frequent', 'constant'];
const VALID_IMPACTS: FrictionImpact[] = ['low', 'medium', 'high', 'blocking'];
const VALID_STATUSES: FrictionStatus[] = ['open', 'acknowledged', 'solving', 'resolved', 'wontfix'];

// ============================================================================
// Log Friction Tool
// ============================================================================

export const frictionLogTool: ToolSpec = {
  definition: {
    name: 'friction_log',
    description: 'Log a persistent friction point or pain point. Both humans and agents can call this to track recurring issues that erode productivity. Signal strength increases when similar friction is logged multiple times.',
    annotations: {
      title: 'Log Friction',
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
        context: {
          type: 'string',
          description: 'Where the friction occurs (project name, repo, system, or workflow)',
        },
        description: {
          type: 'string',
          description: 'What the friction is - the pain point or recurring issue',
        },
        frequency: {
          type: 'string',
          enum: ['once', 'occasional', 'frequent', 'constant'],
          description: 'How often this friction is encountered (default: occasional)',
        },
        impact: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'blocking'],
          description: 'How much this friction affects productivity (default: medium)',
        },
        source: {
          type: 'string',
          enum: ['human', 'agent'],
          description: 'Who is logging this friction (default: human)',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags for categorization and searchability',
        },
        workaround: {
          type: 'string',
          description: 'Any current workaround being used',
        },
      },
      required: ['context', 'description'],
    },
  },
  handler: withRunTracking(
    async (args) => {
      try {
        const input = args as LogFrictionInput;
        requireFields(input, 'context', 'description');

        if (input.frequency && !VALID_FREQUENCIES.includes(input.frequency)) {
          throw new Error(`Invalid frequency. Must be one of: ${VALID_FREQUENCIES.join(', ')}`);
        }
        if (input.impact && !VALID_IMPACTS.includes(input.impact)) {
          throw new Error(`Invalid impact. Must be one of: ${VALID_IMPACTS.join(', ')}`);
        }

        const result = await logFriction(input);
        return toolSuccess(result);
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    },
    {
      toolName: 'friction_log',
      getSummary: summaryGenerators.friction,
    }
  ),
};

// ============================================================================
// List Friction Tool
// ============================================================================

export const frictionListTool: ToolSpec = {
  definition: {
    name: 'friction_list',
    description: 'List friction points, sorted by impact and signal count. High-signal friction should be prioritized for resolution.',
    annotations: {
      title: 'List Friction',
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
        context: {
          type: 'string',
          description: 'Filter by context (project, repo, system)',
        },
        status: {
          type: 'string',
          enum: ['open', 'acknowledged', 'solving', 'resolved', 'wontfix'],
          description: 'Filter by status',
        },
        min_impact: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'blocking'],
          description: 'Minimum impact level to include',
        },
        limit: {
          type: 'integer',
          description: 'Maximum number of results (default: 20)',
        },
      },
    },
  },
  handler: async (args) => {
    try {
      const input = args as ListFrictionInput;

      if (input.status && !VALID_STATUSES.includes(input.status)) {
        throw new Error(`Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`);
      }
      if (input.min_impact && !VALID_IMPACTS.includes(input.min_impact)) {
        throw new Error(`Invalid min_impact. Must be one of: ${VALID_IMPACTS.join(', ')}`);
      }

      const result = await listFriction(input);
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// Resolve Friction Tool
// ============================================================================

export const frictionResolveTool: ToolSpec = {
  definition: {
    name: 'friction_resolve',
    description: 'Mark a friction point as resolved. Can include a resolution note and reference to the solution (issue, ADR, commit).',
    annotations: {
      title: 'Resolve Friction',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Optional project identifier. Uses default project if not specified.',
        },
        friction_id: {
          type: 'string',
          description: 'The friction ID (filename or partial match)',
        },
        resolution: {
          type: 'string',
          description: 'How the friction was resolved',
        },
        solution_ref: {
          type: 'string',
          description: 'Optional reference to the solution (issue ID, ADR, commit SHA, PR)',
        },
        status: {
          type: 'string',
          enum: ['resolved', 'wontfix'],
          description: 'Resolution status (default: resolved)',
        },
      },
      required: ['friction_id', 'resolution'],
    },
  },
  handler: async (args) => {
    try {
      const input = args as ResolveFrictionInput;
      requireFields(input, 'friction_id', 'resolution');

      const result = await resolveFriction(input);
      if ('error' in result) {
        return toolError(JSON.stringify(result, null, 2));
      }
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// Bump Friction Tool
// ============================================================================

export const frictionBumpTool: ToolSpec = {
  definition: {
    name: 'friction_bump',
    description: 'Bump the signal count on an existing friction point. Use when encountering the same friction again. Higher signal = higher priority.',
    annotations: {
      title: 'Bump Friction',
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
        friction_id: {
          type: 'string',
          description: 'The friction ID (filename or partial match)',
        },
        source: {
          type: 'string',
          enum: ['human', 'agent'],
          description: 'Who is bumping this friction (default: human)',
        },
        note: {
          type: 'string',
          description: 'Optional note about this occurrence',
        },
      },
      required: ['friction_id'],
    },
  },
  handler: async (args) => {
    try {
      const input = args as BumpFrictionInput;
      requireFields(input, 'friction_id');

      const result = await bumpFriction(input);
      if ('error' in result) {
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

export const frictionTools: ToolSpec[] = [
  frictionLogTool,
  frictionListTool,
  frictionResolveTool,
  frictionBumpTool,
];
