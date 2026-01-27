// ============================================================================
// Workflow Domain Tool Definitions
// ============================================================================
// High-level workflow tools for AI assistants. These chain multiple Decibel
// tools to provide unified, actionable results.
// ============================================================================

import { ToolSpec } from '../types.js';
import { toolSuccess, toolError } from '../shared/index.js';
import {
  workflowStatus,
  workflowPreflight,
  workflowShip,
  workflowInvestigate,
  isWorkflowError,
  WorkflowStatusInput,
  WorkflowPreflightInput,
  WorkflowShipInput,
  WorkflowInvestigateInput,
} from '../workflow.js';

// ============================================================================
// workflow_status
// ============================================================================

export const workflowStatusTool: ToolSpec = {
  definition: {
    name: 'workflow_status',
    description: 'Get comprehensive project health status. Shows git state, open issues, roadmap health, friction points, code quality, and recommended next actions. Use at start of work sessions or for quick pulse checks.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project identifier. Uses current project if not specified.',
        },
      },
      required: [],
    },
  },
  handler: async (args) => {
    try {
      const result = await workflowStatus(args as WorkflowStatusInput);
      if (isWorkflowError(result)) {
        return toolError(result.error, result.details);
      }
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// workflow_preflight
// ============================================================================

export const workflowPreflightTool: ToolSpec = {
  definition: {
    name: 'workflow_preflight',
    description: 'Run pre-commit quality checks. Validates git status, data integrity, code quality (via auditor), and blocked issues. Use before committing or creating PRs. With strict=true, warnings become failures.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project identifier. Uses current project if not specified.',
        },
        strict: {
          type: 'boolean',
          description: 'If true, warnings cause failure. Use for pre-merge checks. Default: false',
        },
      },
      required: [],
    },
  },
  handler: async (args) => {
    try {
      const result = await workflowPreflight(args as WorkflowPreflightInput);
      if (isWorkflowError(result)) {
        return toolError(result.error, result.details);
      }
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// workflow_ship
// ============================================================================

export const workflowShipTool: ToolSpec = {
  definition: {
    name: 'workflow_ship',
    description: 'Comprehensive pre-release readiness check. Runs preflight (strict), checks roadmap health, verifies no blocked issues, confirms git state. Returns ready/not-ready status with blockers, warnings, and next steps.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project identifier. Uses current project if not specified.',
        },
        dryRun: {
          type: 'boolean',
          description: 'If true, only report status without any side effects. Default: false',
        },
      },
      required: [],
    },
  },
  handler: async (args) => {
    try {
      const result = await workflowShip(args as WorkflowShipInput);
      if (isWorkflowError(result)) {
        return toolError(result.error, result.details);
      }
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// workflow_investigate
// ============================================================================

export const workflowInvestigateTool: ToolSpec = {
  definition: {
    name: 'workflow_investigate',
    description: 'Gather debugging context when something broke. Returns recent commits, issues, related friction points, and learnings. Optionally filter by context (e.g., "auth", "database"). Suggests follow-up tools like git_find_removal.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project identifier. Uses current project if not specified.',
        },
        context: {
          type: 'string',
          description: 'Optional hint about what broke (e.g., "auth", "payments"). Filters commits and friction.',
        },
      },
      required: [],
    },
  },
  handler: async (args) => {
    try {
      const result = await workflowInvestigate(args as WorkflowInvestigateInput);
      if (isWorkflowError(result)) {
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

export const workflowTools: ToolSpec[] = [
  workflowStatusTool,
  workflowPreflightTool,
  workflowShipTool,
  workflowInvestigateTool,
];
