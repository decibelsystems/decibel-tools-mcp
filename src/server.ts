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
  isProjectResolutionError,
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
  logCrit,
  LogCritInput,
  CritSentiment,
  listCrits,
  ListCritsInput,
} from './tools/crit.js';
import {
  listProvenance,
  ListProvenanceInput,
} from './tools/provenance.js';
import {
  listProjects,
  registerProject,
  unregisterProject,
  addProjectAlias,
  resolveProject,
  getRegistryFilePath,
  ProjectEntry,
} from './projectRegistry.js';
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
import {
  createProposal,
  CreateProposalInput,
  scaffoldExperiment,
  ScaffoldExperimentInput,
  listDojo,
  ListDojoInput,
  runExperiment,
  RunExperimentInput,
  getExperimentResults,
  GetResultsInput,
  addWish,
  AddWishInput,
  listWishes,
  ListWishesInput,
  canGraduate,
  CanGraduateInput,
  readArtifact,
  ReadArtifactInput,
  isDojoError,
  ExperimentType,
  dojoListProjects,
} from './tools/dojo.js';
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
} from './tools/context.js';
import {
  loadGraduatedTools,
  graduatedToolsToMcpDefinitions,
  executeGraduatedTool,
  findGraduatedTool,
  GraduatedTool,
} from './tools/dojoGraduated.js';
import { startHttpServer, parseHttpArgs } from './httpServer.js';

// ============================================================================
// Helper: Normalize parameter keys to handle case variations
// ============================================================================

/**
 * Normalize object keys to match expected schema.
 * Handles case-insensitive matching and strips common suffixes like "(summary)".
 */
function normalizeParams<T>(
  args: Record<string, unknown>,
  expectedKeys: string[]
): T {
  const result: Record<string, unknown> = {};
  const keyMap = new Map<string, string>();

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

const config = getConfig();

log(`Starting Decibel MCP Server`);
log(`Environment: ${config.env}`);
log(`Organization: ${config.org}`);
log(`Root Directory: ${config.rootDir}`);

// Load graduated Dojo tools
const graduatedTools: GraduatedTool[] = loadGraduatedTools();
log(`Loaded ${graduatedTools.length} graduated Dojo tools`);

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
        description: 'Record an architectural decision (ADR) for a project. Creates a markdown file with Change, Rationale, and Impact sections.',
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

      // Sentinel tools - Issues
      {
        name: 'sentinel_create_issue',
        description: 'Create a new issue for a project. Creates a markdown file with severity and status tracking. Can optionally link to an epic.',
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
      {
        name: 'sentinel_close_issue',
        description: 'Close an existing issue. Updates the status to closed and adds a closed_at timestamp. Can optionally add a resolution note.',
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
      {
        name: 'sentinel_list_repo_issues',
        description: 'List all issues for a specific project, optionally filtered by status.',
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

      // Sentinel tools - Epics
      {
        name: 'sentinel_log_epic',
        description: 'Create a new Sentinel epic (large feature) record. Returns the epic_id and file path.',
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
      {
        name: 'sentinel_list_epics',
        description: 'List all epics, optionally filtered by status, priority, or tags.',
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
      {
        name: 'sentinel_get_epic',
        description: 'Get details of a specific epic by ID.',
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
      {
        name: 'sentinel_get_epic_issues',
        description: 'Get all issues linked to a specific epic.',
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
      {
        name: 'sentinel_resolve_epic',
        description: 'Resolve a fuzzy epic name/keyword into one or more matching epics. Use this to find the correct epic_id before creating issues.',
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

      // Sentinel tools - Data Inspector
      {
        name: 'sentinel_scan',
        description: 'Scan project data (issues, epics, ADRs) for validation, orphans, and stale items. Use scope "data" for data inspection, "runtime" for runtime health (not yet implemented), or "all" for both.',
        inputSchema: {
          type: 'object',
          properties: {
            projectId: {
              type: 'string',
              description: 'Project ID to scan (required for remote/HTTP access)',
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
          required: ['projectId'],
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
            projectId: {
              type: 'string',
              description: 'Optional project identifier. Uses default project if not specified.',
            },
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
            projectId: {
              type: 'string',
              description: 'Optional project identifier. Uses default project if not specified.',
            },
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
            projectId: {
              type: 'string',
              description: 'Optional project identifier. Uses default project if not specified.',
            },
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
            projectId: {
              type: 'string',
              description: 'Optional project identifier. Uses default project if not specified.',
            },
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

      // Crit tools - Early creative feedback
      {
        name: 'designer_crit',
        description: 'Log early creative feedback before decisions crystallize. Use for gut reactions, observations, questions, and hunches during exploration phases.',
        inputSchema: {
          type: 'object',
          properties: {
            project_id: {
              type: 'string',
              description: 'The project identifier',
            },
            area: {
              type: 'string',
              description: 'Area being critiqued (e.g., "3D", "motion", "layout", "ux")',
            },
            observation: {
              type: 'string',
              description: 'The crit itself - what you noticed, felt, or wondered',
            },
            sentiment: {
              type: 'string',
              enum: ['positive', 'negative', 'neutral', 'question'],
              description: 'The tone of the observation (default: neutral)',
            },
            context: {
              type: 'string',
              description: 'Optional context - what were you testing/looking at?',
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Optional tags for filtering',
            },
          },
          required: ['project_id', 'area', 'observation'],
        },
      },
      {
        name: 'designer_list_crits',
        description: 'List crit observations for a project, optionally filtered by area or sentiment.',
        inputSchema: {
          type: 'object',
          properties: {
            project_id: {
              type: 'string',
              description: 'The project identifier',
            },
            area: {
              type: 'string',
              description: 'Filter by area (e.g., "3D", "motion")',
            },
            sentiment: {
              type: 'string',
              enum: ['positive', 'negative', 'neutral', 'question'],
              description: 'Filter by sentiment',
            },
            limit: {
              type: 'integer',
              description: 'Maximum number of entries to return (most recent first)',
            },
          },
          required: ['project_id'],
        },
      },

      // Registry tools
      {
        name: 'registry_list',
        description: 'List all registered projects in the Decibel registry. Shows project IDs, paths, and aliases.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'registry_add',
        description: 'Register a project in the Decibel registry. The project path must contain a .decibel folder.',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'Unique project ID (typically the directory name)',
            },
            path: {
              type: 'string',
              description: 'Absolute path to the project root (must contain .decibel/)',
            },
            name: {
              type: 'string',
              description: 'Human-readable project name',
            },
            aliases: {
              type: 'array',
              items: { type: 'string' },
              description: 'Alternative names/shortcuts for this project',
            },
          },
          required: ['id', 'path'],
        },
      },
      {
        name: 'registry_remove',
        description: 'Remove a project from the Decibel registry. Does not delete project files.',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'Project ID to remove',
            },
          },
          required: ['id'],
        },
      },
      {
        name: 'registry_alias',
        description: 'Add an alias (shortcut name) to an existing project in the registry.',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'Project ID to add alias to',
            },
            alias: {
              type: 'string',
              description: 'Alias to add (e.g., "senken" as alias for "senken-trading-agent")',
            },
          },
          required: ['id', 'alias'],
        },
      },
      {
        name: 'registry_resolve',
        description: 'Test resolution of a project ID/alias. Shows which project would be resolved and how.',
        inputSchema: {
          type: 'object',
          properties: {
            projectId: {
              type: 'string',
              description: 'Project ID, alias, or path to resolve',
            },
          },
          required: ['projectId'],
        },
      },

      // Dojo tools - AI Feature Incubator
      {
        name: 'dojo_create_proposal',
        description: 'Create a new Dojo proposal for a feature or capability. AI can propose, but only humans can enable experiments.',
        inputSchema: {
          type: 'object',
          properties: {
            project_id: {
              type: 'string',
              description: 'Project ID to create proposal in (e.g., "senken" or "decibel-tools-mcp")',
            },
            caller_role: {
              type: 'string',
              enum: ['human', 'mother', 'ai'],
              description: 'Role of the caller for access control (default: human)',
            },
            agent_id: {
              type: 'string',
              description: 'Identifier for the calling agent (e.g., "mother", "chatgpt") - used for audit trails',
            },
            title: {
              type: 'string',
              description: 'Proposal title (e.g., "Exchange Rate Limit Pattern Detector")',
            },
            problem: {
              type: 'string',
              description: 'The problem this proposal addresses',
            },
            hypothesis: {
              type: 'string',
              description: 'Why this solution will work',
            },
            owner: {
              type: 'string',
              enum: ['ai', 'human'],
              description: 'Who created this proposal (default: ai)',
            },
            target_module: {
              type: 'string',
              description: 'Target module: sentinel|designer|architect|oracle|tools|dojo',
            },
            scope_in: {
              type: 'array',
              items: { type: 'string' },
              description: "What's included in scope",
            },
            scope_out: {
              type: 'array',
              items: { type: 'string' },
              description: "What's explicitly NOT included",
            },
            acceptance: {
              type: 'array',
              items: { type: 'string' },
              description: 'Acceptance criteria - how we know it works',
            },
            risks: {
              type: 'array',
              items: { type: 'string' },
              description: 'What could go wrong',
            },
            follows: {
              type: 'string',
              description: 'Proposal ID this follows (for feedback loops)',
            },
            insight: {
              type: 'string',
              description: 'Insight from previous experiment that led to this proposal',
            },
            wish_id: {
              type: 'string',
              description: 'Link to existing wish (e.g., "WISH-0001"). Auto-fills problem from wish reason and marks wish as resolved.',
            },
          },
          required: ['title', 'problem', 'hypothesis'],
        },
      },
      {
        name: 'dojo_scaffold_experiment',
        description: 'Create an experiment skeleton from a proposal. This creates the experiment directory with manifest, entrypoint, and README.',
        inputSchema: {
          type: 'object',
          properties: {
            project_id: {
              type: 'string',
              description: 'Project ID containing the proposal (e.g., "senken" or "decibel-tools-mcp")',
            },
            caller_role: {
              type: 'string',
              enum: ['human', 'mother', 'ai'],
              description: 'Role of the caller for access control (default: human)',
            },
            agent_id: {
              type: 'string',
              description: 'Identifier for the calling agent (e.g., "mother", "chatgpt") - used for audit trails',
            },
            proposal_id: {
              type: 'string',
              description: 'Proposal ID (e.g., "DOJO-PROP-0001")',
            },
            script_type: {
              type: 'string',
              enum: ['py', 'ts'],
              description: 'Script type for entrypoint (default: py)',
            },
            experiment_type: {
              type: 'string',
              enum: ['script', 'tool', 'check', 'prompt'],
              description: 'Experiment type: script (default), tool (MCP tool candidate), check (validation), prompt (template)',
            },
          },
          required: ['proposal_id'],
        },
      },
      {
        name: 'dojo_list',
        description: 'List Dojo proposals, experiments, and wishes with their states.',
        inputSchema: {
          type: 'object',
          properties: {
            project_id: {
              type: 'string',
              description: 'Project ID to list Dojo items from (e.g., "senken" or "decibel-tools-mcp")',
            },
            caller_role: {
              type: 'string',
              enum: ['human', 'mother', 'ai'],
              description: 'Role of the caller for access control (default: human)',
            },
            agent_id: {
              type: 'string',
              description: 'Identifier for the calling agent (e.g., "mother", "chatgpt") - used for audit trails',
            },
            filter: {
              type: 'string',
              enum: ['proposals', 'experiments', 'wishes', 'all'],
              description: 'Filter results (default: all)',
            },
          },
          required: [],
        },
      },
      {
        name: 'dojo_run_experiment',
        description: 'Run an experiment in SANDBOX mode. Results are written to {project}/.decibel/dojo/results/. NOTE: This always runs in sandbox mode - enabled mode is human-only via CLI.',
        inputSchema: {
          type: 'object',
          properties: {
            project_id: {
              type: 'string',
              description: 'Project ID containing the experiment (e.g., "senken" or "decibel-tools-mcp")',
            },
            caller_role: {
              type: 'string',
              enum: ['human', 'mother', 'ai'],
              description: 'Role of the caller for access control (default: human)',
            },
            agent_id: {
              type: 'string',
              description: 'Identifier for the calling agent (e.g., "mother", "chatgpt") - used for audit trails',
            },
            experiment_id: {
              type: 'string',
              description: 'Experiment ID (e.g., "DOJO-EXP-0001")',
            },
          },
          required: ['experiment_id'],
        },
      },
      {
        name: 'dojo_get_results',
        description: 'Get results from a previous experiment run. Use to examine what an experiment produced.',
        inputSchema: {
          type: 'object',
          properties: {
            project_id: {
              type: 'string',
              description: 'Project ID containing the experiment (e.g., "senken" or "decibel-tools-mcp")',
            },
            caller_role: {
              type: 'string',
              enum: ['human', 'mother', 'ai'],
              description: 'Role of the caller for access control (default: human)',
            },
            agent_id: {
              type: 'string',
              description: 'Identifier for the calling agent (e.g., "mother", "chatgpt") - used for audit trails',
            },
            experiment_id: {
              type: 'string',
              description: 'Experiment ID (e.g., "DOJO-EXP-0001")',
            },
            run_id: {
              type: 'string',
              description: 'Specific run ID (default: latest)',
            },
          },
          required: ['experiment_id'],
        },
      },
      {
        name: 'dojo_add_wish',
        description: 'Add a capability wish to the Dojo wishlist. Requires 4 fields: capability (what), reason (why), inputs (data needed), outputs (what it produces).',
        inputSchema: {
          type: 'object',
          properties: {
            project_id: {
              type: 'string',
              description: 'Project ID to add wish to (e.g., "senken" or "decibel-tools-mcp")',
            },
            caller_role: {
              type: 'string',
              enum: ['human', 'mother', 'ai'],
              description: 'Role of the caller for access control (default: human)',
            },
            agent_id: {
              type: 'string',
              description: 'Identifier for the calling agent (e.g., "mother", "chatgpt") - used for audit trails',
            },
            // Required fields (4)
            capability: {
              type: 'string',
              description: 'What it does - the core idea (e.g., "Correlation matrix for active signals")',
            },
            reason: {
              type: 'string',
              description: 'Why it improves outcomes (e.g., "Identify when multiple trades create unintended hedging")',
            },
            inputs: {
              type: 'array',
              items: { type: 'string' },
              description: 'What data it needs (e.g., ["active_signals", "price_history_30d"])',
            },
            outputs: {
              type: ['string', 'object'],
              description: 'What it produces (e.g., {"correlation_matrix": {}, "hedging_risk_score": 0.0, "conflicts": []})',
            },
            // Optional fields (filled in as wish progresses)
            integration_point: {
              type: 'string',
              description: 'Where it plugs in - filled during scaffold phase',
            },
            success_metric: {
              type: 'string',
              description: 'How we know it works - filled before enable phase',
            },
            risks: {
              type: 'array',
              items: { type: 'string' },
              description: 'Safety review items - filled before enable phase',
            },
            mvp: {
              type: 'string',
              description: 'Smallest viable slice - if scoping is needed',
            },
            algorithm_outline: {
              type: 'string',
              description: 'Logic outline - if the algorithm is non-obvious',
            },
            context: {
              type: 'object',
              description: 'Additional structured context about when/why this wish occurred',
            },
          },
          required: ['capability', 'reason', 'inputs', 'outputs'],
        },
      },
      {
        name: 'dojo_list_wishes',
        description: 'List wishes from the Dojo wishlist. Shows what capabilities AI has requested.',
        inputSchema: {
          type: 'object',
          properties: {
            project_id: {
              type: 'string',
              description: 'Project ID to list wishes from (e.g., "senken" or "decibel-tools-mcp")',
            },
            caller_role: {
              type: 'string',
              enum: ['human', 'mother', 'ai'],
              description: 'Role of the caller for access control (default: human)',
            },
            agent_id: {
              type: 'string',
              description: 'Identifier for the calling agent (e.g., "mother", "chatgpt") - used for audit trails',
            },
            unresolved_only: {
              type: 'boolean',
              description: 'Only show unresolved wishes (default: false)',
            },
          },
          required: [],
        },
      },
      {
        name: 'dojo_can_graduate',
        description: 'Check if an experiment can be graduated to a real tool. Returns eligibility and reasons. (Actual graduation is human-only via CLI)',
        inputSchema: {
          type: 'object',
          properties: {
            project_id: {
              type: 'string',
              description: 'Project ID containing the experiment (e.g., "senken" or "decibel-tools-mcp")',
            },
            caller_role: {
              type: 'string',
              enum: ['human', 'mother', 'ai'],
              description: 'Role of the caller for access control (default: human)',
            },
            agent_id: {
              type: 'string',
              description: 'Identifier for the calling agent (e.g., "mother", "chatgpt") - used for audit trails',
            },
            experiment_id: {
              type: 'string',
              description: 'Experiment ID (e.g., "DOJO-EXP-0001")',
            },
          },
          required: ['experiment_id'],
        },
      },
      {
        name: 'dojo_read_artifact',
        description: 'Read an artifact file from experiment results. Returns parsed content for yaml/json, raw text for others, base64 for binary.',
        inputSchema: {
          type: 'object',
          properties: {
            project_id: {
              type: 'string',
              description: 'Project ID containing the experiment (e.g., "senken" or "decibel-tools-mcp")',
            },
            caller_role: {
              type: 'string',
              enum: ['human', 'mother', 'ai'],
              description: 'Role of the caller for access control (default: human)',
            },
            agent_id: {
              type: 'string',
              description: 'Identifier for the calling agent (e.g., "mother", "chatgpt") - used for audit trails',
            },
            experiment_id: {
              type: 'string',
              description: 'Experiment ID (e.g., "DOJO-EXP-0001")',
            },
            run_id: {
              type: 'string',
              description: 'Run ID from dojo_run_experiment response (e.g., "20251216-070615")',
            },
            filename: {
              type: 'string',
              description: 'Artifact filename (e.g., "result.yaml", "plot.png")',
            },
          },
          required: ['experiment_id', 'run_id', 'filename'],
        },
      },
      {
        name: 'dojo_projects',
        description: 'List available projects for Dojo operations. Helps discover which projects you can use. Shows the default project if one exists.',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },

      // ========================================================================
      // Context Pack Tools (ADR-002)
      // ========================================================================
      {
        name: 'decibel_context_refresh',
        description: 'Compile full context pack for AI memory. Returns pinned facts, recent events, and current state.',
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
      {
        name: 'decibel_context_pin',
        description: 'Pin a fact to persistent memory. Mother uses this to remember important insights.',
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
      {
        name: 'decibel_context_unpin',
        description: 'Remove a pinned fact from persistent memory.',
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
      {
        name: 'decibel_context_list',
        description: 'List all pinned facts.',
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
      {
        name: 'decibel_event_append',
        description: 'Append an event to the activity journal. Append-only log of significant activities.',
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
      {
        name: 'decibel_event_search',
        description: 'Search events in the activity journal.',
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
      {
        name: 'decibel_artifact_list',
        description: 'List artifacts for a specific run. Use run_id from dojo_run_experiment response.',
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
      {
        name: 'decibel_artifact_read',
        description: 'Read an artifact by run_id and name. Returns content with mime type.',
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

      // Provenance tools
      {
        name: 'provenance_list',
        description: 'List provenance events for an artifact or actor. Shows the history of changes with fingerprints for tracking who did what and when.',
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

      // Dynamically add graduated Dojo tools
      ...graduatedToolsToMcpDefinitions(graduatedTools),
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
        // Normalize parameter keys to handle case variations
        const rawInput = args as Record<string, unknown>;
        const input = normalizeParams<RecordDesignDecisionInput>(
          rawInput,
          ['project_id', 'projectId', 'area', 'summary', 'rationale', 'implementation_note', 'implementationNote', 'location']
        );
        // Also support projectId as alias for project_id
        if (!input.project_id && rawInput.projectId) {
          input.project_id = rawInput.projectId as string;
        }
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
        // Normalize parameter keys to handle case variations
        const rawArchInput = args as Record<string, unknown>;
        const input = normalizeParams<RecordArchDecisionInput>(
          rawArchInput,
          ['projectId', 'project_id', 'change', 'rationale', 'impact']
        );
        // Support project_id as alias for projectId
        if (!input.projectId && rawArchInput.project_id) {
          input.projectId = rawArchInput.project_id as string;
        }
        if (!input.change || !input.rationale) {
          throw new Error('Missing required fields: change and rationale are required');
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
        if (!input.severity || !input.title || !input.details) {
          throw new Error('Missing required fields: severity, title, and details are required');
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
        if (!input.issue_id) {
          throw new Error('Missing required field: issue_id is required');
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
        if (isProjectResolutionError(result)) {
          return {
            content: [{ type: 'text', text: JSON.stringify(result) }],
            isError: true,
          };
        }
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
        const input = args as unknown as ScanDataInput & { projectId?: string };

        // Require projectId for remote access
        if (!input.projectId) {
          throw new Error('Missing required field: projectId. Specify the project to scan.');
        }

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

        // Use Python backend when projectId is provided (required for remote access)
        const result = await scanDataPython({
          projectId: input.projectId,
          validate: input.validate ?? false,
          flags: input.flag || ['orphans', 'stale', 'invalid'],
          days: input.days || 21,
        });

        // Check for errors
        if ('error' in result) {
          return {
            content: [{ type: 'text', text: `Error: ${result.error}\n\nstderr: ${result.stderr || 'none'}` }],
            isError: true,
          };
        }

        // Return formatted result
        return {
          content: [
            { type: 'text', text: JSON.stringify(result, null, 2) },
          ],
          isError: false,
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
        // Normalize parameter keys to handle case variations (e.g., "Context" -> "context")
        const input = normalizeParams<AdrInput>(
          args as Record<string, unknown>,
          ['projectId', 'title', 'context', 'decision', 'consequences', 'relatedIssues', 'relatedEpics']
        );

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

      // Crit tools
      case 'designer_crit': {
        const input = args as unknown as LogCritInput;
        if (!input.project_id || !input.area || !input.observation) {
          throw new Error('Missing required fields: project_id, area, and observation are required');
        }
        if (input.sentiment) {
          const valid: CritSentiment[] = ['positive', 'negative', 'neutral', 'question'];
          if (!valid.includes(input.sentiment)) {
            throw new Error(`Invalid sentiment. Must be one of: ${valid.join(', ')}`);
          }
        }
        const result = await logCrit(input);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'designer_list_crits': {
        const input = args as unknown as ListCritsInput;
        if (!input.project_id) {
          throw new Error('Missing required field: project_id');
        }
        if (input.sentiment) {
          const valid: CritSentiment[] = ['positive', 'negative', 'neutral', 'question'];
          if (!valid.includes(input.sentiment)) {
            throw new Error(`Invalid sentiment. Must be one of: ${valid.join(', ')}`);
          }
        }
        const result = await listCrits(input);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      // Registry tools
      case 'registry_list': {
        const projects = listProjects();
        const registryPath = getRegistryFilePath();
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              registryPath,
              projectCount: projects.length,
              projects: projects.map((p) => ({
                id: p.id,
                name: p.name,
                path: p.path,
                aliases: p.aliases || [],
              })),
            }, null, 2),
          }],
        };
      }

      case 'registry_add': {
        const input = args as unknown as { id: string; path: string; name?: string; aliases?: string[] };
        if (!input.id || !input.path) {
          throw new Error('Missing required fields: id and path are required');
        }
        try {
          registerProject(input);
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: `Project "${input.id}" registered successfully`,
                project: input,
              }, null, 2),
            }],
          };
        } catch (err) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: err instanceof Error ? err.message : String(err),
              }, null, 2),
            }],
            isError: true,
          };
        }
      }

      case 'registry_remove': {
        const input = args as unknown as { id: string };
        if (!input.id) {
          throw new Error('Missing required field: id');
        }
        const removed = unregisterProject(input.id);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: removed,
              message: removed
                ? `Project "${input.id}" removed from registry`
                : `Project "${input.id}" not found in registry`,
            }, null, 2),
          }],
        };
      }

      case 'registry_alias': {
        const input = args as unknown as { id: string; alias: string };
        if (!input.id || !input.alias) {
          throw new Error('Missing required fields: id and alias are required');
        }
        try {
          addProjectAlias(input.id, input.alias);
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: `Alias "${input.alias}" added to project "${input.id}"`,
              }, null, 2),
            }],
          };
        } catch (err) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: err instanceof Error ? err.message : String(err),
              }, null, 2),
            }],
            isError: true,
          };
        }
      }

      case 'registry_resolve': {
        const input = args as unknown as { projectId: string };
        if (!input.projectId) {
          throw new Error('Missing required field: projectId');
        }
        try {
          const entry = resolveProject(input.projectId);
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                input: input.projectId,
                resolved: {
                  id: entry.id,
                  name: entry.name,
                  path: entry.path,
                  aliases: entry.aliases,
                },
              }, null, 2),
            }],
          };
        } catch (err) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: false,
                input: input.projectId,
                error: err instanceof Error ? err.message : String(err),
              }, null, 2),
            }],
            isError: true,
          };
        }
      }

      // Dojo tools - AI Feature Incubator
      case 'dojo_create_proposal': {
        const input = args as unknown as CreateProposalInput;
        if (!input.title || !input.problem || !input.hypothesis) {
          throw new Error('Missing required fields: title, problem, and hypothesis are required');
        }
        const result = await createProposal(input);
        if (isDojoError(result)) {
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            isError: true,
          };
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'dojo_scaffold_experiment': {
        const input = args as unknown as ScaffoldExperimentInput;
        if (!input.proposal_id) {
          throw new Error('Missing required field: proposal_id');
        }
        if (input.experiment_type) {
          const validTypes: ExperimentType[] = ['script', 'tool', 'check', 'prompt'];
          if (!validTypes.includes(input.experiment_type)) {
            throw new Error(`Invalid experiment_type. Must be one of: ${validTypes.join(', ')}`);
          }
        }
        const result = await scaffoldExperiment(input);
        if (isDojoError(result)) {
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            isError: true,
          };
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'dojo_list': {
        const input = args as unknown as ListDojoInput;
        const result = await listDojo(input);
        if (isDojoError(result)) {
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            isError: true,
          };
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'dojo_run_experiment': {
        const input = args as unknown as RunExperimentInput;
        if (!input.experiment_id) {
          throw new Error('Missing required field: experiment_id');
        }
        // SAFETY: runExperiment always uses --sandbox, never --enabled
        const result = await runExperiment(input);
        if (isDojoError(result)) {
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            isError: true,
          };
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'dojo_get_results': {
        const input = args as unknown as GetResultsInput;
        if (!input.experiment_id) {
          throw new Error('Missing required field: experiment_id');
        }
        const result = await getExperimentResults(input);
        if (isDojoError(result)) {
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            isError: true,
          };
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'dojo_add_wish': {
        const input = args as unknown as AddWishInput;
        if (!input.capability || !input.reason) {
          throw new Error('Missing required fields: capability and reason are required');
        }
        const result = await addWish(input);
        if (isDojoError(result)) {
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            isError: true,
          };
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'dojo_list_wishes': {
        const input = args as unknown as ListWishesInput;
        const result = await listWishes(input);
        if (isDojoError(result)) {
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            isError: true,
          };
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'dojo_can_graduate': {
        const input = args as unknown as CanGraduateInput;
        if (!input.experiment_id) {
          throw new Error('Missing required field: experiment_id');
        }
        const result = await canGraduate(input);
        if (isDojoError(result)) {
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            isError: true,
          };
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'dojo_read_artifact': {
        const input = args as unknown as ReadArtifactInput;
        if (!input.experiment_id) {
          throw new Error('Missing required field: experiment_id');
        }
        if (!input.run_id) {
          throw new Error('Missing required field: run_id');
        }
        if (!input.filename) {
          throw new Error('Missing required field: filename');
        }
        const result = await readArtifact(input);
        if (isDojoError(result)) {
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            isError: true,
          };
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'dojo_projects': {
        const result = dojoListProjects();
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      // ========================================================================
      // Context Pack Tools (ADR-002)
      // ========================================================================
      case 'decibel_context_refresh': {
        const input = args as unknown as ContextRefreshInput;
        if (!input.project_id) {
          throw new Error('Missing required field: project_id');
        }
        const result = await contextRefresh(input);
        if (isContextError(result)) {
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            isError: true,
          };
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'decibel_context_pin': {
        const input = args as unknown as ContextPinInput;
        if (!input.project_id) {
          throw new Error('Missing required field: project_id');
        }
        if (!input.title) {
          throw new Error('Missing required field: title');
        }
        const result = await contextPin(input);
        if (isContextError(result)) {
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            isError: true,
          };
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'decibel_context_unpin': {
        const input = args as unknown as ContextUnpinInput;
        if (!input.project_id) {
          throw new Error('Missing required field: project_id');
        }
        if (!input.id) {
          throw new Error('Missing required field: id');
        }
        const result = await contextUnpin(input);
        if (isContextError(result)) {
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            isError: true,
          };
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'decibel_context_list': {
        const input = args as unknown as ContextListInput;
        if (!input.project_id) {
          throw new Error('Missing required field: project_id');
        }
        const result = await contextList(input);
        if (isContextError(result)) {
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            isError: true,
          };
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'decibel_event_append': {
        const input = args as unknown as EventAppendInput;
        if (!input.project_id) {
          throw new Error('Missing required field: project_id');
        }
        if (!input.title) {
          throw new Error('Missing required field: title');
        }
        const result = await eventAppend(input);
        if (isContextError(result)) {
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            isError: true,
          };
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'decibel_event_search': {
        const input = args as unknown as EventSearchInput;
        if (!input.project_id) {
          throw new Error('Missing required field: project_id');
        }
        if (!input.query) {
          throw new Error('Missing required field: query');
        }
        const result = await eventSearch(input);
        if (isContextError(result)) {
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            isError: true,
          };
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'decibel_artifact_list': {
        const input = args as unknown as ArtifactListInput;
        if (!input.project_id) {
          throw new Error('Missing required field: project_id');
        }
        if (!input.run_id) {
          throw new Error('Missing required field: run_id');
        }
        const result = await artifactList(input);
        if (isContextError(result)) {
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            isError: true,
          };
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'decibel_artifact_read': {
        const input = args as unknown as ArtifactReadInput;
        if (!input.project_id) {
          throw new Error('Missing required field: project_id');
        }
        if (!input.run_id) {
          throw new Error('Missing required field: run_id');
        }
        if (!input.name) {
          throw new Error('Missing required field: name');
        }
        const result = await artifactRead(input);
        if (isContextError(result)) {
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            isError: true,
          };
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      // Provenance tools
      case 'provenance_list': {
        const input = args as unknown as ListProvenanceInput;
        const result = await listProvenance(input);
        if ('error' in result && result.error === 'project_resolution_failed') {
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            isError: true,
          };
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      default: {
        // Check if this is a graduated tool
        if (name.startsWith('graduated_')) {
          const tool = findGraduatedTool(graduatedTools, name);
          if (tool) {
            log(`Executing graduated tool: ${tool.tool_name}`);
            const result = await executeGraduatedTool(tool, args as Record<string, unknown>);
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
              isError: !result.success,
            };
          }
        }
        throw new Error(`Unknown tool: ${name}`);
      }
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
  const { httpMode, port, authToken, host } = parseHttpArgs(process.argv);

  if (httpMode) {
    // HTTP mode for remote access (ChatGPT, etc.)
    log('Starting in HTTP mode');
    await startHttpServer(server, { port, authToken, host });
  } else {
    // Default: stdio mode for Claude Code
    const transport = new StdioServerTransport();
    await server.connect(transport);
    log('Decibel MCP Server running on stdio');
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
