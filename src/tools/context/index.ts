// ============================================================================
// Context Domain Tools
// ============================================================================
// Tools for context packs, pinned facts, events, and artifacts.
// ============================================================================

import { ToolSpec } from '../types.js';
import { toolSuccess, toolError, requireFields } from '../shared/index.js';
import {
  contextRefresh,
  ContextRefreshInput,
  contextPin,
  ContextPinInput,
  contextUnpin,
  ContextUnpinInput,
  contextList,
  ContextListInput,
  eventAppend,
  EventAppendInput,
  eventSearch,
  EventSearchInput,
  artifactList,
  ArtifactListInput,
  artifactRead,
  ArtifactReadInput,
  isContextError,
} from '../context.js';

// ============================================================================
// Helper: Normalize project_id → projectId
// ============================================================================

function normalizeProjectId(args: Record<string, unknown>): void {
  if (!args.projectId && args.project_id) {
    args.projectId = args.project_id;
  }
}

// ============================================================================
// Context Refresh Tool
// ============================================================================

export const contextRefreshTool: ToolSpec = {
  definition: {
    name: 'decibel_context_refresh',
    description: 'Compile full context pack for AI memory. Returns pinned facts, recent events, and current state.',
    annotations: {
      title: 'Refresh Context',
      readOnlyHint: true,
      destructiveHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'Project ID (e.g., "senken")',
        },
        caller_role: {
          type: 'string',
          enum: ['human', 'mother', 'ai'],
          description: 'Role of the caller for access control (default: human)',
        },
        agent_id: {
          type: 'string',
          description: 'Identifier for the calling agent',
        },
        sections: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific sections to include (e.g., ["pinned_facts", "recent_runs"])',
        },
      },
      required: ['project_id'],
    },
  },
  handler: async (args) => {
    try {
      const rawInput = args as Record<string, unknown>;
      normalizeProjectId(rawInput);
      const input = rawInput as unknown as ContextRefreshInput;
      const result = await contextRefresh(input);
      if (isContextError(result)) {
        return toolError(JSON.stringify(result, null, 2));
      }
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// Context Pin Tool
// ============================================================================

export const contextPinTool: ToolSpec = {
  definition: {
    name: 'decibel_context_pin',
    description: 'Pin a fact to persistent memory. Mother uses this to remember important insights.',
    annotations: {
      title: 'Pin Context',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'Project ID (e.g., "senken")',
        },
        caller_role: {
          type: 'string',
          enum: ['human', 'mother', 'ai'],
          description: 'Role of the caller for access control (default: human)',
        },
        agent_id: {
          type: 'string',
          description: 'Identifier for the calling agent',
        },
        title: {
          type: 'string',
          description: 'Short title for the fact',
        },
        body: {
          type: 'string',
          description: 'Detailed content of the fact',
        },
        trust: {
          type: 'string',
          enum: ['high', 'medium', 'low'],
          description: 'Trust level for this fact',
        },
        refs: {
          type: 'array',
          items: { type: 'string' },
          description: 'References (e.g., ["DOJO-EXP-0001", "ADR-002"])',
        },
      },
      required: ['project_id', 'title'],
    },
  },
  handler: async (args) => {
    try {
      const rawInput = args as Record<string, unknown>;
      normalizeProjectId(rawInput);
      const input = rawInput as unknown as ContextPinInput;
      requireFields(input, 'title');
      const result = await contextPin(input);
      if (isContextError(result)) {
        return toolError(JSON.stringify(result, null, 2));
      }
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// Context Unpin Tool
// ============================================================================

export const contextUnpinTool: ToolSpec = {
  definition: {
    name: 'decibel_context_unpin',
    description: 'Remove a pinned fact from persistent memory.',
    annotations: {
      title: 'Unpin Context',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'Project ID (e.g., "senken")',
        },
        caller_role: {
          type: 'string',
          enum: ['human', 'mother', 'ai'],
          description: 'Role of the caller for access control (default: human)',
        },
        agent_id: {
          type: 'string',
          description: 'Identifier for the calling agent',
        },
        id: {
          type: 'string',
          description: 'Fact ID to unpin',
        },
      },
      required: ['project_id', 'id'],
    },
  },
  handler: async (args) => {
    try {
      const rawInput = args as Record<string, unknown>;
      normalizeProjectId(rawInput);
      const input = rawInput as unknown as ContextUnpinInput;
      requireFields(input, 'id');
      const result = await contextUnpin(input);
      if (isContextError(result)) {
        return toolError(JSON.stringify(result, null, 2));
      }
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// Context List Tool
// ============================================================================

export const contextListTool: ToolSpec = {
  definition: {
    name: 'decibel_context_list',
    description: 'List all pinned facts.',
    annotations: {
      title: 'List Context',
      readOnlyHint: true,
      destructiveHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'Project ID (e.g., "senken")',
        },
        caller_role: {
          type: 'string',
          enum: ['human', 'mother', 'ai'],
          description: 'Role of the caller for access control (default: human)',
        },
        agent_id: {
          type: 'string',
          description: 'Identifier for the calling agent',
        },
      },
      required: ['project_id'],
    },
  },
  handler: async (args) => {
    try {
      const rawInput = args as Record<string, unknown>;
      normalizeProjectId(rawInput);
      const input = rawInput as unknown as ContextListInput;
      const result = await contextList(input);
      if (isContextError(result)) {
        return toolError(JSON.stringify(result, null, 2));
      }
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// Event Append Tool
// ============================================================================

export const eventAppendTool: ToolSpec = {
  definition: {
    name: 'decibel_event_append',
    description: 'Append an event to the activity journal. Append-only log of significant activities.',
    annotations: {
      title: 'Append Event',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'Project ID (e.g., "senken")',
        },
        caller_role: {
          type: 'string',
          enum: ['human', 'mother', 'ai'],
          description: 'Role of the caller for access control (default: human)',
        },
        agent_id: {
          type: 'string',
          description: 'Identifier for the calling agent',
        },
        title: {
          type: 'string',
          description: 'Event title',
        },
        body: {
          type: 'string',
          description: 'Event details',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags for categorization (e.g., ["experiment", "success"])',
        },
      },
      required: ['project_id', 'title'],
    },
  },
  handler: async (args) => {
    try {
      const rawInput = args as Record<string, unknown>;
      normalizeProjectId(rawInput);
      const input = rawInput as unknown as EventAppendInput;
      requireFields(input, 'title');
      const result = await eventAppend(input);
      if (isContextError(result)) {
        return toolError(JSON.stringify(result, null, 2));
      }
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// Event Search Tool
// ============================================================================

export const eventSearchTool: ToolSpec = {
  definition: {
    name: 'decibel_event_search',
    description: 'Search events in the activity journal.',
    annotations: {
      title: 'Search Events',
      readOnlyHint: true,
      destructiveHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'Project ID (e.g., "senken")',
        },
        caller_role: {
          type: 'string',
          enum: ['human', 'mother', 'ai'],
          description: 'Role of the caller for access control (default: human)',
        },
        agent_id: {
          type: 'string',
          description: 'Identifier for the calling agent',
        },
        query: {
          type: 'string',
          description: 'Search query',
        },
        limit: {
          type: 'number',
          description: 'Max results to return (default: 20)',
        },
      },
      required: ['project_id', 'query'],
    },
  },
  handler: async (args) => {
    try {
      const rawInput = args as Record<string, unknown>;
      normalizeProjectId(rawInput);
      const input = rawInput as unknown as EventSearchInput;
      requireFields(input, 'query');
      const result = await eventSearch(input);
      if (isContextError(result)) {
        return toolError(JSON.stringify(result, null, 2));
      }
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// Artifact List Tool
// ============================================================================

export const artifactListTool: ToolSpec = {
  definition: {
    name: 'decibel_artifact_list',
    description: 'List artifacts for a specific run. Use run_id from dojo_run_experiment response.',
    annotations: {
      title: 'List Artifacts',
      readOnlyHint: true,
      destructiveHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'Project ID (e.g., "senken")',
        },
        caller_role: {
          type: 'string',
          enum: ['human', 'mother', 'ai'],
          description: 'Role of the caller for access control (default: human)',
        },
        agent_id: {
          type: 'string',
          description: 'Identifier for the calling agent',
        },
        run_id: {
          type: 'string',
          description: 'Run ID (e.g., "20251216-070615")',
        },
      },
      required: ['project_id', 'run_id'],
    },
  },
  handler: async (args) => {
    try {
      const rawInput = args as Record<string, unknown>;
      normalizeProjectId(rawInput);
      const input = rawInput as unknown as ArtifactListInput;
      requireFields(input, 'run_id');
      const result = await artifactList(input);
      if (isContextError(result)) {
        return toolError(JSON.stringify(result, null, 2));
      }
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// Artifact Read Tool
// ============================================================================

export const artifactReadTool: ToolSpec = {
  definition: {
    name: 'decibel_artifact_read',
    description: 'Read an artifact by run_id and name. Returns content with mime type.',
    annotations: {
      title: 'Read Artifact',
      readOnlyHint: true,
      destructiveHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'Project ID (e.g., "senken")',
        },
        caller_role: {
          type: 'string',
          enum: ['human', 'mother', 'ai'],
          description: 'Role of the caller for access control (default: human)',
        },
        agent_id: {
          type: 'string',
          description: 'Identifier for the calling agent',
        },
        run_id: {
          type: 'string',
          description: 'Run ID (e.g., "20251216-070615")',
        },
        name: {
          type: 'string',
          description: 'Artifact name (e.g., "result.yaml")',
        },
      },
      required: ['project_id', 'run_id', 'name'],
    },
  },
  handler: async (args) => {
    try {
      const rawInput = args as Record<string, unknown>;
      normalizeProjectId(rawInput);
      const input = rawInput as unknown as ArtifactReadInput;
      requireFields(input, 'run_id', 'name');
      const result = await artifactRead(input);
      if (isContextError(result)) {
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

export const contextTools: ToolSpec[] = [
  contextRefreshTool,
  contextPinTool,
  contextUnpinTool,
  contextListTool,
  eventAppendTool,
  eventSearchTool,
  artifactListTool,
  artifactReadTool,
];
