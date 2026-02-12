// ============================================================================
// Shared MCP Server Factory
// ============================================================================
// Creates an MCP Server with ListTools + CallTool handlers wired to the kernel.
// Each transport adapter calls this to get its own Server instance.
// ============================================================================

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { log } from '../config.js';
import type { ToolKernel } from '../kernel.js';

/**
 * Create an MCP Server wired to the given kernel.
 * Each transport gets its own Server instance (MCP SDK only supports
 * one transport per Server).
 */
export function createMcpServer(kernel: ToolKernel): Server {
  const server = new Server(
    { name: 'decibel-tools-mcp', version: '0.1.0' },
    { capabilities: { tools: {} } }
  );

  // Define available tools — facades are the public API
  server.setRequestHandler(ListToolsRequestSchema, async (request) => {
    const meta = (request.params as Record<string, unknown> | undefined)?._meta as Record<string, unknown> | undefined;
    const tier = (meta?.detailTier as 'full' | 'compact' | 'micro') || 'full';
    return { tools: kernel.getMcpToolDefinitions(tier) };
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

  return server;
}
