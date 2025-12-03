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
import { createIssue, CreateIssueInput, Severity } from './tools/sentinel.js';
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
      {
        name: 'designer.record_design_decision',
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
      {
        name: 'architect.record_arch_decision',
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
      {
        name: 'sentinel.create_issue',
        description: 'Create a new issue for a repository. Creates a markdown file with severity and status tracking.',
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
          },
          required: ['repo', 'severity', 'title', 'details'],
        },
      },
      {
        name: 'oracle.next_actions',
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
      case 'designer.record_design_decision': {
        const input = args as unknown as RecordDesignDecisionInput;
        if (!input.project_id || !input.area || !input.summary) {
          throw new Error('Missing required fields: project_id, area, and summary are required');
        }
        const result = await recordDesignDecision(input);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'architect.record_arch_decision': {
        const input = args as unknown as RecordArchDecisionInput;
        if (!input.system_id || !input.change || !input.rationale) {
          throw new Error('Missing required fields: system_id, change, and rationale are required');
        }
        const result = await recordArchDecision(input);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'sentinel.create_issue': {
        const input = args as unknown as CreateIssueInput;
        if (!input.repo || !input.severity || !input.title || !input.details) {
          throw new Error('Missing required fields: repo, severity, title, and details are required');
        }
        const validSeverities: Severity[] = ['low', 'med', 'high', 'critical'];
        if (!validSeverities.includes(input.severity)) {
          throw new Error(`Invalid severity. Must be one of: ${validSeverities.join(', ')}`);
        }
        const result = await createIssue(input);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'oracle.next_actions': {
        const input = args as unknown as NextActionsInput;
        if (!input.project_id) {
          throw new Error('Missing required field: project_id');
        }
        const result = await nextActions(input);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`Error in tool ${name}:`, errorMessage);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ error: errorMessage }),
        },
      ],
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
