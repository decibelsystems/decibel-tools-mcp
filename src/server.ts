#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { getConfig, log } from './config.js';
import { recordDesignDecision, RecordDesignDecisionInput } from './tools/designer.js';
import { recordArchDecision, RecordArchDecisionInput } from './tools/architect.js';
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
} from './tools/roadmap.js';
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
} from './tools/sentinel.js';
import {
  scanData,
  ScanDataInput,
  ScanScope,
  FlagCategory,
  formatScanOutput,
} from './tools/data-inspector.js';
import { nextActions, NextActionsInput } from './tools/oracle.js';
import {
  appendLearning,
  AppendLearningInput,
  LearningCategory,
  listLearnings,
  ListLearningsInput,
} from './tools/learnings.js';
import {
  logFriction,
  LogFrictionInput,
  FrictionFrequency,
  FrictionImpact,
  FrictionStatus,
  listFriction,
  ListFrictionInput,
  resolveFriction,
  ResolveFrictionInput,
  bumpFriction,
  BumpFrictionInput,
} from './tools/friction.js';
import {
  scanData as scanDataPython,
  ScanDataInput as ScanDataPythonInput,
  ScanDataFlag,
  isScanDataError,
} from './tools/sentinel-scan-data.js';
import {
  listIssuesForProject,
  createIssue as createSentinelIssue,
  CreateIssueInput as CreateSentinelIssueInput,
  IssueStatus as SentinelIssueStatus,
  IssuePriority as SentinelIssuePriority,
  filterByStatus,
  filterByEpicId,
} from './sentinelIssues.js';
import {
  createProjectAdr,
  AdrInput,
} from './architectAdrs.js';

const config = getConfig();

log(`Starting Decibel MCP Server`);
log(`Environment: ${config.env}`);
log(`Organization: ${config.org}`);
log(`Root Directory: ${config.rootDir}`);

const server = new Server(
  {
    name: 'decibel-tools-mcp',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      // Designer tools
      {
        name: 'designer_record_design_decision',
        description: 'Record a design decision for a project. Creates a markdown file with frontmatter containing the decision details.',
        inputSchema: {
          type: 'object',
          properties: {
            project_id: {
              type: 'string',
              description: 'The project identifier',
            },
            area: {
              type: 'string',
              description: 'The area or domain of the design decision (e.g., "UI", "API", "Database")',
            },
            summary: {
              type: 'string',
              description: 'A brief summary of the design decision',
            },
            details: {
              type: 'string',
              description: 'Optional detailed explanation of the design decision',
            },
          },
          required: ['project_id', 'area', 'summary'],
        },
      },

      // Architect tools
      {
        name: 'architect_record_arch_decision',
        description: 'Record an architectural decision (ADR) for a system. Creates a markdown file with Change, Rationale, and Impact sections.',
        inputSchema: {
          type: 'object',
          properties: {
            system_id: {
              type: 'string',
              description: 'The system identifier',
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
          required: ['system_id', 'change', 'rationale'],
        },
      },

      // Sentinel tools - Issues
      {
        name: 'sentinel_create_issue',
        description: 'Create a new issue for a repository. Creates a markdown file with severity and status tracking. Can optionally link to an epic.',
        inputSchema: {
          type: 'object',
          properties: {
            repo: {
              type: 'string',
              description: 'The repository name',
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
          required: ['repo', 'severity', 'title', 'details'],
        },
      },
      {
        name: 'sentinel_close_issue',
        description: 'Close an existing issue. Updates the status to closed and adds a closed_at timestamp. Can optionally add a resolution note.',
        inputSchema: {
          type: 'object',
          properties: {
            repo: {
              type: 'string',
              description: 'The repository name',
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
          required: ['repo', 'issue_id'],
        },
      },
      {
        name: 'sentinel_list_repo_issues',
        description: 'List all issues for a specific repository, optionally filtered by status.',
        inputSchema: {
          type: 'object',
          properties: {
            repo: {
              type: 'string',
              description: 'The repository name',
            },
            status: {
              type: 'string',
              enum: ['open', 'closed', 'wontfix'],
              description: 'Optional status filter',
            },
          },
          required: ['repo'],
        },
      },

      // Sentinel tools - Epics
      {
        name: 'sentinel_log_epic',
        description: 'Create a new Sentinel epic (large feature) record. Returns the epic_id and file path.',
        inputSchema: {
          type: 'object',
          properties: {
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
      {
        name: 'sentinel_list_epics',
        description: 'List all epics, optionally filtered by status, priority, or tags.',
        inputSchema: {
          type: 'object',
          properties: {
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
      {
        name: 'sentinel_get_epic',
        description: 'Get details of a specific epic by ID.',
        inputSchema: {
          type: 'object',
          properties: {
            epic_id: {
              type: 'string',
              description: 'Epic ID (e.g., "EPIC-0001")',
            },
          },
          required: ['epic_id'],
        },
      },
      {
        name: 'sentinel_get_epic_issues',
        description: 'Get all issues linked to a specific epic.',
        inputSchema: {
          type: 'object',
          properties: {
            epic_id: {
              type: 'string',
              description: 'Epic ID (e.g., "EPIC-0001")',
            },
          },
          required: ['epic_id'],
        },
      },
      {
        name: 'sentinel_resolve_epic',
        description: 'Resolve a fuzzy epic name/keyword into one or more matching epics. Use this to find the correct epic_id before creating issues.',
        inputSchema: {
          type: 'object',
          properties: {
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

      // Roadmap tools
      {
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
      {
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
      {
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
      {
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
      {
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
      {
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

      // Sentinel tools - Data Inspector
      {
        name: 'sentinel_scan',
        description: 'Scan project data (issues, epics, ADRs) for validation, orphans, and stale items. Use scope "data" for data inspection, "runtime" for runtime health (not yet implemented), or "all" for both.',
        inputSchema: {
          type: 'object',
          properties: {
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
                enum: ['orphans', 'stale', 'invalid'],
              },
              description: 'Categories to flag in output: orphans (broken references), stale (old items), invalid (schema errors)',
            },
            days: {
              type: 'integer',
              default: 21,
              description: 'Threshold in days for stale detection (default: 21)',
            },
          },
        },
      },

      // Sentinel tools - Data Inspector (Python backend)
      {
        name: 'sentinel_scanData',
        description: 'Scan project data using the Python Sentinel Data Inspector. Resolves project by ID and shells out to Python for inspection logic.',
        inputSchema: {
          type: 'object',
          properties: {
            projectId: {
              type: 'string',
              description: 'The project identifier (e.g., "my-project")',
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
                enum: ['orphans', 'stale', 'invalid'],
              },
              default: [],
              description: 'Categories to flag: orphans (broken references), stale (old items), invalid (schema errors)',
            },
            days: {
              type: 'integer',
              default: 21,
              description: 'Threshold in days for stale detection (default: 21)',
            },
          },
          required: ['projectId'],
        },
      },

      // Sentinel tools - YAML Issues (projectId-based)
      {
        name: 'sentinel_listIssues',
        description: 'List issues for a project from .decibel/sentinel/issues/*.yml files. Returns issue metadata including id, title, status, priority, epicId, and tags.',
        inputSchema: {
          type: 'object',
          properties: {
            projectId: {
              type: 'string',
              description: 'The project identifier (e.g., "my-project")',
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
          required: ['projectId'],
        },
      },
      {
        name: 'sentinel_createIssue',
        description: 'Create a new issue for a project. Writes a YAML file to .decibel/sentinel/issues/ with auto-generated ID (ISS-NNNN).',
        inputSchema: {
          type: 'object',
          properties: {
            projectId: {
              type: 'string',
              description: 'The project identifier (e.g., "my-project")',
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
          required: ['projectId', 'title'],
        },
      },

      // Architect tools - Project ADRs (projectId-based)
      {
        name: 'architect_createAdr',
        description: 'Create a new Architecture Decision Record (ADR) for a project. Writes a YAML file to .decibel/architect/adrs/ with auto-generated ID (ADR-NNNN).',
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

      // Oracle tools
      {
        name: 'oracle_next_actions',
        description: 'Get recommended next actions for a project based on recent design decisions, architecture changes, and issues.',
        inputSchema: {
          type: 'object',
          properties: {
            project_id: {
              type: 'string',
              description: 'The project identifier to analyze',
            },
            focus: {
              type: 'string',
              description: 'Optional focus area to filter actions (e.g., "architect", "sentinel", or a keyword)',
            },
          },
          required: ['project_id'],
        },
      },

      // Learnings tools
      {
        name: 'learnings_append',
        description: 'Append a new entry to a project\'s technical learnings document. Creates a living document that accumulates lessons learned, gotchas, and insights over time.',
        inputSchema: {
          type: 'object',
          properties: {
            project_id: {
              type: 'string',
              description: 'The project identifier (creates learnings/{project_id}.md)',
            },
            category: {
              type: 'string',
              enum: ['debug', 'integration', 'architecture', 'tooling', 'process', 'other'],
              description: 'Category of the learning',
            },
            title: {
              type: 'string',
              description: 'Brief title for this learning entry',
            },
            content: {
              type: 'string',
              description: 'The learning content - what happened, what was learned, how to avoid/replicate',
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Optional tags for searchability (e.g., ["mcp", "auth", "tokens"])',
            },
          },
          required: ['project_id', 'category', 'title', 'content'],
        },
      },
      {
        name: 'learnings_list',
        description: 'List entries from a project\'s technical learnings document, optionally filtered by category.',
        inputSchema: {
          type: 'object',
          properties: {
            project_id: {
              type: 'string',
              description: 'The project identifier',
            },
            category: {
              type: 'string',
              enum: ['debug', 'integration', 'architecture', 'tooling', 'process', 'other'],
              description: 'Optional category filter',
            },
            limit: {
              type: 'integer',
              description: 'Maximum number of entries to return (most recent first)',
            },
          },
          required: ['project_id'],
        },
      },

      // Friction tools
      {
        name: 'friction_log',
        description: 'Log a persistent friction point or pain point. Both humans and agents can call this to track recurring issues that erode productivity. Signal strength increases when similar friction is logged multiple times.',
        inputSchema: {
          type: 'object',
          properties: {
            context: {
              type: 'string',
              description: 'Where the friction occurs (project name, repo, system, or workflow)',
            },
            description: {
              type: 'string',
              description: 'What the friction is - the pain point or recurring issue',
            },
            frequency: {
              type: 'string',
              enum: ['once', 'occasional', 'frequent', 'constant'],
              description: 'How often this friction is encountered (default: occasional)',
            },
            impact: {
              type: 'string',
              enum: ['low', 'medium', 'high', 'blocking'],
              description: 'How much this friction affects productivity (default: medium)',
            },
            source: {
              type: 'string',
              enum: ['human', 'agent'],
              description: 'Who is logging this friction (default: human)',
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Tags for categorization and searchability',
            },
            workaround: {
              type: 'string',
              description: 'Any current workaround being used',
            },
          },
          required: ['context', 'description'],
        },
      },
      {
        name: 'friction_list',
        description: 'List friction points, sorted by impact and signal count. High-signal friction should be prioritized for resolution.',
        inputSchema: {
          type: 'object',
          properties: {
            context: {
              type: 'string',
              description: 'Filter by context (project, repo, system)',
            },
            status: {
              type: 'string',
              enum: ['open', 'acknowledged', 'solving', 'resolved', 'wontfix'],
              description: 'Filter by status',
            },
            min_impact: {
              type: 'string',
              enum: ['low', 'medium', 'high', 'blocking'],
              description: 'Minimum impact level to include',
            },
            limit: {
              type: 'integer',
              description: 'Maximum number of results (default: 20)',
            },
          },
        },
      },
      {
        name: 'friction_resolve',
        description: 'Mark a friction point as resolved. Can include a resolution note and reference to the solution (issue, ADR, commit).',
        inputSchema: {
          type: 'object',
          properties: {
            friction_id: {
              type: 'string',
              description: 'The friction ID (filename or partial match)',
            },
            resolution: {
              type: 'string',
              description: 'How the friction was resolved',
            },
            solution_ref: {
              type: 'string',
              description: 'Optional reference to the solution (issue ID, ADR, commit SHA, PR)',
            },
            status: {
              type: 'string',
              enum: ['resolved', 'wontfix'],
              description: 'Resolution status (default: resolved)',
            },
          },
          required: ['friction_id', 'resolution'],
        },
      },
      {
        name: 'friction_bump',
        description: 'Bump the signal count on an existing friction point. Use when encountering the same friction again. Higher signal = higher priority.',
        inputSchema: {
          type: 'object',
          properties: {
            friction_id: {
              type: 'string',
              description: 'The friction ID (filename or partial match)',
            },
            source: {
              type: 'string',
              enum: ['human', 'agent'],
              description: 'Who is bumping this friction (default: human)',
            },
            note: {
              type: 'string',
              description: 'Optional note about this occurrence',
            },
          },
          required: ['friction_id'],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  log(`Tool called: ${name}`);
  log(`Arguments:`, JSON.stringify(args, null, 2));

  try {
    switch (name) {
      // Designer tools
      case 'designer_record_design_decision': {
        const input = args as unknown as RecordDesignDecisionInput;
        if (!input.project_id || !input.area || !input.summary) {
          throw new Error('Missing required fields: project_id, area, and summary are required');
        }
        const result = await recordDesignDecision(input);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      // Architect tools
      case 'architect_record_arch_decision': {
        const input = args as unknown as RecordArchDecisionInput;
        if (!input.system_id || !input.change || !input.rationale) {
          throw new Error('Missing required fields: system_id, change, and rationale are required');
        }
        const result = await recordArchDecision(input);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      // Roadmap tools
      case 'roadmap_get': {
        const input = args as unknown as GetRoadmapInput;
        if (!input.projectId) {
          throw new Error('Missing required field: projectId');
        }
        const result = await getRoadmap(input);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: 'error' in result,
        };
      }

      case 'roadmap_list': {
        const input = args as unknown as RoadmapListInput;
        if (!input.projectId) {
          throw new Error('Missing required field: projectId');
        }
        const result = await roadmapList(input);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: 'error' in result,
        };
      }

      case 'roadmap_getEpicContext': {
        const input = args as unknown as GetEpicContextInput;
        if (!input.projectId || !input.epicId) {
          throw new Error('Missing required fields: projectId and epicId are required');
        }
        const result = await getEpicContext(input);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: 'error' in result,
        };
      }

      case 'roadmap_getHealth': {
        const input = args as unknown as GetRoadmapHealthInput;
        if (!input.projectId) {
          throw new Error('Missing required field: projectId');
        }
        const result = await getRoadmapHealth(input);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: 'error' in result,
        };
      }

      case 'roadmap_linkEpic': {
        const input = args as unknown as LinkEpicInput;
        if (!input.projectId || !input.epicId) {
          throw new Error('Missing required fields: projectId and epicId are required');
        }
        const result = await linkEpicToRoadmap(input);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: result.status === 'error',
        };
      }

      case 'roadmap_init': {
        const input = args as unknown as RoadmapInitInput;
        if (!input.projectId) {
          throw new Error('Missing required field: projectId');
        }
        const result = await roadmapInit(input);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      // Sentinel tools - Issues
      case 'sentinel_create_issue': {
        const input = args as unknown as CreateIssueInput;
        if (!input.repo || !input.severity || !input.title || !input.details) {
          throw new Error('Missing required fields: repo, severity, title, and details are required');
        }
        const validSeverities: Severity[] = ['low', 'med', 'high', 'critical'];
        if (!validSeverities.includes(input.severity)) {
          throw new Error(`Invalid severity. Must be one of: ${validSeverities.join(', ')}`);
        }
        const result = await createIssue(input);

        if ('error' in result && result.error === 'EPIC_NOT_FOUND') {
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            isError: true,
          };
        }

        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'sentinel_close_issue': {
        const input = args as unknown as CloseIssueInput;
        if (!input.repo || !input.issue_id) {
          throw new Error('Missing required fields: repo and issue_id are required');
        }
        if (input.status) {
          const validStatuses: Array<'closed' | 'wontfix'> = ['closed', 'wontfix'];
          if (!validStatuses.includes(input.status)) {
            throw new Error(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
          }
        }
        const result = await closeIssue(input);

        if ('error' in result && result.error === 'ISSUE_NOT_FOUND') {
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            isError: true,
          };
        }

        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'sentinel_list_repo_issues': {
        const input = args as unknown as ListRepoIssuesInput;
        if (!input.repo) {
          throw new Error('Missing required field: repo');
        }
        if (input.status) {
          const validStatuses: IssueStatus[] = ['open', 'closed', 'wontfix'];
          if (!validStatuses.includes(input.status)) {
            throw new Error(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
          }
        }
        const result = await listRepoIssues(input);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      // Sentinel tools - Epics
      case 'sentinel_log_epic': {
        const input = args as unknown as LogEpicInput;
        if (!input.title || !input.summary) {
          throw new Error('Missing required fields: title and summary are required');
        }
        if (input.priority) {
          const validPriorities: Priority[] = ['low', 'medium', 'high', 'critical'];
          if (!validPriorities.includes(input.priority)) {
            throw new Error(`Invalid priority. Must be one of: ${validPriorities.join(', ')}`);
          }
        }
        const result = await logEpic(input);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'sentinel_list_epics': {
        const input = args as unknown as ListEpicsInput;
        if (input.status) {
          const validStatuses: EpicStatus[] = ['planned', 'in_progress', 'shipped', 'on_hold', 'cancelled'];
          if (!validStatuses.includes(input.status)) {
            throw new Error(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
          }
        }
        if (input.priority) {
          const validPriorities: Priority[] = ['low', 'medium', 'high', 'critical'];
          if (!validPriorities.includes(input.priority)) {
            throw new Error(`Invalid priority. Must be one of: ${validPriorities.join(', ')}`);
          }
        }
        const result = await listEpics(input);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'sentinel_get_epic': {
        const input = args as unknown as GetEpicInput;
        if (!input.epic_id) {
          throw new Error('Missing required field: epic_id');
        }
        const result = await getEpic(input);
        if (result.error) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: result.error }) }],
            isError: true,
          };
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(result.epic, null, 2) }],
        };
      }

      case 'sentinel_get_epic_issues': {
        const input = args as unknown as GetEpicIssuesInput;
        if (!input.epic_id) {
          throw new Error('Missing required field: epic_id');
        }
        const result = await getEpicIssues(input);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'sentinel_resolve_epic': {
        const input = args as unknown as ResolveEpicInput;
        if (!input.query) {
          throw new Error('Missing required field: query');
        }
        const result = await resolveEpic(input);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      // Sentinel tools - Data Inspector
      case 'sentinel_scan': {
        const input = args as unknown as ScanDataInput;

        // Default scope to 'data' if not provided
        const scope: ScanScope = input.scope || 'data';
        const validScopes: ScanScope[] = ['runtime', 'data', 'all'];
        if (!validScopes.includes(scope)) {
          throw new Error(`Invalid scope. Must be one of: ${validScopes.join(', ')}`);
        }

        // Validate flag categories
        if (input.flag && input.flag.length > 0) {
          const validFlags: FlagCategory[] = ['orphans', 'stale', 'invalid'];
          const unknownFlags = input.flag.filter((f: string) => !validFlags.includes(f as FlagCategory));
          if (unknownFlags.length > 0) {
            log(`Warning: Unknown flag categories ignored: ${unknownFlags.join(', ')}`);
          }
        }

        const result = await scanData({
          scope,
          validate: input.validate,
          flag: input.flag,
          days: input.days,
        });

        // Return both formatted text and structured JSON
        const formatted = formatScanOutput(result);
        return {
          content: [
            { type: 'text', text: formatted },
            { type: 'text', text: '\n\n--- JSON ---\n' + JSON.stringify(result, null, 2) },
          ],
          isError: !!result.error,
        };
      }

      // Sentinel tools - Data Inspector (Python backend)
      case 'sentinel_scanData': {
        const input = args as unknown as ScanDataPythonInput;

        if (!input.projectId) {
          throw new Error('Missing required field: projectId');
        }

        // Validate flag categories if provided
        if (input.flags && input.flags.length > 0) {
          const validFlags: ScanDataFlag[] = ['orphans', 'stale', 'invalid'];
          const invalidFlags = input.flags.filter((f) => !validFlags.includes(f));
          if (invalidFlags.length > 0) {
            throw new Error(`Invalid flags: ${invalidFlags.join(', ')}. Must be one of: ${validFlags.join(', ')}`);
          }
        }

        const result = await scanDataPython({
          projectId: input.projectId,
          validate: input.validate ?? false,
          flags: input.flags ?? [],
          days: input.days ?? 21,
        });

        if (isScanDataError(result)) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                error: result.error,
                exitCode: result.exitCode,
                stderr: result.stderr,
              }, null, 2),
            }],
            isError: true,
          };
        }

        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      // Sentinel tools - YAML Issues (projectId-based)
      case 'sentinel_listIssues': {
        const input = args as unknown as {
          projectId: string;
          status?: SentinelIssueStatus;
          epicId?: string;
        };

        if (!input.projectId) {
          throw new Error('Missing required field: projectId');
        }

        // Validate status if provided
        if (input.status) {
          const validStatuses: SentinelIssueStatus[] = ['open', 'in_progress', 'done', 'blocked'];
          if (!validStatuses.includes(input.status)) {
            throw new Error(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
          }
        }

        let issues = await listIssuesForProject(input.projectId);

        // Apply filters
        if (input.status) {
          issues = filterByStatus(issues, input.status);
        }
        if (input.epicId) {
          issues = filterByEpicId(issues, input.epicId);
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

        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'sentinel_createIssue': {
        const input = args as unknown as CreateSentinelIssueInput;

        if (!input.projectId || !input.title) {
          throw new Error('Missing required fields: projectId and title are required');
        }

        // Validate priority if provided
        if (input.priority) {
          const validPriorities: SentinelIssuePriority[] = ['low', 'medium', 'high'];
          if (!validPriorities.includes(input.priority)) {
            throw new Error(`Invalid priority. Must be one of: ${validPriorities.join(', ')}`);
          }
        }

        const result = await createSentinelIssue(input);

        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      // Architect tools - Project ADRs (projectId-based)
      case 'architect_createAdr': {
        const input = args as unknown as AdrInput;

        if (!input.projectId || !input.title || !input.context || !input.decision || !input.consequences) {
          throw new Error('Missing required fields: projectId, title, context, decision, and consequences are required');
        }

        const result = await createProjectAdr(input);

        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      // Oracle tools
      case 'oracle_next_actions': {
        const input = args as unknown as NextActionsInput;
        if (!input.project_id) {
          throw new Error('Missing required field: project_id');
        }
        const result = await nextActions(input);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      // Learnings tools
      case 'learnings_append': {
        const input = args as unknown as AppendLearningInput;
        if (!input.project_id || !input.category || !input.title || !input.content) {
          throw new Error('Missing required fields: project_id, category, title, and content are required');
        }
        const validCategories: LearningCategory[] = ['debug', 'integration', 'architecture', 'tooling', 'process', 'other'];
        if (!validCategories.includes(input.category)) {
          throw new Error(`Invalid category. Must be one of: ${validCategories.join(', ')}`);
        }
        const result = await appendLearning(input);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'learnings_list': {
        const input = args as unknown as ListLearningsInput;
        if (!input.project_id) {
          throw new Error('Missing required field: project_id');
        }
        if (input.category) {
          const validCategories: LearningCategory[] = ['debug', 'integration', 'architecture', 'tooling', 'process', 'other'];
          if (!validCategories.includes(input.category)) {
            throw new Error(`Invalid category. Must be one of: ${validCategories.join(', ')}`);
          }
        }
        const result = await listLearnings(input);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      // Friction tools
      case 'friction_log': {
        const input = args as unknown as LogFrictionInput;
        if (!input.context || !input.description) {
          throw new Error('Missing required fields: context and description are required');
        }
        if (input.frequency) {
          const valid: FrictionFrequency[] = ['once', 'occasional', 'frequent', 'constant'];
          if (!valid.includes(input.frequency)) {
            throw new Error(`Invalid frequency. Must be one of: ${valid.join(', ')}`);
          }
        }
        if (input.impact) {
          const valid: FrictionImpact[] = ['low', 'medium', 'high', 'blocking'];
          if (!valid.includes(input.impact)) {
            throw new Error(`Invalid impact. Must be one of: ${valid.join(', ')}`);
          }
        }
        const result = await logFriction(input);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'friction_list': {
        const input = args as unknown as ListFrictionInput;
        if (input.status) {
          const valid: FrictionStatus[] = ['open', 'acknowledged', 'solving', 'resolved', 'wontfix'];
          if (!valid.includes(input.status)) {
            throw new Error(`Invalid status. Must be one of: ${valid.join(', ')}`);
          }
        }
        if (input.min_impact) {
          const valid: FrictionImpact[] = ['low', 'medium', 'high', 'blocking'];
          if (!valid.includes(input.min_impact)) {
            throw new Error(`Invalid min_impact. Must be one of: ${valid.join(', ')}`);
          }
        }
        const result = await listFriction(input);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'friction_resolve': {
        const input = args as unknown as ResolveFrictionInput;
        if (!input.friction_id || !input.resolution) {
          throw new Error('Missing required fields: friction_id and resolution are required');
        }
        const result = await resolveFriction(input);
        if ('error' in result) {
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            isError: true,
          };
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'friction_bump': {
        const input = args as unknown as BumpFrictionInput;
        if (!input.friction_id) {
          throw new Error('Missing required field: friction_id');
        }
        const result = await bumpFriction(input);
        if ('error' in result) {
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            isError: true,
          };
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`Error in tool ${name}:`, errorMessage);
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: errorMessage }) }],
      isError: true,
    };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log('Decibel MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
