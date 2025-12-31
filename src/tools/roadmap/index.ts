// ============================================================================
// Roadmap Domain Tools
// ============================================================================
// Tools for strategic roadmap management - objectives, themes, milestones,
// and epic context.
// ============================================================================

import { ToolSpec } from '../types.js';
import { toolSuccess, toolError, requireFields } from '../shared/index.js';
import {
  getRoadmap,
  GetRoadmapInput,
  getEpicContext,
  GetEpicContextInput,
  getRoadmapHealth,
  GetRoadmapHealthInput,
  linkEpicToRoadmap,
  LinkEpicInput,
  roadmapList,
  RoadmapListInput,
  roadmapInit,
  RoadmapInitInput,
} from '../roadmap.js';

// ============================================================================
// Roadmap Get Tool
// ============================================================================

export const roadmapGetTool: ToolSpec = {
  definition: {
    name: 'roadmap_get',
    description: 'Get the strategic roadmap - objectives, themes, milestones, and epic context. Returns the full roadmap structure with summary stats.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'The project identifier (e.g., "senken")',
        },
      },
      required: ['projectId'],
    },
  },
  handler: async (args) => {
    try {
      const input = args as GetRoadmapInput;
      requireFields(input, 'projectId');
      const result = await getRoadmap(input);
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
// Roadmap List Tool
// ============================================================================

export const roadmapListTool: ToolSpec = {
  definition: {
    name: 'roadmap_list',
    description: 'List all epics with their roadmap context (theme, milestone, objectives) and health scores. Sorted by milestone target date.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'The project identifier (e.g., "senken")',
        },
      },
      required: ['projectId'],
    },
  },
  handler: async (args) => {
    try {
      const input = args as RoadmapListInput;
      requireFields(input, 'projectId');
      const result = await roadmapList(input);
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
// Roadmap Get Epic Context Tool
// ============================================================================

export const roadmapGetEpicContextTool: ToolSpec = {
  definition: {
    name: 'roadmap_getEpicContext',
    description: 'Get the strategic context for a specific epic - theme, milestone, objectives, and Oracle health annotation.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'The project identifier (e.g., "senken")',
        },
        epicId: {
          type: 'string',
          description: 'Epic ID to look up (e.g., "EPIC-0001")',
        },
      },
      required: ['projectId', 'epicId'],
    },
  },
  handler: async (args) => {
    try {
      const input = args as GetEpicContextInput;
      requireFields(input, 'projectId', 'epicId');
      const result = await getEpicContext(input);
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
// Roadmap Get Health Tool
// ============================================================================

export const roadmapGetHealthTool: ToolSpec = {
  definition: {
    name: 'roadmap_getHealth',
    description: "Get Oracle's health report - epics with low health scores that need attention. Use to prioritize work and identify risky areas.",
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'The project identifier (e.g., "senken")',
        },
        threshold: {
          type: 'number',
          description: 'Health score threshold (default: 0.7). Epics below this score are flagged.',
        },
      },
      required: ['projectId'],
    },
  },
  handler: async (args) => {
    try {
      const input = args as GetRoadmapHealthInput;
      requireFields(input, 'projectId');
      const result = await getRoadmapHealth(input);
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
// Roadmap Link Epic Tool
// ============================================================================

export const roadmapLinkEpicTool: ToolSpec = {
  definition: {
    name: 'roadmap_linkEpic',
    description: 'Link an epic to roadmap elements (theme, milestone, objectives). Maintains strategic context for your work.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'The project identifier (e.g., "senken")',
        },
        epicId: {
          type: 'string',
          description: 'Epic ID to link (e.g., "EPIC-0001")',
        },
        theme: {
          type: 'string',
          description: 'Theme ID (e.g., "foundations", "features")',
        },
        milestone: {
          type: 'string',
          description: 'Milestone ID (e.g., "M-0001")',
        },
        objectives: {
          type: 'array',
          items: { type: 'string' },
          description: 'Objective IDs to link (e.g., ["OBJ-0001"])',
        },
        workType: {
          type: 'string',
          enum: ['feature', 'infra', 'refactor', 'experiment', 'policy'],
          description: 'Type of work (default: feature)',
        },
        adrs: {
          type: 'array',
          items: { type: 'string' },
          description: 'Related ADR IDs',
        },
      },
      required: ['projectId', 'epicId'],
    },
  },
  handler: async (args) => {
    try {
      const input = args as LinkEpicInput;
      requireFields(input, 'projectId', 'epicId');
      const result = await linkEpicToRoadmap(input);
      if (result.status === 'error') {
        return toolError(JSON.stringify(result, null, 2));
      }
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// Roadmap Init Tool
// ============================================================================

export const roadmapInitTool: ToolSpec = {
  definition: {
    name: 'roadmap_init',
    description: 'Initialize a new roadmap.yaml scaffold with example objectives, themes, and milestones.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'The project identifier (e.g., "senken")',
        },
      },
      required: ['projectId'],
    },
  },
  handler: async (args) => {
    try {
      const input = args as RoadmapInitInput;
      requireFields(input, 'projectId');
      const result = await roadmapInit(input);
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// Export All Tools
// ============================================================================

export const roadmapTools: ToolSpec[] = [
  roadmapGetTool,
  roadmapListTool,
  roadmapGetEpicContextTool,
  roadmapGetHealthTool,
  roadmapLinkEpicTool,
  roadmapInitTool,
];
