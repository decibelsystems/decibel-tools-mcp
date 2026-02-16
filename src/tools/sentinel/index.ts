// ============================================================================
// Sentinel Domain Tools
// ============================================================================
// Tools for issue tracking, epic management, data inspection, and test specs.
// ============================================================================

import { ToolSpec } from '../types.js';
import { toolSuccess, toolError, requireFields, requireOneOf, withRunTracking, summaryGenerators } from '../shared/index.js';
import {
  createIssue,
  CreateIssueInput,
  Severity,
  closeIssue,
  CloseIssueInput,
  IssueStatus,
  listRepoIssues,
  ListRepoIssuesInput,
  logEpic,
  LogEpicInput,
  Priority,
  EpicStatus,
  listEpics,
  ListEpicsInput,
  getEpic,
  GetEpicInput,
  getEpicIssues,
  GetEpicIssuesInput,
  resolveEpic,
  ResolveEpicInput,
  isProjectResolutionError,
} from '../sentinel.js';
import {
  scanData as scanDataTS,
  ScanDataInput as ScanDataTSInput,
  FlagCategory as DataInspectorFlag,
} from '../data-inspector.js';
import {
  listIssuesForProject,
  getIssueById,
  createIssue as createSentinelIssue,
  CreateIssueInput as CreateSentinelIssueInput,
  updateIssue as updateSentinelIssue,
  UpdateIssueInput as UpdateSentinelIssueInput,
  IssueStatus as SentinelIssueStatus,
  IssuePriority as SentinelIssuePriority,
  filterByStatus,
  filterByEpicId,
} from '../../sentinelIssues.js';
import { resolveProjectPaths } from '../../projectRegistry.js';
import {
  createTestSpec,
  CreateTestSpecInput,
  listTestSpecs,
  ListTestSpecsInput,
  compileTests,
  CompileTestsInput,
  auditPolicies,
  AuditPoliciesInput,
  isTestSpecError,
} from '../testSpec.js';

// ============================================================================
// Types
// ============================================================================

type FlagCategory = 'orphans' | 'stale' | 'invalid' | 'packages';

// ============================================================================
// Issue Tools (Markdown-based)
// ============================================================================

export const sentinelCreateIssueTool: ToolSpec = {
  definition: {
    name: 'sentinel_create_issue',
    description: 'Create a new issue for a project. Automatically saves a markdown file to .decibel/sentinel/issues/ with severity and status tracking. Can optionally link to an epic. No separate file writing needed.',
    annotations: {
      title: 'Create Issue',
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
        severity: {
          type: 'string',
          enum: ['low', 'med', 'high', 'critical'],
          description: 'The severity level of the issue',
        },
        title: {
          type: 'string',
          description: 'The issue title',
        },
        details: {
          type: 'string',
          description: 'Detailed description of the issue',
        },
        epic_id: {
          type: 'string',
          description: 'Optional parent epic ID (e.g., "EPIC-0001")',
        },
      },
      required: ['severity', 'title', 'details'],
    },
  },
  handler: withRunTracking(
    async (args) => {
      try {
        requireFields(args, 'severity', 'title', 'details');
        const validSeverities: Severity[] = ['low', 'med', 'high', 'critical'];
        requireOneOf(args.severity, 'severity', validSeverities);

        const result = await createIssue(args as CreateIssueInput);

        if ('error' in result && result.error === 'EPIC_NOT_FOUND') {
          return toolError(JSON.stringify(result));
        }

        return toolSuccess(result);
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    },
    {
      toolName: 'sentinel_create_issue',
      getSummary: summaryGenerators.issue,
    }
  ),
};

export const sentinelCloseIssueTool: ToolSpec = {
  definition: {
    name: 'sentinel_close_issue',
    description: 'Close an existing issue. Updates the status to closed and adds a closed_at timestamp. Can optionally add a resolution note.',
    annotations: {
      title: 'Close Issue',
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
        issue_id: {
          type: 'string',
          description: 'The issue filename or partial match (e.g., "update-readme" or full filename)',
        },
        resolution: {
          type: 'string',
          description: 'Optional resolution note explaining how/why the issue was closed',
        },
        status: {
          type: 'string',
          enum: ['closed', 'wontfix'],
          description: 'The closing status (default: closed)',
        },
      },
      required: ['issue_id'],
    },
  },
  handler: withRunTracking(
    async (args) => {
      try {
        requireFields(args, 'issue_id');
        if (args.status) {
          const validStatuses: Array<'closed' | 'wontfix'> = ['closed', 'wontfix'];
          requireOneOf(args.status, 'status', validStatuses);
        }

        const result = await closeIssue(args as CloseIssueInput);

        if ('error' in result && result.error === 'ISSUE_NOT_FOUND') {
          return toolError(JSON.stringify(result));
        }

        return toolSuccess(result);
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    },
    {
      toolName: 'sentinel_close_issue',
      getSummary: summaryGenerators.closeIssue,
    }
  ),
};

export const sentinelListRepoIssuesTool: ToolSpec = {
  definition: {
    name: 'sentinel_list_repo_issues',
    description: 'List all issues for a specific project, optionally filtered by status.',
    annotations: {
      title: 'List Issues',
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
        status: {
          type: 'string',
          enum: ['open', 'closed', 'wontfix'],
          description: 'Optional status filter',
        },
      },
    },
  },
  handler: async (args) => {
    try {
      if (args.status) {
        const validStatuses: IssueStatus[] = ['open', 'closed', 'wontfix'];
        requireOneOf(args.status, 'status', validStatuses);
      }

      const result = await listRepoIssues(args as ListRepoIssuesInput);
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// Epic Tools
// ============================================================================

export const sentinelLogEpicTool: ToolSpec = {
  definition: {
    name: 'sentinel_log_epic',
    description: 'Create a new Sentinel epic (large feature) record. Automatically saves to .decibel/sentinel/epics/. Returns the epic_id and file path. No separate file writing needed.',
    annotations: {
      title: 'Log Epic',
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
          description: 'Epic title (e.g., "MCP Server: Sentinel Epic Support")',
        },
        summary: {
          type: 'string',
          description: 'Brief summary of what this epic is about',
        },
        motivation: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of motivation statements (why this epic exists)',
        },
        outcomes: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of desired outcomes',
        },
        acceptance_criteria: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of acceptance criteria for "done"',
        },
        priority: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'critical'],
          default: 'medium',
          description: 'Priority level',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags for categorization',
        },
        owner: {
          type: 'string',
          description: 'Owner of the epic',
        },
        squad: {
          type: 'string',
          description: 'Squad/team responsible',
        },
      },
      required: ['title', 'summary'],
    },
  },
  handler: withRunTracking(
    async (args) => {
      try {
        requireFields(args, 'title', 'summary');
        if (args.priority) {
          const validPriorities: Priority[] = ['low', 'medium', 'high', 'critical'];
          requireOneOf(args.priority, 'priority', validPriorities);
        }

        const result = await logEpic(args as LogEpicInput);
        return toolSuccess(result);
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    },
    {
      toolName: 'sentinel_log_epic',
      getSummary: summaryGenerators.epic,
    }
  ),
};

export const sentinelListEpicsTool: ToolSpec = {
  definition: {
    name: 'sentinel_list_epics',
    description: 'List all epics, optionally filtered by status, priority, or tags.',
    annotations: {
      title: 'List Epics',
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
        status: {
          type: 'string',
          enum: ['planned', 'in_progress', 'shipped', 'on_hold', 'cancelled'],
          description: 'Filter by status',
        },
        priority: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'critical'],
          description: 'Filter by priority',
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
      if (args.status) {
        const validStatuses: EpicStatus[] = ['planned', 'in_progress', 'shipped', 'on_hold', 'cancelled'];
        requireOneOf(args.status, 'status', validStatuses);
      }
      if (args.priority) {
        const validPriorities: Priority[] = ['low', 'medium', 'high', 'critical'];
        requireOneOf(args.priority, 'priority', validPriorities);
      }

      const result = await listEpics(args as ListEpicsInput);
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

export const sentinelReadEpicTool: ToolSpec = {
  definition: {
    name: 'sentinel_read_epic',
    description: 'Read details of a specific epic by ID.',
    annotations: {
      title: 'Read Epic',
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
        epic_id: {
          type: 'string',
          description: 'Epic ID (e.g., "EPIC-0001")',
        },
      },
      required: ['epic_id'],
    },
  },
  handler: async (args) => {
    try {
      requireFields(args, 'epic_id');
      const result = await getEpic(args as GetEpicInput);

      if (isProjectResolutionError(result)) {
        return toolError(JSON.stringify(result));
      }
      if (result.error) {
        return toolError(result.error);
      }

      return toolSuccess(result.epic);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

export const sentinelListEpicIssuesTool: ToolSpec = {
  definition: {
    name: 'sentinel_list_epic_issues',
    description: 'List all issues linked to a specific epic.',
    annotations: {
      title: 'List Epic Issues',
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
        epic_id: {
          type: 'string',
          description: 'Epic ID (e.g., "EPIC-0001")',
        },
      },
      required: ['epic_id'],
    },
  },
  handler: async (args) => {
    try {
      requireFields(args, 'epic_id');
      const result = await getEpicIssues(args as GetEpicIssuesInput);
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

export const sentinelResolveEpicTool: ToolSpec = {
  definition: {
    name: 'sentinel_resolve_epic',
    description: 'Resolve a fuzzy epic name/keyword into one or more matching epics. Use this to find the correct epic_id before creating issues.',
    annotations: {
      title: 'Resolve Epic',
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
        query: {
          type: 'string',
          description: 'Search query (epic ID, title, or keywords)',
        },
        limit: {
          type: 'integer',
          default: 5,
          description: 'Maximum number of matches to return',
        },
      },
      required: ['query'],
    },
  },
  handler: async (args) => {
    try {
      requireFields(args, 'query');
      const result = await resolveEpic(args as ResolveEpicInput);
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// Data Inspector Tools
// ============================================================================

export const sentinelScanTool: ToolSpec = {
  definition: {
    name: 'sentinel_scan',
    description: 'Scan project data (issues, epics, ADRs) for validation, orphans, and stale items. Use scope "data" for data inspection, "runtime" for runtime health (not yet implemented), or "all" for both.',
    annotations: {
      title: 'Scan Project Data',
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
        scope: {
          type: 'string',
          enum: ['runtime', 'data', 'all'],
          default: 'data',
          description: 'Scan scope: "runtime" for runtime/log/health, "data" for .decibel project data, "all" for both',
        },
        validate: {
          type: 'boolean',
          default: false,
          description: 'Run schema and referential integrity validation',
        },
        flag: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['orphans', 'stale', 'invalid', 'packages'],
          },
          description: 'Categories to flag in output: orphans (broken references), stale (old items), invalid (schema errors), packages (package health)',
        },
        days: {
          type: 'integer',
          default: 21,
          description: 'Threshold in days for stale detection (default: 21)',
        },
      },
    },
  },
  handler: async (args) => {
    try {
      const validScopes = ['runtime', 'data', 'all'];
      const scope = (args.scope || 'data') as 'runtime' | 'data' | 'all';
      requireOneOf(scope, 'scope', validScopes);

      // Resolve projectId — falls back to default project if not specified
      let projectId = args.projectId as string | undefined;
      if (!projectId) {
        try {
          const resolved = resolveProjectPaths();
          projectId = resolved.id;
        } catch {
          // Let scanDataTS handle it — it has its own cwd fallback
        }
      }

      // Use TypeScript backend
      const result = await scanDataTS({
        projectId,
        scope,
        validate: args.validate ?? false,
        flag: (args.flag as DataInspectorFlag[]) || ['orphans', 'stale', 'invalid'],
        days: args.days || 21,
      });

      if (result.error) {
        return toolError(result.error);
      }

      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

export const sentinelScanDataTool: ToolSpec = {
  definition: {
    name: 'sentinel_scanData',
    description: 'Scan project data using the Python Sentinel Data Inspector. Resolves project by ID and shells out to Python for inspection logic.',
    annotations: {
      title: 'Scan Data (Python)',
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
        validate: {
          type: 'boolean',
          default: false,
          description: 'Run schema and referential integrity validation',
        },
        flags: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['orphans', 'stale', 'invalid', 'packages'],
          },
          default: [],
          description: 'Categories to flag: orphans (broken references), stale (old items), invalid (schema errors), packages (package health)',
        },
        days: {
          type: 'integer',
          default: 21,
          description: 'Threshold in days for stale detection (default: 21)',
        },
      },
    },
  },
  handler: async (args) => {
    try {
      // Resolve projectId — falls back to default project if not specified
      let projectId = args.projectId as string | undefined;
      if (!projectId) {
        try {
          const resolved = resolveProjectPaths();
          projectId = resolved.id;
        } catch {
          // Let scanDataTS handle it — it has its own cwd fallback
        }
      }

      // Validate flag categories if provided
      if (args.flags && args.flags.length > 0) {
        const validFlags: DataInspectorFlag[] = ['orphans', 'stale', 'invalid'];
        for (const f of args.flags) {
          requireOneOf(f, 'flag', validFlags);
        }
      }

      const result = await scanDataTS({
        projectId,
        scope: 'data',
        validate: args.validate ?? false,
        flag: (args.flags as DataInspectorFlag[]) ?? [],
        days: args.days ?? 21,
      });

      if (result.error) {
        return toolError(result.error);
      }

      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// YAML Issue Tools (projectId-based)
// ============================================================================

export const sentinelListIssuesTool: ToolSpec = {
  definition: {
    name: 'sentinel_listIssues',
    description: 'List issues for a project from .decibel/sentinel/issues/*.yml files. Returns issue metadata including id, title, status, priority, epicId, and tags.',
    annotations: {
      title: 'List Issues (YAML)',
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
        status: {
          type: 'string',
          enum: ['open', 'in_progress', 'done', 'blocked'],
          description: 'Optional filter by issue status',
        },
        epicId: {
          type: 'string',
          description: 'Optional filter by epic ID (e.g., "EPIC-0001")',
        },
      },
    },
  },
  handler: async (args) => {
    try {
      // Resolve projectId — falls back to default project if not specified
      const resolved = resolveProjectPaths(args.projectId as string | undefined);
      const projectId = resolved.id;

      if (args.status) {
        const validStatuses: SentinelIssueStatus[] = ['open', 'in_progress', 'done', 'blocked'];
        requireOneOf(args.status, 'status', validStatuses);
      }

      let issues = await listIssuesForProject(projectId);

      // Apply filters
      if (args.status) {
        issues = filterByStatus(issues, args.status);
      }
      if (args.epicId) {
        issues = filterByEpicId(issues, args.epicId);
      }

      // Return simplified issue list
      const result = issues.map((issue) => ({
        id: issue.id,
        title: issue.title,
        status: issue.status,
        priority: issue.priority,
        epicId: issue.epicId,
        tags: issue.tags,
        created_at: issue.created_at,
        updated_at: issue.updated_at,
      }));

      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

export const sentinelCreateIssueTool2: ToolSpec = {
  definition: {
    name: 'sentinel_createIssue',
    description: 'Create a new issue for a project. Writes a YAML file to .decibel/sentinel/issues/ with auto-generated ID (ISS-NNNN).',
    annotations: {
      title: 'Create Issue (YAML)',
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
          description: 'Issue title',
        },
        description: {
          type: 'string',
          description: 'Detailed description of the issue',
        },
        epicId: {
          type: 'string',
          description: 'Optional parent epic ID (e.g., "EPIC-0001")',
        },
        priority: {
          type: 'string',
          enum: ['low', 'medium', 'high'],
          default: 'medium',
          description: 'Issue priority level',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags for categorization',
        },
      },
      required: ['title'],
    },
  },
  handler: withRunTracking(
    async (args) => {
      try {
        requireFields(args, 'title');

        // Resolve projectId — falls back to default project if not specified
        const resolved = resolveProjectPaths(args.projectId as string | undefined);

        if (args.priority) {
          const validPriorities: SentinelIssuePriority[] = ['low', 'medium', 'high'];
          requireOneOf(args.priority, 'priority', validPriorities);
        }

        const result = await createSentinelIssue({ ...args, projectId: resolved.id } as CreateSentinelIssueInput);
        return toolSuccess(result);
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    },
    {
      toolName: 'sentinel_createIssue',
      getSummary: summaryGenerators.issue,
    }
  ),
};

// ============================================================================
// Get Issue Tool (YAML-based)
// ============================================================================

export const sentinelReadIssueTool: ToolSpec = {
  definition: {
    name: 'sentinel_read_issue',
    description: 'Read a single issue by ID (e.g., "ISS-0005") with full content including description, tags, and metadata.',
    annotations: {
      title: 'Read Issue',
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
        issue_id: {
          type: 'string',
          description: 'Issue ID (e.g., "ISS-0005")',
        },
      },
      required: ['issue_id'],
    },
  },
  handler: async (args) => {
    try {
      requireFields(args, 'issue_id');
      // Resolve projectId — falls back to default project if not specified
      const resolved = resolveProjectPaths(args.projectId as string | undefined);
      const projectId = resolved.id;
      const issue = await getIssueById(projectId, args.issue_id as string);
      if (!issue) {
        return toolError(`Issue ${args.issue_id} not found in project ${projectId}`);
      }
      return toolSuccess(issue);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// Update Issue Tool (YAML-based)
// ============================================================================

export const sentinelUpdateIssueTool: ToolSpec = {
  definition: {
    name: 'sentinel_updateIssue',
    description: 'Update an existing issue. Can change status (open/in_progress/done/blocked), priority (low/medium/high), add tags, and append timestamped notes. Returns the updated issue with a list of changes made.',
    annotations: {
      title: 'Update Issue',
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
        issue_id: {
          type: 'string',
          description: 'Issue ID (e.g., "ISS-0048")',
        },
        status: {
          type: 'string',
          enum: ['open', 'in_progress', 'done', 'blocked'],
          description: 'New status for the issue',
        },
        priority: {
          type: 'string',
          enum: ['low', 'medium', 'high'],
          description: 'New priority for the issue',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags to add (merged with existing, not replaced)',
        },
        note: {
          type: 'string',
          description: 'Note to append to the description (auto-timestamped)',
        },
      },
      required: ['issue_id'],
    },
  },
  handler: async (args) => {
    try {
      const rawInput = args as Record<string, unknown>;
      const issueId = (rawInput.issue_id ?? rawInput.issueId) as string;
      requireFields({ issue_id: issueId }, 'issue_id');
      // Resolve projectId — falls back to default project if not specified
      const rawProjectId = (rawInput.projectId ?? rawInput.project_id) as string | undefined;
      const resolved = resolveProjectPaths(rawProjectId || undefined);
      const projectId = resolved.id;

      const result = await updateSentinelIssue({
        projectId,
        issueId,
        status: rawInput.status as UpdateSentinelIssueInput['status'],
        priority: rawInput.priority as UpdateSentinelIssueInput['priority'],
        tags: rawInput.tags as string[] | undefined,
        note: rawInput.note as string | undefined,
      });
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// Test Spec Tools
// ============================================================================

export const sentinelCreateTestSpecTool: ToolSpec = {
  definition: {
    name: 'sentinel_createTestSpec',
    description: 'Create a new test specification atom. Test specs define test cases and requirements.',
    annotations: {
      title: 'Create Test Spec',
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
          description: 'Test spec title (e.g., "User Authentication Flow")',
        },
        description: {
          type: 'string',
          description: 'What this test spec covers',
        },
        type: {
          type: 'string',
          enum: ['unit', 'integration', 'e2e', 'contract', 'property', 'manual'],
          description: 'Type of test',
        },
        priority: {
          type: 'string',
          enum: ['critical', 'high', 'medium', 'low'],
          description: 'Test priority (default: medium)',
        },
        policy_refs: {
          type: 'array',
          items: { type: 'string' },
          description: 'Policy IDs this test verifies (e.g., ["POL-0001"])',
        },
        test_cases: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Test case name' },
              description: { type: 'string' },
              steps: { type: 'array', items: { type: 'string' } },
              expected: { type: 'string', description: 'Expected outcome' },
              tags: { type: 'array', items: { type: 'string' } },
            },
            required: ['name', 'expected'],
          },
          description: 'Test cases in this spec',
        },
        setup: {
          type: 'string',
          description: 'Setup instructions for the tests',
        },
        teardown: {
          type: 'string',
          description: 'Teardown instructions for the tests',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags for categorization',
        },
      },
      required: ['title', 'description', 'type', 'test_cases'],
    },
  },
  handler: async (args) => {
    try {
      requireFields(args, 'title', 'description', 'type', 'test_cases');
      const result = await createTestSpec(args as CreateTestSpecInput);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        isError: isTestSpecError(result),
      };
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

export const sentinelListTestSpecsTool: ToolSpec = {
  definition: {
    name: 'sentinel_listTestSpecs',
    description: 'List all test specifications for a project.',
    annotations: {
      title: 'List Test Specs',
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
        type: {
          type: 'string',
          enum: ['unit', 'integration', 'e2e', 'contract', 'property', 'manual'],
          description: 'Filter by test type',
        },
        priority: {
          type: 'string',
          enum: ['critical', 'high', 'medium', 'low'],
          description: 'Filter by priority',
        },
        policy_ref: {
          type: 'string',
          description: 'Filter by policy reference',
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
      const result = await listTestSpecs(args as ListTestSpecsInput);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        isError: isTestSpecError(result),
      };
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

export const sentinelCompileTestsTool: ToolSpec = {
  definition: {
    name: 'sentinel_compileTests',
    description: 'Compile all test specifications into documentation (manifest.md and/or manifest.json).',
    annotations: {
      title: 'Compile Tests',
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
        include_deprecated: {
          type: 'boolean',
          description: 'Include deprecated test specs',
        },
      },
    },
  },
  handler: async (args) => {
    try {
      const result = await compileTests(args as CompileTestsInput);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        isError: isTestSpecError(result),
      };
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

export const sentinelAuditPoliciesTool: ToolSpec = {
  definition: {
    name: 'sentinel_auditPolicies',
    description: 'Audit policy compliance. Checks documentation freshness and runs enforcement checks.',
    annotations: {
      title: 'Audit Policies',
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
        check_freshness: {
          type: 'boolean',
          description: 'Check if compiled docs are stale (default: true)',
        },
        run_enforcement: {
          type: 'boolean',
          description: 'Run enforcement checks (future feature)',
        },
      },
    },
  },
  handler: async (args) => {
    try {
      const result = await auditPolicies(args as AuditPoliciesInput);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        isError: isTestSpecError(result),
      };
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// Domain Export
// ============================================================================

export const sentinelTools: ToolSpec[] = [
  // Issue tools (markdown-based)
  sentinelCreateIssueTool,
  sentinelCloseIssueTool,
  sentinelListRepoIssuesTool,
  // Epic tools
  sentinelLogEpicTool,
  sentinelListEpicsTool,
  sentinelReadEpicTool,
  sentinelListEpicIssuesTool,
  sentinelResolveEpicTool,
  // Data inspector tools
  sentinelScanTool,
  sentinelScanDataTool,
  // YAML issue tools
  sentinelListIssuesTool,
  sentinelCreateIssueTool2,
  sentinelReadIssueTool,
  sentinelUpdateIssueTool,
  // Test spec tools
  sentinelCreateTestSpecTool,
  sentinelListTestSpecsTool,
  sentinelCompileTestsTool,
  sentinelAuditPoliciesTool,
];
