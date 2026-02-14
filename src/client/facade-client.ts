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
import type { FacadeClientConfig, BatchCall, BatchResult } from './types.js';
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
   * @example
   *   const epics = await client.call('sentinel', 'list_epics');
   *   const issue = await client.call('sentinel', 'create_issue', { title: 'Fix login' });
   */
  async call<T = unknown>(
    facade: string,
    action: string,
    params?: Record<string, unknown>,
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

    // Auto-inject project_id from config if not already provided
    if (this.config.projectId && !args.project_id) {
      args.project_id = this.config.projectId;
    }

    // Thread DispatchContext via _meta (MCP convention)
    if (this.config.agentId || this.config.projectId) {
      args._meta = {
        agentId: this.config.agentId,
        scope: this.config.projectId,
      };
    }

    this.log(`call ${facade}.${action}`);

    const startTime = Date.now();
    try {
      const result = await this.transport!.call(facade, args);
      const duration = Date.now() - startTime;

      this.events.emit('result', { facade, action, duration_ms: duration, success: true });
      return result as T;
    } catch (err) {
      const duration = Date.now() - startTime;
      const message = err instanceof Error ? err.message : String(err);

      this.events.emit('error', { facade, action, duration_ms: duration, error: message });

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
   * For HTTP transport, uses the daemon's /batch endpoint directly.
   * For stdio transport, runs calls in parallel via Promise.all.
   */
  async batch(calls: BatchCall[]): Promise<BatchResult[]> {
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

    // Try native /batch endpoint for HTTP transport
    const httpTransport = this.getHttpTransport();
    if (httpTransport) {
      this.log(`batch (HTTP) — ${calls.length} calls`);
      const context = {
        agentId: this.config.agentId,
        scope: this.config.projectId,
      };

      // Inject project_id into each call's params
      const enrichedCalls = calls.map(c => ({
        ...c,
        params: {
          ...c.params,
          ...(this.config.projectId && !c.params?.project_id
            ? { project_id: this.config.projectId }
            : {}),
        },
      }));

      const result = await httpTransport.batch(enrichedCalls, context);
      return result as BatchResult[];
    }

    // Stdio fallback: parallel Promise.all
    this.log(`batch (stdio) — ${calls.length} calls`);
    const results = await Promise.all(
      calls.map(async (c): Promise<BatchResult> => {
        const start = Date.now();
        try {
          const data = await this.call(c.facade, c.action, c.params);
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
