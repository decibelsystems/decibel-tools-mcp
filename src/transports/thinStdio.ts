// ============================================================================
// Thin Stdio Adapter — EPIC-0038 Phase 4
// ============================================================================
// A stdio MCP server that owns no runtime. Every tool call goes to the shared
// daemon; tool definitions come from it too. This process holds an MCP server,
// a URL, and a definitions cache — nothing else.
//
// WHY THIS EXISTS. `--bridge` already proxies calls to the daemon, but
// server.ts builds a full kernel before it picks a transport, so a bridge
// client still loads all 195 tool modules, its own registry and its own caches
// first. The memory is spent before the transport choice is made: six clients
// at ~110 MB each, five of them paying for a runtime they then forward past.
// Measured 663 MB across six processes on 2026-08-30.
//
// TWO THINGS THIS DELIBERATELY DOES NOT DO:
//
//   1. It does not fall back to local execution. BridgeAdapter catches a proxy
//      failure, flips itself to "daemon down" and dispatches locally instead —
//      for every call, including writes. One transient blip demotes the client
//      to a second writer until the next health check thirty seconds later,
//      which is exactly the invariant the shared runtime exists to hold. Here
//      a failed call retries through ensureRuntime (which will start a daemon
//      if none is serving) and then fails with an actionable error. A proxy
//      that quietly becomes a writer is worse than a proxy that stops.
//
//   2. It does not assume the daemon it reached is the daemon it started with.
//      A daemon can restart under a long-lived client — a version bump, a
//      crash-loop reset, an operator restart. ensureRuntime re-verifies the
//      protocol on every recovery, so a client that wakes up talking to an
//      incompatible runtime learns that instead of failing obscurely.
// ============================================================================

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { log } from '../config.js';
import type { ToolKernel, DispatchContext } from '../kernel.js';
import type { McpToolDefinition, DetailTier } from '../facades/types.js';
import type { TransportAdapter, TransportConfig } from './types.js';
import { ensureRuntime, type RuntimeHandle } from '../runtime/ensureRuntime.js';
import { localJson, localRequest } from '../runtime/localHttp.js';
import { envelopeFailed } from '../lib/envelope.js';

const CALL_TIMEOUT_MS = 30_000;
const DEFINITIONS_TIMEOUT_MS = 10_000;

/** One retry through ensureRuntime is enough: either a runtime comes back or none will. */
const PROXY_ATTEMPTS = 2;

export class ThinStdioAdapter implements TransportAdapter {
  readonly name = 'thin-stdio';
  private server: Server | null = null;
  private runtime: RuntimeHandle | null = null;
  private readonly definitions = new Map<DetailTier, McpToolDefinition[]>();
  private readonly explicitUrl?: string;

  constructor(explicitUrl?: string) {
    this.explicitUrl = explicitUrl;
  }

  async start(_kernel: ToolKernel | null, config: TransportConfig): Promise<void> {
    // Acquire a runtime BEFORE announcing readiness on stdio. A client that
    // completes the MCP handshake and then fails every call is worse than one
    // that fails to start, because the failure surfaces as a broken tool
    // rather than a broken connection.
    this.runtime = await this.acquireRuntime(config);
    log(`Thin stdio: runtime at ${this.runtime.url} (pid ${this.runtime.pid}, v${this.runtime.version}, spawned=${this.runtime.spawned})`);

    await this.loadDefinitions('full');

    this.server = new Server(
      { name: '@decibelsystems/tools', version: this.runtime.version },
      { capabilities: { tools: {} } }
    );

    this.server.setRequestHandler(ListToolsRequestSchema, async (request) => {
      const meta = (request.params as Record<string, unknown> | undefined)?._meta as Record<string, unknown> | undefined;
      const tier = (meta?.detailTier as DetailTier) || 'full';
      return { tools: await this.loadDefinitions(tier) };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const meta = (request.params as Record<string, unknown>)._meta as Record<string, unknown> | undefined;
      const context: DispatchContext | undefined = meta ? {
        agentId: meta.agentId as string | undefined,
        runId: meta.runId as string | undefined,
        parentCallId: meta.parentCallId as string | undefined,
        scope: meta.scope as string | undefined,
        requestId: meta.requestId as string | undefined,
      } : undefined;

      return this.call(name, (args || {}) as Record<string, unknown>, context);
    });

    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    log('Thin stdio: MCP server running — no local runtime in this process');
  }

  async stop(): Promise<void> {
    if (this.server) {
      await this.server.close();
      this.server = null;
    }
  }

  // ==========================================================================
  // Private
  // ==========================================================================

  private async acquireRuntime(config: TransportConfig): Promise<RuntimeHandle> {
    if (this.explicitUrl) {
      // An explicit URL means the operator is pointing at a runtime they
      // manage. Probe it, but never spawn one behind their back.
      const port = Number(new URL(this.explicitUrl).port) || 4888;
      return ensureRuntime({ port, autoStart: false });
    }
    return ensureRuntime({ port: config.port });
  }

  /**
   * Tool definitions come from the runtime, which is what lets this process
   * skip building a kernel. Cached per tier — definitions change only when the
   * runtime does, and a runtime swap re-runs start().
   */
  private async loadDefinitions(tier: DetailTier): Promise<McpToolDefinition[]> {
    const cached = this.definitions.get(tier);
    if (cached) return cached;

    const runtime = this.runtime;
    if (!runtime) throw new Error('Thin stdio: no runtime acquired');

    // Status before body. A runtime too old to serve this endpoint answers 404,
    // possibly with an HTML error page; parsing first turned that into a JSON
    // parse error instead of the actionable message below.
    const res = await localRequest(`${runtime.url}/mcp/tools?tier=${tier}`, {
      timeoutMs: DEFINITIONS_TIMEOUT_MS,
    });

    if (res.status === 404) {
      // Belt and braces: the protocol handshake should already have refused a
      // runtime too old to serve this. Reaching here means a runtime reported a
      // protocol it does not actually implement.
      throw new Error(
        `runtime at ${runtime.url} has no /mcp/tools endpoint despite reporting protocol ` +
        `${runtime.protocolVersion} — restart it with \`decibel-tools --daemon\` so it matches this client`
      );
    }

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(res.text) as Record<string, unknown>;
    } catch {
      throw new Error(
        `runtime returned no tool definitions (${res.status}): ${res.text.slice(0, 200)}`
      );
    }

    if (envelopeFailed(body) || !Array.isArray(body.tools)) {
      throw new Error(`runtime returned no tool definitions (${res.status})`);
    }
    const tools = body.tools as McpToolDefinition[];
    this.definitions.set(tier, tools);
    log(`Thin stdio: loaded ${tools.length} tool definitions (tier=${tier}) from the runtime`);
    return tools;
  }

  private async call(
    name: string,
    args: Record<string, unknown>,
    context?: DispatchContext
  ): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
    let lastError = '';

    for (let attempt = 1; attempt <= PROXY_ATTEMPTS; attempt++) {
      try {
        return await this.proxyCall(name, args, context);
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        log(`Thin stdio: call ${name} failed (attempt ${attempt}/${PROXY_ATTEMPTS}): ${lastError}`);

        if (attempt < PROXY_ATTEMPTS) {
          // The runtime may have restarted or died. Re-acquire — ensureRuntime
          // starts one if none is serving and re-checks the protocol either
          // way — then try once more. Never run the tool in this process.
          try {
            this.runtime = await ensureRuntime({ port: this.runtime?.port });
            this.definitions.clear();
            log(`Thin stdio: reacquired runtime at ${this.runtime.url} (pid ${this.runtime.pid})`);
          } catch (reacquireErr) {
            lastError = reacquireErr instanceof Error ? reacquireErr.message : String(reacquireErr);
            break;
          }
        }
      }
    }

    return {
      content: [{ type: 'text', text: JSON.stringify({
        error: `Decibel runtime unavailable — "${name}" was not executed: ${lastError}`,
        tool: name,
        runtime_unavailable: true,
        hint: 'This client does not execute tools locally, by design: a proxy that quietly ' +
          'becomes a second writer defeats the single-runtime invariant. Start the runtime ' +
          'with `decibel-tools --daemon` and check ~/.decibel/logs/daemon.log.',
      }) }],
      isError: true,
    };
  }

  private async proxyCall(
    name: string,
    args: Record<string, unknown>,
    context?: DispatchContext
  ): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
    const runtime = this.runtime;
    if (!runtime) throw new Error('no runtime acquired');

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (context?.agentId) headers['X-Agent-Id'] = context.agentId;
    if (context?.runId) headers['X-Run-Id'] = context.runId;
    if (context?.parentCallId) headers['X-Parent-Call-Id'] = context.parentCallId;
    if (context?.scope) headers['X-Scope'] = context.scope;
    if (context?.requestId) headers['X-Request-Id'] = context.requestId;

    const res = await localJson<Record<string, unknown>>(`${runtime.url}/call`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ tool: name, arguments: args }),
      timeoutMs: CALL_TIMEOUT_MS,
    });
    const data = res.body;

    if (envelopeFailed(data)) {
      return {
        content: [{ type: 'text', text: JSON.stringify({
          error: data.error || 'Runtime returned an error',
          code: data.code,
        }) }],
        isError: true,
      };
    }

    // Strip the envelope, keep the payload. `status` needs care: dropping it
    // unconditionally deletes the domain value from every record that has one
    // — the same bug fixed in the client SDK's HTTP transport in #55, still
    // present in BridgeAdapter. Only the literal envelope marker is envelope.
    const { ok: _ok, ...result } = data;
    if (result.status === 'executed') delete result.status;

    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }
}
