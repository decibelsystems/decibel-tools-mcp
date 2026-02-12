#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { getConfig, log } from './config.js';
import { createKernel, ToolKernel } from './kernel.js';
import { startHttpServer, parseHttpArgs } from './httpServer.js';

const config = getConfig();

log(`Starting Decibel MCP Server`);
log(`Environment: ${config.env}`);
log(`Organization: ${config.org}`);
log(`Root Directory: ${config.rootDir}`);
if (process.env.DECIBEL_PRO === '1') {
  log(`Pro features: ENABLED`);
}

let kernel: ToolKernel;

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

// Define available tools — facades are the public API, kernel dispatches internally
server.setRequestHandler(ListToolsRequestSchema, async (request) => {
  // Support detail tier hint via _meta (for SLM clients)
  const meta = (request.params as Record<string, unknown> | undefined)?._meta as Record<string, unknown> | undefined;
  const tier = (meta?.detailTier as 'full' | 'compact' | 'micro') || 'full';

  return {
    tools: kernel.getMcpToolDefinitions(tier),
  };
});

// Handle tool calls — dispatch through kernel
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  log(`Tool called: ${name}`);
  log(`Arguments:`, JSON.stringify(args, null, 2));

  try {
    // Extract agent context from MCP _meta if present
    const meta = (request.params as Record<string, unknown>)._meta as Record<string, unknown> | undefined;
    const context = meta ? {
      agentId: meta.agentId as string | undefined,
      runId: meta.runId as string | undefined,
      parentCallId: meta.parentCallId as string | undefined,
      scope: meta.scope as string | undefined,
    } : undefined;

    const result = await kernel.dispatch(name, args as Record<string, unknown>, context);
    return result as { content: Array<{ type: 'text'; text: string }>; isError?: boolean };
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
  kernel = await createKernel();

  const { httpMode, port, authToken, host } = parseHttpArgs(process.argv);

  if (httpMode) {
    log('Starting in HTTP mode');
    await startHttpServer(server, kernel, { port, authToken, host });
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    log('Decibel MCP Server running on stdio');
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
