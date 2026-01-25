// ============================================================================
// Velocity Domain Tools
// ============================================================================
// Tools for tracking contributor velocity across time periods.
// Captures commits, line counts, and issue metrics.
// DOJO-PROP-0006 Implementation
// ============================================================================

import { ToolSpec } from '../types.js';
import { toolSuccess, toolError, requireFields } from '../shared/index.js';
import {
  captureSnapshot,
  listSnapshots,
  getTrends,
  getContributorReport,
  installHook,
  uninstallHook,
  VelocitySnapshotInput,
  VelocityListInput,
  VelocityTrendsInput,
  VelocityContributorInput,
  InstallHookInput,
  UninstallHookInput,
  VelocityPeriod,
  isVelocityError,
} from '../velocity.js';

// ============================================================================
// Constants
// ============================================================================

const VALID_PERIODS: VelocityPeriod[] = ['daily', 'weekly', 'quarterly'];
const VALID_METRICS = ['commits', 'lines', 'issues'];

// ============================================================================
// velocity_snapshot - Capture a velocity snapshot
// ============================================================================

export const velocitySnapshotTool: ToolSpec = {
  definition: {
    name: 'velocity_snapshot',
    description: 'Capture a velocity snapshot for a time period. Aggregates git commits (with line counts) and Sentinel issues by contributor. Use this to track productivity metrics over time.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project identifier. Uses default project if not specified.',
        },
        period: {
          type: 'string',
          enum: ['daily', 'weekly', 'quarterly'],
          description: 'Time period for the snapshot: daily, weekly, or quarterly',
        },
        referenceDate: {
          type: 'string',
          description: 'Optional ISO date to use as reference (default: now). Useful for capturing historical snapshots.',
        },
      },
      required: ['period'],
    },
  },
  handler: async (args) => {
    try {
      const input = args as VelocitySnapshotInput;
      requireFields(input, 'period');

      if (!VALID_PERIODS.includes(input.period)) {
        throw new Error(`Invalid period. Must be one of: ${VALID_PERIODS.join(', ')}`);
      }

      const result = await captureSnapshot(input);
      if (isVelocityError(result)) {
        return toolError(JSON.stringify(result, null, 2));
      }
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// velocity_list - List snapshots
// ============================================================================

export const velocityListTool: ToolSpec = {
  definition: {
    name: 'velocity_list',
    description: 'List velocity snapshots for a project. Shows snapshot metadata including contributor count and totals.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project identifier. Uses default project if not specified.',
        },
        period: {
          type: 'string',
          enum: ['daily', 'weekly', 'quarterly'],
          description: 'Optional filter by time period',
        },
        limit: {
          type: 'integer',
          description: 'Maximum number of snapshots to return (default: 20)',
        },
      },
    },
  },
  handler: async (args) => {
    try {
      const input = args as VelocityListInput;

      if (input.period && !VALID_PERIODS.includes(input.period)) {
        throw new Error(`Invalid period. Must be one of: ${VALID_PERIODS.join(', ')}`);
      }

      const result = await listSnapshots(input);
      if (isVelocityError(result)) {
        return toolError(JSON.stringify(result, null, 2));
      }
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// velocity_trends - Get velocity trends
// ============================================================================

export const velocityTrendsTool: ToolSpec = {
  definition: {
    name: 'velocity_trends',
    description: 'Get velocity trends by comparing recent snapshots. Shows direction (up/down/stable) and percent change for commits, lines, and issues.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project identifier. Uses default project if not specified.',
        },
        period: {
          type: 'string',
          enum: ['daily', 'weekly', 'quarterly'],
          description: 'Time period to analyze trends for',
        },
        metric: {
          type: 'string',
          enum: ['commits', 'lines', 'issues'],
          description: 'Optional: filter to specific metric type',
        },
      },
      required: ['period'],
    },
  },
  handler: async (args) => {
    try {
      const input = args as VelocityTrendsInput;
      requireFields(input, 'period');

      if (!VALID_PERIODS.includes(input.period)) {
        throw new Error(`Invalid period. Must be one of: ${VALID_PERIODS.join(', ')}`);
      }

      if (input.metric && !VALID_METRICS.includes(input.metric)) {
        throw new Error(`Invalid metric. Must be one of: ${VALID_METRICS.join(', ')}`);
      }

      const result = await getTrends(input);
      if (isVelocityError(result)) {
        return toolError(JSON.stringify(result, null, 2));
      }
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// velocity_contributor - Individual contributor report
// ============================================================================

export const velocityContributorTool: ToolSpec = {
  definition: {
    name: 'velocity_contributor',
    description: 'Get velocity report for a specific contributor. Shows their metrics across snapshots with totals.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project identifier. Uses default project if not specified.',
        },
        contributorId: {
          type: 'string',
          description: 'Contributor ID to look up (full ID or partial match, e.g., email or name)',
        },
        period: {
          type: 'string',
          enum: ['daily', 'weekly', 'quarterly'],
          description: 'Optional filter by time period',
        },
        limit: {
          type: 'integer',
          description: 'Maximum number of snapshots to include (default: 10)',
        },
      },
      required: ['contributorId'],
    },
  },
  handler: async (args) => {
    try {
      const input = args as VelocityContributorInput;
      requireFields(input, 'contributorId');

      if (input.period && !VALID_PERIODS.includes(input.period)) {
        throw new Error(`Invalid period. Must be one of: ${VALID_PERIODS.join(', ')}`);
      }

      const result = await getContributorReport(input);
      if (isVelocityError(result)) {
        return toolError(JSON.stringify(result, null, 2));
      }
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// velocity_install_hook - Install auto-capture git hook
// ============================================================================

const VALID_HOOK_TYPES = ['post-commit', 'post-push'];

export const velocityInstallHookTool: ToolSpec = {
  definition: {
    name: 'velocity_install_hook',
    description: 'Install a git hook to auto-capture velocity snapshots. The hook runs after commits and captures a daily snapshot if one doesn\'t exist for today. Idempotent - safe to run multiple times.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project identifier. Uses default project if not specified.',
        },
        hookType: {
          type: 'string',
          enum: ['post-commit', 'post-push'],
          description: 'Git hook type to install (default: post-commit)',
        },
        periods: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['daily', 'weekly', 'quarterly'],
          },
          description: 'Which snapshot periods to auto-capture (default: [\'daily\'])',
        },
      },
    },
  },
  handler: async (args) => {
    try {
      const input = args as InstallHookInput;

      if (input.hookType && !VALID_HOOK_TYPES.includes(input.hookType)) {
        throw new Error(`Invalid hookType. Must be one of: ${VALID_HOOK_TYPES.join(', ')}`);
      }

      if (input.periods) {
        for (const period of input.periods) {
          if (!VALID_PERIODS.includes(period as VelocityPeriod)) {
            throw new Error(`Invalid period "${period}". Must be one of: ${VALID_PERIODS.join(', ')}`);
          }
        }
      }

      const result = await installHook(input);
      if (isVelocityError(result)) {
        return toolError(JSON.stringify(result, null, 2));
      }
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// velocity_uninstall_hook - Remove auto-capture git hook
// ============================================================================

export const velocityUninstallHookTool: ToolSpec = {
  definition: {
    name: 'velocity_uninstall_hook',
    description: 'Remove the velocity auto-capture git hook. Preserves other hooks if present.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project identifier. Uses default project if not specified.',
        },
        hookType: {
          type: 'string',
          enum: ['post-commit', 'post-push'],
          description: 'Git hook type to remove (default: post-commit)',
        },
      },
    },
  },
  handler: async (args) => {
    try {
      const input = args as UninstallHookInput;

      if (input.hookType && !VALID_HOOK_TYPES.includes(input.hookType)) {
        throw new Error(`Invalid hookType. Must be one of: ${VALID_HOOK_TYPES.join(', ')}`);
      }

      const result = await uninstallHook(input);
      if (isVelocityError(result)) {
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

export const velocityTools: ToolSpec[] = [
  velocitySnapshotTool,
  velocityListTool,
  velocityTrendsTool,
  velocityContributorTool,
  velocityInstallHookTool,
  velocityUninstallHookTool,
];
