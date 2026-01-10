// ============================================================================
// Corpus Domain Tools
// ============================================================================
// MCP tools for searching decibel-corpus - the shared knowledge base.
// Enables cross-project learning from patterns, playbooks, and field notes.
// ============================================================================

import { ToolSpec } from '../types.js';
import { toolSuccess, toolError, requireFields } from '../shared/index.js';
import {
  corpusSearch,
  CorpusSearchInput,
  CorpusContentType,
  getCorpusPath,
  corpusExists,
} from '../corpus.js';

// ============================================================================
// Constants
// ============================================================================

const VALID_TYPES: (CorpusContentType | 'all')[] = ['pattern', 'playbook', 'field-note', 'all'];

// ============================================================================
// Corpus Search Tool
// ============================================================================

export const corpusSearchTool: ToolSpec = {
  definition: {
    name: 'corpus_search',
    description: `Search decibel-corpus for patterns, playbooks, and field notes. Use when you encounter problems that may have been solved before (DB collisions, auth patterns, deployment issues, webhook retries, etc.). Returns matching documents with snippets and relevance scores.`,
    annotations: {
      title: 'Search Corpus',
      readOnlyHint: true,
      destructiveHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search terms (e.g., "duplicate key", "advisory lock", "webhook retry", "rate limit")',
        },
        type: {
          type: 'string',
          enum: ['pattern', 'playbook', 'field-note', 'all'],
          description: 'Filter by content type. Patterns are reusable solutions, playbooks are step-by-step guides, field-notes are lessons learned. Default: all',
        },
        limit: {
          type: 'number',
          description: 'Maximum results to return (default: 5)',
        },
      },
      required: ['query'],
    },
  },
  handler: async (args) => {
    try {
      const input = args as CorpusSearchInput;
      requireFields(input, 'query');

      if (input.type && !VALID_TYPES.includes(input.type)) {
        throw new Error(`Invalid type: ${input.type}. Must be one of: ${VALID_TYPES.join(', ')}`);
      }

      // Check if corpus exists
      if (!await corpusExists()) {
        return toolError(
          `Corpus not found at ${getCorpusPath()}`,
          'Clone decibel-corpus to ~/Documents/GitHub/decibel-corpus or set DECIBEL_CORPUS_PATH'
        );
      }

      const result = await corpusSearch(input);
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// Corpus Status Tool (for debugging)
// ============================================================================

export const corpusStatusTool: ToolSpec = {
  definition: {
    name: 'corpus_status',
    description: 'Check the status of decibel-corpus. Shows location and whether it exists.',
    annotations: {
      title: 'Corpus Status',
      readOnlyHint: true,
      destructiveHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  handler: async () => {
    try {
      const path = getCorpusPath();
      const exists = await corpusExists();

      return toolSuccess({
        corpus_path: path,
        exists,
        hint: exists
          ? 'Corpus is available. Use corpus_search to find patterns.'
          : 'Clone decibel-corpus to this path or set DECIBEL_CORPUS_PATH env var.',
      });
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// Export All Tools
// ============================================================================

export const corpusTools: ToolSpec[] = [
  corpusSearchTool,
  corpusStatusTool,
];
