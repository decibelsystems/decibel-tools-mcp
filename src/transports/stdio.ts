// ============================================================================
// Stdio Transport Adapter
// ============================================================================
// Wraps StdioServerTransport for Claude Code, Cursor, Claude Desktop.
// Session = process lifetime.
// ============================================================================

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { log } from '../config.js';
import type { ToolKernel } from '../kernel.js';
import type { TransportAdapter, TransportConfig } from './types.js';
import { createMcpServer } from './mcp.js';

export class StdioAdapter implements TransportAdapter {
  readonly name = 'stdio';
  private server: Server | null = null;

  async start(kernel: ToolKernel, _config: TransportConfig): Promise<void> {
    this.server = createMcpServer(kernel);
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    log('Decibel MCP Server running on stdio');
  }

  async stop(): Promise<void> {
    if (this.server) {
      await this.server.close();
      this.server = null;
    }
  }
}
