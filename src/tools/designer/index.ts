// ============================================================================
// Designer Domain Tools
// ============================================================================
// Tools for design decisions and creative feedback (crits).
// ============================================================================

import { ToolSpec } from '../types.js';
import { toolSuccess, toolError, requireFields, withRunTracking, summaryGenerators } from '../shared/index.js';
import {
  recordDesignDecision,
  RecordDesignDecisionInput,
  syncTokens,
  SyncTokensInput,
  reviewFigma,
  ReviewFigmaInput,
  upsertPrinciple,
  UpsertPrincipleInput,
  listPrinciples,
  ListPrinciplesInput,
  checkParity,
  CheckParityInput,
} from '../designer.js';
import {
  logCrit,
  LogCritInput,
  CritSentiment,
  listCrits,
  ListCritsInput,
} from '../crit.js';
import { lateralTools } from './lateral-tools.js';

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
    annotations: {
      title: 'Record Design Decision',
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
  handler: withRunTracking(
    async (args) => {
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
    {
      toolName: 'designer_record_design_decision',
      getProjectId: (args) => (args.projectId as string | undefined) || (args.project_id as string | undefined),
      getSummary: summaryGenerators.designDecision,
    }
  ),
};

// ============================================================================
// Crit Tool (Log Creative Feedback)
// ============================================================================

export const designerCritTool: ToolSpec = {
  definition: {
    name: 'designer_crit',
    description: 'Log early creative feedback before decisions crystallize. Use for gut reactions, observations, questions, and hunches during exploration phases.',
    annotations: {
      title: 'Log Crit',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
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
    annotations: {
      title: 'List Crits',
      readOnlyHint: true,
      destructiveHint: false,
    },
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
// Sync Tokens Tool
// ============================================================================

export const designerSyncTokensTool: ToolSpec = {
  definition: {
    name: 'designer_sync_tokens',
    description: 'Sync design tokens from a Figma file. Fetches variables and saves them to .decibel/designer/tokens/. Requires FIGMA_ACCESS_TOKEN env var.',
    annotations: {
      title: 'Sync Design Tokens',
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Optional project identifier. Uses default project if not specified.',
        },
        fileKey: {
          type: 'string',
          description: 'Figma file key (the part after /file/ in the URL)',
        },
        forceRefresh: {
          type: 'boolean',
          description: 'Bypass cache and fetch fresh data (default: false)',
        },
      },
      required: ['fileKey'],
    },
  },
  handler: async (args) => {
    try {
      const rawInput = args as Record<string, unknown>;
      normalizeProjectId(rawInput);
      const input = rawInput as unknown as SyncTokensInput;

      requireFields(input, 'fileKey');

      const result = await syncTokens(input);
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// Review Figma Tool
// ============================================================================

export const designerReviewFigmaTool: ToolSpec = {
  definition: {
    name: 'designer_review_figma',
    description: 'Review a Figma component against project design principles. Checks accessibility, consistency, and custom principles. Requires FIGMA_ACCESS_TOKEN env var.',
    annotations: {
      title: 'Review Figma Component',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Optional project identifier. Uses default project if not specified.',
        },
        fileKey: {
          type: 'string',
          description: 'Figma file key (the part after /file/ in the URL)',
        },
        nodeId: {
          type: 'string',
          description: 'Component node ID (from the URL when component is selected)',
        },
        scope: {
          type: 'string',
          enum: ['full', 'accessibility', 'consistency'],
          description: 'Review scope: full (all checks), accessibility (a11y only), consistency (design system alignment)',
        },
      },
      required: ['fileKey', 'nodeId'],
    },
  },
  handler: async (args) => {
    try {
      const rawInput = args as Record<string, unknown>;
      normalizeProjectId(rawInput);
      const input = rawInput as unknown as ReviewFigmaInput;

      requireFields(input, 'fileKey', 'nodeId');

      const result = await reviewFigma(input);
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// Upsert Principle Tool
// ============================================================================

export const designerUpsertPrincipleTool: ToolSpec = {
  definition: {
    name: 'designer_upsert_principle',
    description: 'Create or update a design principle. Principles are used by designer_review_figma to check components.',
    annotations: {
      title: 'Upsert Principle',
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
        id: {
          type: 'string',
          description: 'Principle ID. If provided, updates existing. If omitted, creates new.',
        },
        title: {
          type: 'string',
          description: 'Principle title (e.g., "4px Grid System")',
        },
        description: {
          type: 'string',
          description: 'Full description of the principle',
        },
        category: {
          type: 'string',
          description: 'Category: spacing, color, typography, accessibility, etc.',
        },
        checks: {
          type: 'array',
          items: { type: 'string' },
          description: 'Things to verify (e.g., ["spacing must be multiples of 4"])',
        },
      },
      required: ['title', 'description', 'category'],
    },
  },
  handler: async (args) => {
    try {
      const rawInput = args as Record<string, unknown>;
      normalizeProjectId(rawInput);
      const input = rawInput as unknown as UpsertPrincipleInput;

      requireFields(input, 'title', 'description', 'category');

      const result = await upsertPrinciple(input);
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// List Principles Tool
// ============================================================================

export const designerListPrinciplesTool: ToolSpec = {
  definition: {
    name: 'designer_list_principles',
    description: 'List design principles for a project, optionally filtered by category.',
    annotations: {
      title: 'List Principles',
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
        category: {
          type: 'string',
          description: 'Filter by category (e.g., "spacing", "color")',
        },
      },
    },
  },
  handler: async (args) => {
    try {
      const rawInput = args as Record<string, unknown>;
      normalizeProjectId(rawInput);
      const input = rawInput as unknown as ListPrinciplesInput;

      const result = await listPrinciples(input);
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// Check Parity Tool (Figma drift detection)
// ============================================================================

export const designerCheckParityTool: ToolSpec = {
  definition: {
    name: 'designer_check_parity',
    description: 'Compare last-synced design tokens against current Figma state to detect drift. Reports added, removed, and changed tokens without modifying tokens.yaml. Run sync_tokens first to establish a baseline.',
    annotations: {
      title: 'Check Token Parity',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Optional project identifier. Uses default project if not specified.',
        },
        fileKey: {
          type: 'string',
          description: 'Figma file key (the part after /file/ in the URL)',
        },
      },
      required: ['fileKey'],
    },
  },
  handler: async (args) => {
    try {
      const rawInput = args as Record<string, unknown>;
      normalizeProjectId(rawInput);
      const input = rawInput as unknown as CheckParityInput;

      requireFields(input, 'fileKey');

      const result = await checkParity(input);
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
  designerSyncTokensTool,
  designerReviewFigmaTool,
  designerCheckParityTool,
  designerUpsertPrincipleTool,
  designerListPrinciplesTool,
  ...lateralTools,
];
