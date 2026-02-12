#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { getAllTools } from './tools/index.js';
import { ToolSpec } from './tools/types.js';
import { trackToolUse } from './tools/shared/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { getConfig, log } from './config.js';
import { startHttpServer, parseHttpArgs } from './httpServer.js';

const config = getConfig();

log(`Starting Decibel MCP Server`);
log(`Environment: ${config.env}`);
log(`Organization: ${config.org}`);
log(`Root Directory: ${config.rootDir}`);
if (process.env.DECIBEL_PRO === '1') {
  log(`Pro features: ENABLED`);
}

// Tools loaded async at startup (includes core + pro + graduated)
let allTools: ToolSpec[] = [];
let toolMap: Map<string, ToolSpec> = new Map();

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

// Define available tools — single source of truth from getAllTools()
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: allTools.map(t => t.definition),
  };
});

// Handle tool calls — unified dispatch through toolMap
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  log(`Tool called: ${name}`);
  log(`Arguments:`, JSON.stringify(args, null, 2));

  try {
    const tool = toolMap.get(name);
    if (!tool) {
      throw new Error(`Unknown tool: ${name}`);
    }

    trackToolUse(name);
    const result = await tool.handler(args);
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
  // Load all tools (including pro if DECIBEL_PRO=1)
  allTools = await getAllTools();
  toolMap = new Map(allTools.map(t => [t.definition.name, t]));
  log(`Loaded ${allTools.length} tools`);

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
