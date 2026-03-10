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
  addPattern,
  AddPatternInput,
  addFieldNote,
  AddFieldNoteInput,
  addPlaybook,
  AddPlaybookInput,
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
// Corpus Add Pattern Tool
// ============================================================================

export const corpusAddPatternTool: ToolSpec = {
  definition: {
    name: 'corpus_add_pattern',
    description: `Add a reusable pattern to decibel-corpus. Patterns are named solutions to recurring problems (e.g., "advisory lock for idempotency", "exponential backoff with jitter"). The id must match PREFIX-NNNN format (e.g., DBS-0004). Will not overwrite existing files.`,
    annotations: {
      title: 'Add Corpus Pattern',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Pattern identifier in PREFIX-NNNN format (e.g., DBS-0004, A11Y-0001)',
        },
        title: {
          type: 'string',
          description: 'Human-readable title (e.g., "Advisory Lock for Idempotent Mutations")',
        },
        content: {
          type: 'string',
          description: 'Markdown body — problem statement, solution, code examples, trade-offs',
        },
        category: {
          type: 'string',
          description: 'Optional subdirectory within primitives/patterns/ (e.g., "concurrency", "auth")',
        },
        status: {
          type: 'string',
          description: 'Pattern maturity: draft, reviewed, canonical (default: draft)',
        },
        severity: {
          type: 'string',
          description: 'Impact level if the pattern is not followed (e.g., "high", "critical")',
        },
        source: {
          type: 'string',
          description: 'Where this pattern was discovered (e.g., "EPIC-0032", "incident-2026-03")',
        },
        owner: {
          type: 'string',
          description: 'Who authored or is responsible for this pattern',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Searchable tags (e.g., ["postgres", "concurrency", "idempotency"])',
        },
      },
      required: ['id', 'title', 'content'],
    },
  },
  handler: async (args) => {
    try {
      const input = args as AddPatternInput;
      requireFields(input, 'id', 'title', 'content');
      const result = await addPattern(input);
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// Corpus Add Field Note Tool
// ============================================================================

export const corpusAddFieldNoteTool: ToolSpec = {
  definition: {
    name: 'corpus_add_field_note',
    description: `Add a field note to decibel-corpus. Field notes capture lessons learned, gotchas, and observations from real work — things that aren't patterns yet but are worth remembering. Filename is auto-generated as YYYY-MM-DD-{slug}.md. Will not overwrite existing files.`,
    annotations: {
      title: 'Add Corpus Field Note',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Descriptive title (e.g., "Supabase RLS gotcha with service role key")',
        },
        content: {
          type: 'string',
          description: 'Markdown body — what happened, what was learned, any code examples',
        },
        source: {
          type: 'string',
          description: 'Context where this was observed (e.g., "EPIC-0032", "senken deploy 2026-03")',
        },
        owner: {
          type: 'string',
          description: 'Who captured this note',
        },
        status: {
          type: 'string',
          description: 'Note maturity: draft, reviewed, promoted (default: draft)',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Searchable tags (e.g., ["supabase", "rls", "auth"])',
        },
      },
      required: ['title', 'content'],
    },
  },
  handler: async (args) => {
    try {
      const input = args as AddFieldNoteInput;
      requireFields(input, 'title', 'content');
      const result = await addFieldNote(input);
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// Corpus Add Playbook Tool
// ============================================================================

export const corpusAddPlaybookTool: ToolSpec = {
  definition: {
    name: 'corpus_add_playbook',
    description: `Add a playbook to decibel-corpus. Playbooks are step-by-step guides for specific operations (e.g., "deploy senken to production", "rotate Supabase keys", "onboard new MCP module"). Filename is auto-generated as {slug}.md. Will not overwrite existing files.`,
    annotations: {
      title: 'Add Corpus Playbook',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Playbook title (e.g., "Deploy Senken to Production")',
        },
        content: {
          type: 'string',
          description: 'Markdown body — numbered steps, prerequisites, rollback procedures',
        },
        owner: {
          type: 'string',
          description: 'Who authored this playbook',
        },
        status: {
          type: 'string',
          description: 'Playbook maturity: draft, reviewed, canonical (default: draft)',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Searchable tags (e.g., ["deployment", "senken", "production"])',
        },
      },
      required: ['title', 'content'],
    },
  },
  handler: async (args) => {
    try {
      const input = args as AddPlaybookInput;
      requireFields(input, 'title', 'content');
      const result = await addPlaybook(input);
      return toolSuccess(result);
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
  corpusAddPatternTool,
  corpusAddFieldNoteTool,
  corpusAddPlaybookTool,
];
