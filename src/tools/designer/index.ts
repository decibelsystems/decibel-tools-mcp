// ============================================================================
// Designer Domain Tools
// ============================================================================
// Tools for design decisions and creative feedback (crits).
// ============================================================================

import { ToolSpec } from '../types.js';
import { toolSuccess, toolError, requireFields } from '../shared/index.js';
import { recordDesignDecision, RecordDesignDecisionInput } from '../designer.js';
import {
  logCrit,
  LogCritInput,
  CritSentiment,
  listCrits,
  ListCritsInput,
} from '../crit.js';

// ============================================================================
// Types
// ============================================================================

const VALID_SENTIMENTS: CritSentiment[] = ['positive', 'negative', 'neutral', 'question'];

// ============================================================================
// Helper: Normalize project_id → projectId
// ============================================================================

function normalizeProjectId(args: Record<string, unknown>): void {
  if (!args.projectId && args.project_id) {
    args.projectId = args.project_id;
  }
}

// ============================================================================
// Record Design Decision Tool
// ============================================================================

export const designerRecordDecisionTool: ToolSpec = {
  definition: {
    name: 'designer_record_design_decision',
    description: 'Record a design decision for a project. Automatically saves a markdown file to .decibel/designer/decisions/ with frontmatter. No separate file writing needed.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Optional project identifier. Uses default project if not specified.',
        },
        area: {
          type: 'string',
          description: 'The area or domain of the design decision (e.g., "UI", "API", "Database")',
        },
        summary: {
          type: 'string',
          description: 'A brief summary of the design decision',
        },
        details: {
          type: 'string',
          description: 'Optional detailed explanation of the design decision',
        },
      },
      required: ['area', 'summary'],
    },
  },
  handler: async (args) => {
    try {
      const rawInput = args as Record<string, unknown>;
      normalizeProjectId(rawInput);
      const input = rawInput as unknown as RecordDesignDecisionInput;

      requireFields(input, 'area', 'summary');

      const result = await recordDesignDecision(input);
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// Crit Tool (Log Creative Feedback)
// ============================================================================

export const designerCritTool: ToolSpec = {
  definition: {
    name: 'designer_crit',
    description: 'Log early creative feedback before decisions crystallize. Use for gut reactions, observations, questions, and hunches during exploration phases.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'The project identifier',
        },
        area: {
          type: 'string',
          description: 'Area being critiqued (e.g., "3D", "motion", "layout", "ux")',
        },
        observation: {
          type: 'string',
          description: 'The crit itself - what you noticed, felt, or wondered',
        },
        sentiment: {
          type: 'string',
          enum: ['positive', 'negative', 'neutral', 'question'],
          description: 'The tone of the observation (default: neutral)',
        },
        context: {
          type: 'string',
          description: 'Optional context - what were you testing/looking at?',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional tags for filtering',
        },
      },
      required: ['project_id', 'area', 'observation'],
    },
  },
  handler: async (args) => {
    try {
      const rawInput = args as Record<string, unknown>;
      normalizeProjectId(rawInput);
      const input = rawInput as unknown as LogCritInput;

      requireFields(input, 'area', 'observation');

      if (input.sentiment && !VALID_SENTIMENTS.includes(input.sentiment)) {
        throw new Error(`Invalid sentiment. Must be one of: ${VALID_SENTIMENTS.join(', ')}`);
      }

      const result = await logCrit(input);
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// List Crits Tool
// ============================================================================

export const designerListCritsTool: ToolSpec = {
  definition: {
    name: 'designer_list_crits',
    description: 'List crit observations for a project, optionally filtered by area or sentiment.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'The project identifier',
        },
        area: {
          type: 'string',
          description: 'Filter by area (e.g., "3D", "motion")',
        },
        sentiment: {
          type: 'string',
          enum: ['positive', 'negative', 'neutral', 'question'],
          description: 'Filter by sentiment',
        },
        limit: {
          type: 'integer',
          description: 'Maximum number of entries to return (most recent first)',
        },
      },
      required: ['project_id'],
    },
  },
  handler: async (args) => {
    try {
      const rawInput = args as Record<string, unknown>;
      normalizeProjectId(rawInput);
      const input = rawInput as unknown as ListCritsInput;

      if (input.sentiment && !VALID_SENTIMENTS.includes(input.sentiment)) {
        throw new Error(`Invalid sentiment. Must be one of: ${VALID_SENTIMENTS.join(', ')}`);
      }

      const result = await listCrits(input);
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// Export All Tools
// ============================================================================

export const designerTools: ToolSpec[] = [
  designerRecordDecisionTool,
  designerCritTool,
  designerListCritsTool,
];
