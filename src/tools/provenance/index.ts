// ============================================================================
// Provenance Domain Tools
// ============================================================================
// Tools for tracking artifact and actor provenance/history.
// ============================================================================

import { ToolSpec } from '../types.js';
import { toolSuccess, toolError } from '../shared/index.js';
import {
  listProvenance,
  ListProvenanceInput,
} from '../provenance.js';

// ============================================================================
// Provenance List Tool
// ============================================================================

export const provenanceListTool: ToolSpec = {
  definition: {
    name: 'provenance_list',
    description: 'List provenance events for an artifact or actor. Shows the history of changes with fingerprints for tracking who did what and when.',
    annotations: {
      title: 'List Provenance',
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
        artifact_ref: {
          type: 'string',
          description: 'Filter by artifact reference (e.g., "sentinel:issue:2025-01-01T00-00-00Z-my-issue.md")',
        },
        actor_id: {
          type: 'string',
          description: 'Filter by actor ID (e.g., "ai:claude", "human:alice")',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of events to return (default: 50)',
        },
      },
      required: [],
    },
  },
  handler: async (args) => {
    try {
      const input = args as ListProvenanceInput;
      const result = await listProvenance(input);
      if ('error' in result && result.error === 'project_resolution_failed') {
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

export const provenanceTools: ToolSpec[] = [
  provenanceListTool,
];
