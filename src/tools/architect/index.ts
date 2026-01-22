// ============================================================================
// Architect Domain Tools
// ============================================================================
// Tools for architecture decision records (ADRs) and policy management.
// ============================================================================

import { ToolSpec } from '../types.js';
import { toolSuccess, toolError, requireFields, withRunTracking, summaryGenerators } from '../shared/index.js';
import {
  recordArchDecision,
  RecordArchDecisionInput,
} from '../architect.js';
import {
  createProjectAdr,
  AdrInput,
} from '../../architectAdrs.js';
import {
  createPolicy,
  CreatePolicyInput,
  listPolicies,
  ListPoliciesInput,
  getPolicy,
  GetPolicyInput,
  compileOversight,
  CompileOversightInput,
  isPolicyError,
} from '../policy.js';

// ============================================================================
// Helper: Normalize parameter keys
// ============================================================================

function normalizeParams<T>(
  args: Record<string, unknown>,
  expectedKeys: string[]
): T {
  const result: Record<string, unknown> = {};
  const keyMap = new Map<string, string>();

  // Common snake_case -> camelCase mappings
  const snakeToCamel: Record<string, string> = {
    'project_id': 'projectId',
    'epic_id': 'epicId',
    'issue_id': 'issueId',
  };

  // Build a lowercase -> expected key map
  for (const key of expectedKeys) {
    keyMap.set(key.toLowerCase(), key);
  }

  // Process each input key
  for (const [inputKey, value] of Object.entries(args)) {
    // Clean the key: remove suffixes like "(summary)", trim whitespace
    let cleanKey = inputKey
      .replace(/\s*\([^)]*\)\s*/g, '') // Remove (summary), (optional), etc.
      .trim();

    // Apply snake_case -> camelCase transformation if applicable
    if (snakeToCamel[cleanKey]) {
      cleanKey = snakeToCamel[cleanKey];
    }

    // Try exact match first
    if (expectedKeys.includes(cleanKey)) {
      result[cleanKey] = value;
      continue;
    }

    // Try case-insensitive match
    const lowerKey = cleanKey.toLowerCase();
    if (keyMap.has(lowerKey)) {
      result[keyMap.get(lowerKey)!] = value;
      continue;
    }

    // Keep unrecognized keys as-is (might be optional params)
    result[inputKey] = value;
  }

  return result as T;
}

// ============================================================================
// Record Arch Decision Tool
// ============================================================================

export const architectRecordArchDecisionTool: ToolSpec = {
  definition: {
    name: 'architect_record_arch_decision',
    description: 'Record an architectural decision (ADR) for a project. Automatically saves a markdown file to .decibel/architect/adrs/ with Change, Rationale, and Impact sections. No separate file writing needed.',
    annotations: {
      title: 'Record Arch Decision',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Optional project identifier. Uses default project if not specified.',
        },
        change: {
          type: 'string',
          description: 'Description of the architectural change',
        },
        rationale: {
          type: 'string',
          description: 'The reasoning behind this architectural decision',
        },
        impact: {
          type: 'string',
          description: 'Optional description of the expected impact',
        },
      },
      required: ['change', 'rationale'],
    },
  },
  handler: withRunTracking(
    async (args) => {
      try {
        const rawInput = args as Record<string, unknown>;
        const input = normalizeParams<RecordArchDecisionInput>(
          rawInput,
          ['projectId', 'project_id', 'change', 'rationale', 'impact']
        );
        // Support project_id as alias for projectId
        if (!input.projectId && rawInput.project_id) {
          input.projectId = rawInput.project_id as string;
        }
        requireFields(input, 'change', 'rationale');
        const result = await recordArchDecision(input);
        if ('error' in result) {
          return toolError(JSON.stringify(result, null, 2));
        }
        return toolSuccess(result);
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    },
    {
      toolName: 'architect_record_arch_decision',
      getProjectId: (args) => (args.projectId as string | undefined) || (args.project_id as string | undefined),
      getSummary: summaryGenerators.adr,
    }
  ),
};

// ============================================================================
// Create ADR Tool
// ============================================================================

export const architectCreateAdrTool: ToolSpec = {
  definition: {
    name: 'architect_createAdr',
    description: 'Create a new Architecture Decision Record (ADR) for a project. Writes a YAML file to .decibel/architect/adrs/ with auto-generated ID (ADR-NNNN).',
    annotations: {
      title: 'Create ADR',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'The project identifier (e.g., "my-project")',
        },
        title: {
          type: 'string',
          description: 'ADR title (e.g., "Use PostgreSQL for persistence")',
        },
        context: {
          type: 'string',
          description: 'The context and background for this decision',
        },
        decision: {
          type: 'string',
          description: 'The decision that was made',
        },
        consequences: {
          type: 'string',
          description: 'The consequences of this decision (positive and negative)',
        },
        relatedIssues: {
          type: 'array',
          items: { type: 'string' },
          description: 'Related issue IDs (e.g., ["ISS-0001", "ISS-0003"])',
        },
        relatedEpics: {
          type: 'array',
          items: { type: 'string' },
          description: 'Related epic IDs (e.g., ["EPIC-0002"])',
        },
      },
      required: ['projectId', 'title', 'context', 'decision', 'consequences'],
    },
  },
  handler: withRunTracking(
    async (args) => {
      try {
        // Normalize parameter keys to handle case variations
        const input = normalizeParams<AdrInput>(
          args as Record<string, unknown>,
          ['projectId', 'title', 'context', 'decision', 'consequences', 'relatedIssues', 'relatedEpics']
        );
        requireFields(input, 'projectId', 'title', 'context', 'decision', 'consequences');
        const result = await createProjectAdr(input);
        return toolSuccess(result);
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    },
    {
      toolName: 'architect_createAdr',
      getSummary: summaryGenerators.adr,
    }
  ),
};

// ============================================================================
// Create Policy Tool
// ============================================================================

export const architectCreatePolicyTool: ToolSpec = {
  definition: {
    name: 'architect_createPolicy',
    description: 'Create a new policy atom. Policies define rules and constraints for code, architecture, and processes.',
    annotations: {
      title: 'Create Policy',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Optional project identifier. Uses default project if not specified.',
        },
        title: {
          type: 'string',
          description: 'Policy title (e.g., "No Direct Database Access")',
        },
        rationale: {
          type: 'string',
          description: 'Why this policy exists',
        },
        scope: {
          type: 'string',
          description: 'Where this policy applies (e.g., "api/*", "global")',
        },
        rules: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string', description: 'Unique rule identifier' },
              description: { type: 'string', description: 'What this rule enforces' },
              check: { type: 'string', description: 'Optional automated check command' },
            },
            required: ['key', 'description'],
          },
          description: 'List of rules this policy enforces',
        },
        severity: {
          type: 'string',
          enum: ['critical', 'high', 'medium', 'low'],
          description: 'How severe violations are',
        },
        enforcement_hooks: {
          type: 'array',
          items: { type: 'string' },
          description: 'Hooks that enforce this policy (e.g., "pre-commit", "ci")',
        },
        exceptions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              reason: { type: 'string' },
              scope: { type: 'string' },
              expires: { type: 'string' },
              approved_by: { type: 'string' },
            },
            required: ['reason'],
          },
          description: 'Known exceptions to this policy',
        },
        examples: {
          type: 'object',
          properties: {
            compliant: { type: 'array', items: { type: 'string' } },
            violation: { type: 'array', items: { type: 'string' } },
          },
          description: 'Examples of compliant and violating code/behavior',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags for categorization',
        },
      },
      required: ['title', 'rationale', 'scope', 'rules', 'severity'],
    },
  },
  handler: async (args) => {
    try {
      const input = args as CreatePolicyInput;
      requireFields(input, 'title', 'rationale', 'scope', 'rules', 'severity');
      const result = await createPolicy(input);
      if (isPolicyError(result)) {
        return toolError(JSON.stringify(result, null, 2));
      }
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// List Policies Tool
// ============================================================================

export const architectListPoliciesTool: ToolSpec = {
  definition: {
    name: 'architect_listPolicies',
    description: 'List all policies for a project, optionally filtered by severity or tags.',
    annotations: {
      title: 'List Policies',
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
        severity: {
          type: 'string',
          enum: ['critical', 'high', 'medium', 'low'],
          description: 'Filter by severity',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter by tags (matches any)',
        },
      },
    },
  },
  handler: async (args) => {
    try {
      const input = args as ListPoliciesInput;
      const result = await listPolicies(input);
      if (isPolicyError(result)) {
        return toolError(JSON.stringify(result, null, 2));
      }
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// Get Policy Tool
// ============================================================================

export const architectGetPolicyTool: ToolSpec = {
  definition: {
    name: 'architect_getPolicy',
    description: 'Get details of a specific policy by ID.',
    annotations: {
      title: 'Get Policy',
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
        policy_id: {
          type: 'string',
          description: 'Policy ID (e.g., "POL-0001")',
        },
      },
      required: ['policy_id'],
    },
  },
  handler: async (args) => {
    try {
      const input = args as GetPolicyInput;
      requireFields(input, 'policy_id');
      const result = await getPolicy(input);
      if (isPolicyError(result)) {
        return toolError(JSON.stringify(result, null, 2));
      }
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// Compile Oversight Tool
// ============================================================================

export const architectCompileOversightTool: ToolSpec = {
  definition: {
    name: 'architect_compileOversight',
    description: 'Compile all policies into documentation (policies.md and/or compiled.json).',
    annotations: {
      title: 'Compile Oversight',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Optional project identifier. Uses default project if not specified.',
        },
        output_format: {
          type: 'string',
          enum: ['markdown', 'json', 'both'],
          description: 'Output format (default: markdown)',
        },
        include_inherited: {
          type: 'boolean',
          description: 'Include policies from extended profiles',
        },
      },
    },
  },
  handler: async (args) => {
    try {
      const input = args as CompileOversightInput;
      const result = await compileOversight(input);
      if (isPolicyError(result)) {
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

export const architectTools: ToolSpec[] = [
  architectRecordArchDecisionTool,
  architectCreateAdrTool,
  architectCreatePolicyTool,
  architectListPoliciesTool,
  architectGetPolicyTool,
  architectCompileOversightTool,
];
