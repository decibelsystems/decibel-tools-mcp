// ============================================================================
// Auditor Domain Tool Definitions
// ============================================================================
// Code health assessment tools for detecting smells, naming issues, and
// providing refactoring recommendations.
// ============================================================================

import { ToolSpec } from '../types.js';
import { toolSuccess, toolError } from '../shared/index.js';
import {
  auditorTriage,
  auditorHealth,
  auditorRefactorScore,
  auditorNamingAudit,
  auditorInit,
  auditorLogHealth,
  auditorHealthHistory,
  isAuditorError,
  AuditorTriageInput,
  AuditorHealthInput,
  AuditorRefactorInput,
  AuditorNamingInput,
  AuditorInitInput,
  AuditorLogHealthInput,
  AuditorHealthHistoryInput,
  SmellType,
} from '../auditor.js';

// ============================================================================
// Constants
// ============================================================================

const VALID_SMELL_TYPES: SmellType[] = [
  'god_file',
  'rule_sprawl',
  'dip_violation',
  'duplicate_code',
  'hidden_rules',
  'buried_legacy',
  'naming_drift',
  'missing_tests',
  'hidden_side_effects',
  'hardcoded_values',
];

// ============================================================================
// auditor_triage
// ============================================================================

export const auditorTriageTool: ToolSpec = {
  definition: {
    name: 'auditor_triage',
    description: 'Run quick code smell triage on a file or directory. Detects god files, deep nesting, magic numbers, hardcoded values, and buried legacy code. Use before committing or during code review.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project identifier. Uses current project if not specified.',
        },
        path: {
          type: 'string',
          description: 'Specific file or directory to scan. Defaults to src/',
        },
        checks: {
          type: 'array',
          items: {
            type: 'string',
            enum: VALID_SMELL_TYPES,
          },
          description: 'Which smell types to check for. Defaults to common checks: god_file, rule_sprawl, hidden_rules, buried_legacy, hardcoded_values',
        },
        extensions: {
          type: 'array',
          items: { type: 'string' },
          description: 'File extensions to scan (e.g., [".py", ".pyi"]). Auto-detected from project type if not specified.',
        },
      },
      required: [],
    },
  },
  handler: async (args) => {
    try {
      const input = args as AuditorTriageInput;

      // Validate checks if provided
      if (input.checks) {
        for (const check of input.checks) {
          if (!VALID_SMELL_TYPES.includes(check)) {
            throw new Error(`Invalid check type: ${check}. Valid types: ${VALID_SMELL_TYPES.join(', ')}`);
          }
        }
      }

      const result = await auditorTriage(input);
      if (isAuditorError(result)) {
        return toolError(result.error, result.details);
      }
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// auditor_health_dashboard
// ============================================================================

export const auditorHealthTool: ToolSpec = {
  definition: {
    name: 'auditor_health_dashboard',
    description: 'Generate a code health dashboard with metrics: total files/lines, god files count, average file size, smell counts, and top offenders. Use for periodic health checks and tracking trends.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project identifier. Uses current project if not specified.',
        },
        extensions: {
          type: 'array',
          items: { type: 'string' },
          description: 'File extensions to scan (e.g., [".py"]). Auto-detected from project type if not specified.',
        },
      },
      required: [],
    },
  },
  handler: async (args) => {
    try {
      const result = await auditorHealth(args as AuditorHealthInput);
      if (isAuditorError(result)) {
        return toolError(result.error, result.details);
      }
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// auditor_refactor_score
// ============================================================================

export const auditorRefactorTool: ToolSpec = {
  definition: {
    name: 'auditor_refactor_score',
    description: 'Score and rank files by refactoring urgency. Combines file size, complexity, and smell count into a priority score. Returns recommendations: split, extract, simplify, or delete.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project identifier. Uses current project if not specified.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of candidates to return (default: 10)',
        },
        extensions: {
          type: 'array',
          items: { type: 'string' },
          description: 'File extensions to scan (e.g., [".py"]). Auto-detected from project type if not specified.',
        },
      },
      required: [],
    },
  },
  handler: async (args) => {
    try {
      const result = await auditorRefactorScore(args as AuditorRefactorInput);
      if (isAuditorError(result)) {
        return toolError(result.error, result.details);
      }
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// auditor_naming_audit
// ============================================================================

export const auditorNamingTool: ToolSpec = {
  definition: {
    name: 'auditor_naming_audit',
    description: 'Audit file and identifier naming against conventions. Detects anti-patterns like "utils", "helpers", "misc" in file names. For full naming audit, create naming-conventions.yml first.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project identifier. Uses current project if not specified.',
        },
        conventions: {
          type: 'string',
          description: 'Path to naming-conventions.yml. Auto-detects if not provided.',
        },
        extensions: {
          type: 'array',
          items: { type: 'string' },
          description: 'File extensions to scan (e.g., [".py"]). Auto-detected from project type if not specified.',
        },
      },
      required: [],
    },
  },
  handler: async (args) => {
    try {
      const result = await auditorNamingAudit(args as AuditorNamingInput);
      if (isAuditorError(result)) {
        return toolError(result.error, result.details);
      }
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// auditor_init
// ============================================================================

export const auditorInitTool: ToolSpec = {
  definition: {
    name: 'auditor_init',
    description: 'Initialize naming conventions scaffold. Creates naming-conventions.yml with example patterns for entities, file naming, and anti-patterns to avoid.',
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
      const result = await auditorInit(args as AuditorInitInput);
      if (isAuditorError(result)) {
        return toolError(result.error, result.details);
      }
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// auditor_log_health
// ============================================================================

export const auditorLogHealthTool: ToolSpec = {
  definition: {
    name: 'auditor_log_health',
    description: 'Record a health snapshot for trend tracking. Call this periodically (e.g., after commits, weekly) to build health history. Stores metrics in .decibel/auditor/health-log.yaml.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project identifier. Uses current project if not specified.',
        },
        commit: {
          type: 'string',
          description: 'Optional git commit SHA to associate with this snapshot.',
        },
      },
      required: [],
    },
  },
  handler: async (args) => {
    try {
      const result = await auditorLogHealth(args as AuditorLogHealthInput);
      if (isAuditorError(result)) {
        return toolError(result.error, result.details);
      }
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// auditor_health_history
// ============================================================================

export const auditorHealthHistoryTool: ToolSpec = {
  definition: {
    name: 'auditor_health_history',
    description: 'Get health history and computed trends. Shows how code health has changed over time. Returns improvement/degradation signals for god files and code smells.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project identifier. Uses current project if not specified.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of snapshots to return (default: 10)',
        },
      },
      required: [],
    },
  },
  handler: async (args) => {
    try {
      const result = await auditorHealthHistory(args as AuditorHealthHistoryInput);
      if (isAuditorError(result)) {
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

export const auditorTools: ToolSpec[] = [
  auditorTriageTool,
  auditorHealthTool,
  auditorRefactorTool,
  auditorNamingTool,
  auditorInitTool,
  auditorLogHealthTool,
  auditorHealthHistoryTool,
];
