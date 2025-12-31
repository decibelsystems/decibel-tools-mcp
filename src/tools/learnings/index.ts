// ============================================================================
// Learnings Domain Tools
// ============================================================================
// Tools for tracking technical learnings and insights.
// ============================================================================

import { ToolSpec } from '../types.js';
import { toolSuccess, toolError, requireFields } from '../shared/index.js';
import {
  appendLearning,
  AppendLearningInput,
  LearningCategory,
  listLearnings,
  ListLearningsInput,
} from '../learnings.js';

// ============================================================================
// Types
// ============================================================================

const VALID_CATEGORIES: LearningCategory[] = ['debug', 'integration', 'architecture', 'tooling', 'process', 'other'];

// ============================================================================
// Helper: Normalize project_id → projectId
// ============================================================================

function normalizeProjectId(args: Record<string, unknown>): void {
  if (!args.projectId && args.project_id) {
    args.projectId = args.project_id;
  }
}

// ============================================================================
// Append Learning Tool
// ============================================================================

export const learningsAppendTool: ToolSpec = {
  definition: {
    name: 'learnings_append',
    description: "Append a new entry to a project's technical learnings document. Creates a living document that accumulates lessons learned, gotchas, and insights over time.",
    inputSchema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'The project identifier (creates learnings/{project_id}.md)',
        },
        category: {
          type: 'string',
          enum: ['debug', 'integration', 'architecture', 'tooling', 'process', 'other'],
          description: 'Category of the learning',
        },
        title: {
          type: 'string',
          description: 'Brief title for this learning entry',
        },
        content: {
          type: 'string',
          description: 'The learning content - what happened, what was learned, how to avoid/replicate',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional tags for searchability (e.g., ["mcp", "auth", "tokens"])',
        },
      },
      required: ['project_id', 'category', 'title', 'content'],
    },
  },
  handler: async (args) => {
    try {
      const rawInput = args as Record<string, unknown>;
      normalizeProjectId(rawInput);
      const input = rawInput as unknown as AppendLearningInput;

      requireFields(input, 'category', 'title', 'content');

      if (!VALID_CATEGORIES.includes(input.category)) {
        throw new Error(`Invalid category. Must be one of: ${VALID_CATEGORIES.join(', ')}`);
      }

      const result = await appendLearning(input);
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// List Learnings Tool
// ============================================================================

export const learningsListTool: ToolSpec = {
  definition: {
    name: 'learnings_list',
    description: "List entries from a project's technical learnings document, optionally filtered by category.",
    inputSchema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'The project identifier',
        },
        category: {
          type: 'string',
          enum: ['debug', 'integration', 'architecture', 'tooling', 'process', 'other'],
          description: 'Optional category filter',
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
      const input = rawInput as unknown as ListLearningsInput;

      if (input.category && !VALID_CATEGORIES.includes(input.category)) {
        throw new Error(`Invalid category. Must be one of: ${VALID_CATEGORIES.join(', ')}`);
      }

      const result = await listLearnings(input);
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// Export All Tools
// ============================================================================

export const learningsTools: ToolSpec[] = [
  learningsAppendTool,
  learningsListTool,
];
