// ============================================================================
// FacadeClient — agent-facing SDK for Decibel Tools
// ============================================================================
// Replaces raw MCP tool calls with facade-aware dispatch.
// Used by decibel-agent's McpToolRouter and any headless agent.
//
// Usage:
//   const client = new FacadeClient({
//     command: 'node', args: ['dist/server.js'],
//     agentId: 'cymoril', projectId: 'my-project',
//     allowedFacades: ['sentinel', 'architect', 'git'],
//   });
//   await client.connect();
//   const epics = await client.call('sentinel', 'list_epics');
//   await client.disconnect();
// ============================================================================

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import type { FacadeClientConfig, CallContext, BatchCall, BatchResult } from './types.js';
import {
  StdioTransport,
  HttpTransport,
  BridgeTransport,
  type ClientTransport,
} from './transports.js';

const MAX_BATCH_SIZE = 20;

export class FacadeClient {
  private transport: ClientTransport | null = null;
  private config: FacadeClientConfig;
  private connecting: Promise<void> | null = null;
  private log: (msg: string) => void;

  readonly events = new EventEmitter();

  constructor(config: FacadeClientConfig) {
    this.config = config;
    this.log = config.logger ?? (() => {});

    // Validate config: need at least one transport option
    if (!config.command && !config.daemonUrl) {
      throw new Error(
        'FacadeClient requires either `command` (stdio) or `daemonUrl` (HTTP) in config'
      );
    }
  }

  /**
   * Connect to the MCP server. Also called lazily on first call().
   */
  async connect(): Promise<void> {
    if (this.transport?.isConnected()) return;

    // Prevent concurrent connect races
    if (this.connecting) return this.connecting;

    this.connecting = this.doConnect();
    try {
      await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  /**
   * Disconnect and clean up the child process / connection.
   */
  async disconnect(): Promise<void> {
    if (this.transport) {
      await this.transport.disconnect();
      this.transport = null;
    }
  }

  /**
   * Call a facade action.
   *
   * @param context  Per-call context that overrides config-level defaults.
   *
   * @example
   *   const epics = await client.call('sentinel', 'list_epics');
   *   const issue = await client.call('sentinel', 'create_issue', { title: 'Fix login' });
   *   const scoped = await client.call('sentinel', 'list_epics', {}, { scope: 'portfolio' });
   */
  async call<T = unknown>(
    facade: string,
    action: string,
    params?: Record<string, unknown>,
    context?: CallContext,
  ): Promise<T> {
    // Enforce allowlist
    if (this.config.allowedFacades && !this.config.allowedFacades.includes(facade)) {
      throw new Error(
        `Facade "${facade}" not in allowed scope. Allowed: [${this.config.allowedFacades.join(', ')}]`
      );
    }

    // Lazy connect
    await this.connect();

    // Build args: facade dispatch expects { action, ...params }
    const args: Record<string, unknown> = { action, ...params };

    // Resolve effective scope: per-call > config-level
    const effectiveScope = context?.scope ?? this.config.projectId;

    // Auto-inject project_id from effective scope if not already provided
    if (effectiveScope && !args.project_id) {
      args.project_id = effectiveScope;
    }

    // Generate request correlation ID
    const requestId = randomUUID();

    // Thread DispatchContext via _meta (MCP convention)
    // Per-call context merges with and overrides config-level defaults
    args._meta = {
      agentId: context?.agentId ?? this.config.agentId,
      scope: effectiveScope,
      runId: context?.runId,
      engagementMode: context?.engagementMode,
      userKey: context?.userKey,
      requestId,
    };

    this.log(`call ${facade}.${action} (req=${requestId.slice(0, 8)})`);

    const startTime = Date.now();
    try {
      const result = await this.transport!.call(facade, args);
      const duration = Date.now() - startTime;

      this.events.emit('result', { facade, action, duration_ms: duration, success: true, requestId });
      return result as T;
    } catch (err) {
      const duration = Date.now() - startTime;
      const message = err instanceof Error ? err.message : String(err);

      this.events.emit('error', { facade, action, duration_ms: duration, error: message, requestId });

      // Try to parse structured error from the server
      if ((err as { isCallError?: boolean }).isCallError && (err as { raw?: string }).raw) {
        try {
          const parsed = JSON.parse((err as { raw: string }).raw);
          throw new Error(parsed.error || parsed.message || message);
        } catch (parseErr) {
          if (parseErr instanceof SyntaxError) throw new Error(message);
          throw parseErr;
        }
      }

      throw new Error(message);
    }
  }

  /**
   * Batch multiple facade calls (max 20, parallel execution).
   *
   * @param context  Batch-level context applied to all calls.
   *   Individual BatchCall.context merges with (and overrides) this.
   *
   * For HTTP transport, uses the daemon's /batch endpoint directly.
   * For stdio transport, runs calls in parallel via Promise.all.
   */
  async batch(calls: BatchCall[], context?: CallContext): Promise<BatchResult[]> {
    if (calls.length === 0) return [];
    if (calls.length > MAX_BATCH_SIZE) {
      throw new Error(`Batch size ${calls.length} exceeds maximum of ${MAX_BATCH_SIZE}`);
    }

    // Enforce allowlist on all calls before dispatching
    if (this.config.allowedFacades) {
      for (const c of calls) {
        if (!this.config.allowedFacades.includes(c.facade)) {
          throw new Error(
            `Facade "${c.facade}" not in allowed scope. Allowed: [${this.config.allowedFacades.join(', ')}]`
          );
        }
      }
    }

    await this.connect();

    // Resolve effective batch-level context (per-batch > config defaults)
    const effectiveScope = context?.scope ?? this.config.projectId;
    const effectiveAgentId = context?.agentId ?? this.config.agentId;

    // Try native /batch endpoint for HTTP transport
    const httpTransport = this.getHttpTransport();
    if (httpTransport) {
      this.log(`batch (HTTP) — ${calls.length} calls`);
      const httpContext = {
        agentId: effectiveAgentId,
        scope: effectiveScope,
        runId: context?.runId,
        engagementMode: context?.engagementMode,
        userKey: context?.userKey,
        requestId: randomUUID(),
      };

      // Inject project_id into each call's params
      const enrichedCalls = calls.map(c => {
        const callScope = c.context?.scope ?? effectiveScope;
        return {
          facade: c.facade,
          action: c.action,
          params: {
            ...c.params,
            ...(callScope && !c.params?.project_id
              ? { project_id: callScope }
              : {}),
          },
        };
      });

      const result = await httpTransport.batch(enrichedCalls, httpContext);
      return result as BatchResult[];
    }

    // Stdio fallback: parallel Promise.all (each call gets its own requestId via call())
    this.log(`batch (stdio) — ${calls.length} calls`);
    const results = await Promise.all(
      calls.map(async (c): Promise<BatchResult> => {
        const start = Date.now();
        // Per-call context merges: call-level > batch-level > config
        const callCtx = c.context
          ? { ...context, ...c.context }
          : context;
        try {
          const data = await this.call(c.facade, c.action, c.params, callCtx);
          return {
            facade: c.facade,
            action: c.action,
            data,
            duration_ms: Date.now() - start,
          };
        } catch (err) {
          return {
            facade: c.facade,
            action: c.action,
            error: err instanceof Error ? err.message : String(err),
            duration_ms: Date.now() - start,
          };
        }
      }),
    );

    return results;
  }

  /** Whether the client is currently connected */
  get isConnected(): boolean {
    return this.transport?.isConnected() ?? false;
  }

  /** Current transport mode for diagnostics */
  get mode(): string {
    if (!this.transport) return 'disconnected';
    if (this.transport instanceof BridgeTransport) {
      return `bridge:${this.transport.mode}`;
    }
    if (this.transport instanceof HttpTransport) return 'http';
    return 'stdio';
  }

  // ============================================================================
  // Private
  // ============================================================================

  private async doConnect(): Promise<void> {
    const { command, args, env, cwd, daemonUrl, timeoutMs } = this.config;

    if (command && daemonUrl) {
      // Both provided → bridge mode
      this.transport = new BridgeTransport({
        daemonUrl,
        command,
        args,
        env,
        cwd,
        timeoutMs,
        logger: this.log,
      });
    } else if (daemonUrl) {
      // HTTP only
      this.transport = new HttpTransport({
        daemonUrl,
        timeoutMs,
        logger: this.log,
      });
    } else if (command) {
      // Stdio only
      this.transport = new StdioTransport({
        command,
        args,
        env,
        cwd,
        logger: this.log,
      });
    }

    await this.transport!.connect();
  }

  /** Get the HTTP transport if we're using one (for native /batch) */
  private getHttpTransport(): HttpTransport | null {
    if (this.transport instanceof HttpTransport) {
      return this.transport;
    }
    if (this.transport instanceof BridgeTransport) {
      return this.transport.httpTransport;
    }
    return null;
  }
}
