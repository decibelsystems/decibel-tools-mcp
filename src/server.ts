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
  createIssue,
  CreateIssueInput,
  Severity,
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
import { nextActions, NextActionsInput } from './tools/oracle.js';

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

        // Check for EPIC_NOT_FOUND error
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
