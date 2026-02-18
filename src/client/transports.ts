// ============================================================================
// Client Transports
// ============================================================================
// Transport abstraction for FacadeClient. Two modes:
//   - StdioClientTransport: spawns MCP server as child process (like the VS Code ext)
//   - HttpClientTransport: calls daemon directly via fetch
//   - BridgeClientTransport: tries HTTP first, falls back to stdio
// ============================================================================

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport as McpStdioTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const DAEMON_PROBE_TIMEOUT_MS = 3_000;

// ============================================================================
// Transport Interface
// ============================================================================

export interface ClientTransport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  call(name: string, args: Record<string, unknown>): Promise<unknown>;
  isConnected(): boolean;
}

// ============================================================================
// Stdio Transport — spawns MCP server as child process
// ============================================================================

export interface StdioTransportConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  logger?: (msg: string) => void;
}

export class StdioTransport implements ClientTransport {
  private client: Client | null = null;
  private transport: McpStdioTransport | null = null;
  private readonly config: StdioTransportConfig;
  private connected = false;

  constructor(config: StdioTransportConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    this.transport = new McpStdioTransport({
      command: this.config.command,
      args: this.config.args,
      cwd: this.config.cwd,
      env: {
        ...process.env as Record<string, string>,
        ...this.config.env,
      },
    });

    this.client = new Client({
      name: 'decibel-facade-client',
      version: '1.0.0',
    });

    this.transport.onerror = (err) => {
      this.config.logger?.(`Stdio transport error: ${err.message}`);
    };

    await this.client.connect(this.transport);
    this.connected = true;
    this.config.logger?.('Stdio transport connected');
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    if (this.transport) {
      await this.transport.close();
      this.transport = null;
    }
    this.client = null;
  }

  async call(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.client) {
      throw new Error('Stdio transport not connected');
    }

    const result = await this.client.callTool({ name, arguments: args });

    if (result.isError) {
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? '{}';
      throw Object.assign(new Error(text), { isCallError: true, raw: text });
    }

    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text;
    if (!text) {
      throw new Error(`Empty response from ${name}`);
    }

    return JSON.parse(text);
  }

  isConnected(): boolean {
    return this.connected;
  }
}

// ============================================================================
// HTTP Transport — calls daemon directly via fetch
// ============================================================================

export interface HttpTransportConfig {
  daemonUrl: string;
  timeoutMs?: number;
  logger?: (msg: string) => void;
}

export class HttpTransport implements ClientTransport {
  private readonly url: string;
  private readonly timeoutMs: number;
  private readonly logger?: (msg: string) => void;
  private alive = false;

  constructor(config: HttpTransportConfig) {
    this.url = config.daemonUrl.replace(/\/$/, '');
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.logger = config.logger;
  }

  async connect(): Promise<void> {
    this.alive = await this.probe();
    if (!this.alive) {
      throw new Error(`Daemon not reachable at ${this.url}`);
    }
    this.logger?.(`HTTP transport connected to ${this.url}`);
  }

  async disconnect(): Promise<void> {
    this.alive = false;
  }

  async call(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.alive) {
      throw new Error('HTTP transport not connected');
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Thread context via headers (matches bridge.ts pattern)
    const meta = args._meta as Record<string, unknown> | undefined;
    if (meta?.agentId) headers['X-Agent-Id'] = meta.agentId as string;
    if (meta?.runId) headers['X-Run-Id'] = meta.runId as string;
    if (meta?.scope) headers['X-Scope'] = meta.scope as string;
    if (meta?.engagementMode) headers['X-Engagement-Mode'] = meta.engagementMode as string;
    if (meta?.userKey) headers['X-User-Key'] = meta.userKey as string;
    if (meta?.requestId) headers['X-Request-Id'] = meta.requestId as string;

    // Strip _meta from the args sent to daemon (it uses headers)
    const { _meta: _stripped, ...callArgs } = args;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(`${this.url}/call`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ tool: name, arguments: callArgs }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      const data = await res.json() as Record<string, unknown>;

      if (data.status === 'error') {
        throw Object.assign(
          new Error((data.error as string) || 'Daemon returned error'),
          { isCallError: true, code: data.code, raw: JSON.stringify(data) }
        );
      }

      // Strip status envelope, return the payload
      const { status: _status, ...result } = data;
      return result;
    } finally {
      clearTimeout(timeout);
    }
  }

  isConnected(): boolean {
    return this.alive;
  }

  /** Batch call via daemon's /batch endpoint */
  async batch(
    calls: Array<{ facade: string; action: string; params?: Record<string, unknown> }>,
    context?: {
      agentId?: string; runId?: string; scope?: string;
      engagementMode?: string; userKey?: string; requestId?: string;
    },
  ): Promise<unknown> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (context?.agentId) headers['X-Agent-Id'] = context.agentId;
    if (context?.runId) headers['X-Run-Id'] = context.runId;
    if (context?.scope) headers['X-Scope'] = context.scope;
    if (context?.engagementMode) headers['X-Engagement-Mode'] = context.engagementMode;
    if (context?.userKey) headers['X-User-Key'] = context.userKey;
    if (context?.requestId) headers['X-Request-Id'] = context.requestId;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(`${this.url}/batch`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ calls, context }),
        signal: controller.signal,
      });

      clearTimeout(timeout);
      return await res.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  private async probe(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DAEMON_PROBE_TIMEOUT_MS);
      const res = await fetch(`${this.url}/health`, { signal: controller.signal });
      clearTimeout(timeout);
      return res.ok;
    } catch {
      return false;
    }
  }
}

// ============================================================================
// Bridge Transport — HTTP first, stdio fallback
// ============================================================================

export interface BridgeTransportConfig {
  /** Daemon URL to try first */
  daemonUrl: string;
  /** Stdio fallback config */
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  timeoutMs?: number;
  logger?: (msg: string) => void;
}

export class BridgeTransport implements ClientTransport {
  private http: HttpTransport;
  private stdio: StdioTransport;
  private activeTransport: 'http' | 'stdio' | null = null;
  private readonly logger?: (msg: string) => void;

  constructor(config: BridgeTransportConfig) {
    this.logger = config.logger;

    this.http = new HttpTransport({
      daemonUrl: config.daemonUrl,
      timeoutMs: config.timeoutMs,
      logger: config.logger,
    });

    this.stdio = new StdioTransport({
      command: config.command,
      args: config.args,
      env: config.env,
      cwd: config.cwd,
      logger: config.logger,
    });
  }

  async connect(): Promise<void> {
    // Try HTTP (daemon) first
    try {
      await this.http.connect();
      this.activeTransport = 'http';
      this.logger?.('Bridge: connected via HTTP (daemon)');
      return;
    } catch {
      this.logger?.('Bridge: daemon not available, falling back to stdio');
    }

    // Fall back to stdio
    await this.stdio.connect();
    this.activeTransport = 'stdio';
    this.logger?.('Bridge: connected via stdio (local)');
  }

  async disconnect(): Promise<void> {
    if (this.activeTransport === 'http') {
      await this.http.disconnect();
    } else if (this.activeTransport === 'stdio') {
      await this.stdio.disconnect();
    }
    this.activeTransport = null;
  }

  async call(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (this.activeTransport === 'http') {
      try {
        return await this.http.call(name, args);
      } catch (err) {
        // If the daemon went down mid-session, fail over to stdio
        if (!(err as { isCallError?: boolean }).isCallError) {
          this.logger?.(`Bridge: HTTP call failed (${err instanceof Error ? err.message : err}), switching to stdio`);
          try {
            if (!this.stdio.isConnected()) {
              await this.stdio.connect();
            }
            this.activeTransport = 'stdio';
            return await this.stdio.call(name, args);
          } catch (stdioErr) {
            throw stdioErr;
          }
        }
        throw err;
      }
    }

    if (!this.activeTransport) {
      throw new Error('Bridge transport not connected');
    }

    return this.stdio.call(name, args);
  }

  isConnected(): boolean {
    return this.activeTransport !== null;
  }

  /** Expose active mode for diagnostics */
  get mode(): 'http' | 'stdio' | null {
    return this.activeTransport;
  }

  /** Access underlying HTTP transport for batch calls */
  get httpTransport(): HttpTransport | null {
    return this.activeTransport === 'http' ? this.http : null;
  }
}
