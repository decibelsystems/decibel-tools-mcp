// ============================================================================
// Feedback Domain Tool Definitions
// ============================================================================
// MCP tool specs for collecting and querying user/AI feedback.
// Phase 1: feedback_submit + feedback_list
// ============================================================================

import { ToolSpec } from '../types.js';
import { toolSuccess, toolError } from '../shared/index.js';
import {
  submitFeedback,
  listFeedback,
  isFeedbackError,
  SubmitFeedbackInput,
  ListFeedbackInput,
  FeedbackCategory,
  FeedbackSentiment,
  FeedbackSource,
  FeedbackStatus,
} from '../feedback.js';

// ============================================================================
// Constants
// ============================================================================

const VALID_CATEGORIES: FeedbackCategory[] = ['tool', 'workflow', 'docs', 'ux', 'perf', 'other'];
const VALID_SENTIMENTS: FeedbackSentiment[] = ['positive', 'negative'];
const VALID_SOURCES: FeedbackSource[] = ['human', 'agent'];
const VALID_STATUSES: FeedbackStatus[] = ['open', 'acknowledged', 'actioned', 'archived'];

// ============================================================================
// feedback_submit
// ============================================================================

export const feedbackSubmitTool: ToolSpec = {
  definition: {
    name: 'feedback_submit',
    description:
      'Submit feedback on a tool, workflow, or feature. Supports thumbs up/down sentiment, category tagging, and optional tool reference. Stored in .decibel/feedback/ for tracking.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Optional project identifier. Uses default project if not specified.',
        },
        category: {
          type: 'string',
          enum: VALID_CATEGORIES,
          description: 'Feedback category: tool, workflow, docs, ux, perf, or other',
        },
        feedback: {
          type: 'string',
          description: 'The feedback text - what you liked, disliked, or observed',
        },
        tool_ref: {
          type: 'string',
          description: 'Specific tool name (e.g., "workflow_preflight"). Most useful when category=tool.',
        },
        sentiment: {
          type: 'string',
          enum: VALID_SENTIMENTS,
          description: 'Thumbs up (positive) or thumbs down (negative). Default: positive.',
        },
        source: {
          type: 'string',
          enum: VALID_SOURCES,
          description: 'Who is giving feedback (default: human)',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags for categorization (e.g., ["helpful", "time-saver"])',
        },
      },
      required: ['category', 'feedback'],
    },
  },
  handler: async (args) => {
    try {
      const input = args as SubmitFeedbackInput;

      // Validate category
      if (!VALID_CATEGORIES.includes(input.category)) {
        throw new Error(`Invalid category: "${input.category}". Must be one of: ${VALID_CATEGORIES.join(', ')}`);
      }

      // Validate sentiment if provided
      if (input.sentiment && !VALID_SENTIMENTS.includes(input.sentiment)) {
        throw new Error(`Invalid sentiment: "${input.sentiment}". Must be one of: ${VALID_SENTIMENTS.join(', ')}`);
      }

      // Validate source if provided
      if (input.source && !VALID_SOURCES.includes(input.source)) {
        throw new Error(`Invalid source: "${input.source}". Must be one of: ${VALID_SOURCES.join(', ')}`);
      }

      const result = await submitFeedback(input);
      if (isFeedbackError(result)) {
        return toolError(result.error, result.details);
      }
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// feedback_list
// ============================================================================

export const feedbackListTool: ToolSpec = {
  definition: {
    name: 'feedback_list',
    description:
      'List feedback entries with optional filters. Returns entries and summary statistics including totals by category and sentiment breakdown.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Optional project identifier. Uses default project if not specified.',
        },
        category: {
          type: 'string',
          enum: VALID_CATEGORIES,
          description: 'Filter by category',
        },
        tool_ref: {
          type: 'string',
          description: 'Filter by specific tool name',
        },
        sentiment: {
          type: 'string',
          enum: VALID_SENTIMENTS,
          description: 'Filter by sentiment (positive or negative)',
        },
        status: {
          type: 'string',
          enum: VALID_STATUSES,
          description: 'Filter by status',
        },
        limit: {
          type: 'number',
          description: 'Maximum entries to return (default: 20)',
        },
        since: {
          type: 'string',
          description: 'Only include feedback created after this ISO date',
        },
      },
      required: [],
    },
  },
  handler: async (args) => {
    try {
      const result = await listFeedback(args as ListFeedbackInput);
      if (isFeedbackError(result)) {
        return toolError(result.error, result.details);
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

export const feedbackTools: ToolSpec[] = [
  feedbackSubmitTool,
  feedbackListTool,
];
