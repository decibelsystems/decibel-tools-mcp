// ============================================================================
// Bridge Transport Adapter
// ============================================================================
// Stdio adapter that proxies tool calls to a running daemon over HTTP.
// Falls back to local kernel when daemon is unavailable.
//
// Usage:
//   node dist/server.js --bridge              (auto-detect daemon)
//   node dist/server.js --bridge http://...   (explicit daemon URL)
//
// How it works:
//   - ListTools: always uses local kernel (same definitions, instant)
//   - CallTool: tries daemon POST /call first, falls back to local kernel
//   - Health probe at startup + periodic re-check every 30s
//   - Multiple Claude Code instances share one daemon → coordinator sees all
// ============================================================================

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { log } from '../config.js';
import type { ToolKernel, DispatchContext } from '../kernel.js';
import type { ToolResult } from '../tools/types.js';
import type { TransportAdapter, TransportConfig } from './types.js';

const HEALTH_CHECK_INTERVAL_MS = 30_000;
const PROXY_TIMEOUT_MS = 30_000;

export class BridgeAdapter implements TransportAdapter {
  readonly name = 'bridge';
  private server: Server | null = null;
  private daemonUrl: string;
  private daemonAlive = false;
  private healthTimer: ReturnType<typeof setInterval> | null = null;

  constructor(daemonUrl: string) {
    this.daemonUrl = daemonUrl;
  }

  async start(kernel: ToolKernel, _config: TransportConfig): Promise<void> {
    // Probe daemon at startup
    this.daemonAlive = await this.probeDaemon();

    if (this.daemonAlive) {
      log(`Bridge: daemon alive at ${this.daemonUrl} — proxying tool calls`);
    } else {
      log(`Bridge: daemon not available — using local kernel (will re-probe every ${HEALTH_CHECK_INTERVAL_MS / 1000}s)`);
    }

    // Periodic health check — pick up daemon coming online or going down
    this.healthTimer = setInterval(async () => {
      const wasAlive = this.daemonAlive;
      this.daemonAlive = await this.probeDaemon();
      if (!wasAlive && this.daemonAlive) {
        log('Bridge: daemon came online — switching to proxy mode');
      } else if (wasAlive && !this.daemonAlive) {
        log('Bridge: daemon went offline — falling back to local kernel');
      }
    }, HEALTH_CHECK_INTERVAL_MS);

    // Create MCP Server with bridge dispatch
    this.server = new Server(
      { name: '@decibel/tools', version: '2.0.0' },
      { capabilities: { tools: {} } }
    );

    // ListTools: always local (same definitions, no network needed)
    this.server.setRequestHandler(ListToolsRequestSchema, async (request) => {
      const meta = (request.params as Record<string, unknown> | undefined)?._meta as Record<string, unknown> | undefined;
      const tier = (meta?.detailTier as 'full' | 'compact' | 'micro') || 'full';
      return { tools: kernel.getMcpToolDefinitions(tier) };
    });

    // CallTool: try daemon, fall back to local
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const meta = (request.params as Record<string, unknown>)._meta as Record<string, unknown> | undefined;
      const context: DispatchContext | undefined = meta ? {
        agentId: meta.agentId as string | undefined,
        runId: meta.runId as string | undefined,
        parentCallId: meta.parentCallId as string | undefined,
        scope: meta.scope as string | undefined,
      } : undefined;

      if (this.daemonAlive) {
        try {
          const result = await this.proxyCall(name, args as Record<string, unknown>, context);
          return result;
        } catch (err) {
          // Daemon call failed — mark down and fall through to local
          this.daemonAlive = false;
          log(`Bridge: proxy failed (${err instanceof Error ? err.message : err}), falling back to local kernel`);
        }
      }

      // Local dispatch
      try {
        const result = await kernel.dispatch(name, args as Record<string, unknown>, context);
        return result as { content: Array<{ type: 'text'; text: string }>; isError?: boolean };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: errorMessage }) }],
          isError: true,
        };
      }
    });

    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    log(`Bridge: MCP stdio server running (daemon=${this.daemonAlive ? 'proxy' : 'local'})`);
  }

  async stop(): Promise<void> {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
    if (this.server) {
      await this.server.close();
      this.server = null;
    }
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  /**
   * Probe daemon health endpoint.
   */
  private async probeDaemon(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(`${this.daemonUrl}/health`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Proxy a tool call to the daemon's HTTP /call endpoint.
   * Converts the StatusEnvelope response back to MCP ToolResult format.
   */
  private async proxyCall(
    name: string,
    args: Record<string, unknown>,
    context?: DispatchContext
  ): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Thread context as HTTP headers
    if (context?.agentId) headers['X-Agent-Id'] = context.agentId;
    if (context?.runId) headers['X-Run-Id'] = context.runId;
    if (context?.parentCallId) headers['X-Parent-Call-Id'] = context.parentCallId;
    if (context?.scope) headers['X-Scope'] = context.scope;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);

    try {
      const res = await fetch(`${this.daemonUrl}/call`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ tool: name, arguments: args }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      const data = await res.json() as Record<string, unknown>;

      // Convert StatusEnvelope back to ToolResult
      if (data.status === 'error') {
        return {
          content: [{ type: 'text', text: JSON.stringify({
            error: data.error || 'Daemon returned error',
            code: data.code,
          }) }],
          isError: true,
        };
      }

      // Success — strip the status field and return the rest as JSON text
      const { status: _status, ...result } = data;
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
