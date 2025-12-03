import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { recordDesignDecision, RecordDesignDecisionInput } from '../../src/tools/designer.js';
import { recordArchDecision, RecordArchDecisionInput } from '../../src/tools/architect.js';
import { createIssue, CreateIssueInput, Severity } from '../../src/tools/sentinel.js';
import { nextActions, NextActionsInput } from '../../src/tools/oracle.js';

export interface TestMcpClient {
  client: Client;
  server: Server;
  close: () => Promise<void>;
  listTools: () => Promise<Array<{ name: string; description?: string }>>;
  callTool: (name: string, args: Record<string, unknown>) => Promise<{
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
  }>;
}

/**
 * Creates a test MCP client connected to a real server instance via in-memory transport.
 * This allows testing the full MCP protocol flow without stdio.
 */
export async function createTestMcpClient(): Promise<TestMcpClient> {
  // Create server with same configuration as production
  const server = new Server(
    { name: 'decibel-tools-mcp-test', version: '0.1.0' },
    { capabilities: { tools: {} } }
  );

  // Register tool handlers (same as server.ts)
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'designer.record_design_decision',
        description: 'Record a design decision for a project.',
        inputSchema: {
          type: 'object',
          properties: {
            project_id: { type: 'string' },
            area: { type: 'string' },
            summary: { type: 'string' },
            details: { type: 'string' },
          },
          required: ['project_id', 'area', 'summary'],
        },
      },
      {
        name: 'architect.record_arch_decision',
        description: 'Record an architectural decision (ADR).',
        inputSchema: {
          type: 'object',
          properties: {
            system_id: { type: 'string' },
            change: { type: 'string' },
            rationale: { type: 'string' },
            impact: { type: 'string' },
          },
          required: ['system_id', 'change', 'rationale'],
        },
      },
      {
        name: 'sentinel.create_issue',
        description: 'Create a new issue.',
        inputSchema: {
          type: 'object',
          properties: {
            repo: { type: 'string' },
            severity: { type: 'string', enum: ['low', 'med', 'high', 'critical'] },
            title: { type: 'string' },
            details: { type: 'string' },
          },
          required: ['repo', 'severity', 'title', 'details'],
        },
      },
      {
        name: 'oracle.next_actions',
        description: 'Get recommended next actions.',
        inputSchema: {
          type: 'object',
          properties: {
            project_id: { type: 'string' },
            focus: { type: 'string' },
          },
          required: ['project_id'],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case 'designer.record_design_decision': {
          const input = args as unknown as RecordDesignDecisionInput;
          if (!input.project_id || !input.area || !input.summary) {
            throw new Error('Missing required fields');
          }
          const result = await recordDesignDecision(input);
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }
        case 'architect.record_arch_decision': {
          const input = args as unknown as RecordArchDecisionInput;
          if (!input.system_id || !input.change || !input.rationale) {
            throw new Error('Missing required fields');
          }
          const result = await recordArchDecision(input);
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }
        case 'sentinel.create_issue': {
          const input = args as unknown as CreateIssueInput;
          if (!input.repo || !input.severity || !input.title || !input.details) {
            throw new Error('Missing required fields');
          }
          const validSeverities: Severity[] = ['low', 'med', 'high', 'critical'];
          if (!validSeverities.includes(input.severity)) {
            throw new Error('Invalid severity');
          }
          const result = await createIssue(input);
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }
        case 'oracle.next_actions': {
          const input = args as unknown as NextActionsInput;
          if (!input.project_id) {
            throw new Error('Missing required field: project_id');
          }
          const result = await nextActions(input);
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: String(error) }) }],
        isError: true,
      };
    }
  });

  // Create in-memory transport pair
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  // Create client
  const client = new Client(
    { name: 'test-client', version: '1.0.0' },
    { capabilities: {} }
  );

  // Connect both ends
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);

  return {
    client,
    server,
    close: async () => {
      await client.close();
      await server.close();
    },
    listTools: async () => {
      const result = await client.listTools();
      return result.tools.map((t) => ({ name: t.name, description: t.description }));
    },
    callTool: async (name: string, args: Record<string, unknown>) => {
      const result = await client.callTool({ name, arguments: args });
      return {
        content: result.content as Array<{ type: string; text: string }>,
        isError: result.isError,
      };
    },
  };
}
