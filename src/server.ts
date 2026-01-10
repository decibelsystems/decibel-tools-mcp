#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { getAllTools } from './tools/index.js';
import { ToolSpec } from './tools/types.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { getConfig, log } from './config.js';
import {
  loadGraduatedTools,
  graduatedToolsToMcpDefinitions,
  executeGraduatedTool,
  findGraduatedTool,
  GraduatedTool,
} from './tools/dojoGraduated.js';
import { startHttpServer, parseHttpArgs } from './httpServer.js';

const config = getConfig();

log(`Starting Decibel MCP Server`);
log(`Environment: ${config.env}`);
log(`Organization: ${config.org}`);
log(`Root Directory: ${config.rootDir}`);
if (process.env.DECIBEL_PRO === '1') {
  log(`Pro features: ENABLED`);
}

// Load graduated Dojo tools
const graduatedTools: GraduatedTool[] = loadGraduatedTools();
log(`Loaded ${graduatedTools.length} graduated Dojo tools`);

// Tools loaded async at startup
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

// Define available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      // Modular tools (from src/tools/*)
      ...allTools.map(t => t.definition),

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
    // Check modular tools first (from src/tools/*)
    const modularTool = toolMap.get(name);
    if (modularTool) {
      const result = await modularTool.handler(args);
      // Cast to match MCP SDK expected return type
      return result as { content: Array<{ type: 'text'; text: string }>; isError?: boolean };
    }

    // Only handle graduated dojo tools here
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
