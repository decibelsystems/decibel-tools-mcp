// ============================================================================
// HTTP Transport Adapter
// ============================================================================
// Wraps httpServer.ts for ChatGPT, Mother, iOS, external agents.
// Creates its own MCP Server and passes it to the existing HTTP server.
// ============================================================================

import { log } from '../config.js';
import type { ToolKernel } from '../kernel.js';
import type { TransportAdapter, TransportConfig } from './types.js';
import { createMcpServer } from './mcp.js';
import { startHttpServer, type HttpServerHandle } from '../httpServer.js';

export class HttpAdapter implements TransportAdapter {
  readonly name = 'http';
  private handle: HttpServerHandle | null = null;

  async start(kernel: ToolKernel, config: TransportConfig): Promise<void> {
    const server = createMcpServer(kernel);
    this.handle = await startHttpServer(server, kernel, {
      port: config.port || 8787,
      host: config.host || '0.0.0.0',
      authToken: config.authToken,
      sseKeepaliveMs: config.sseKeepaliveMs,
      timeoutMs: config.timeoutMs,
      retryIntervalMs: config.retryIntervalMs,
    });
    log('HTTP transport started');
  }

  async stop(): Promise<void> {
    if (this.handle) {
      await this.handle.stop();
      this.handle = null;
    }
  }
}
