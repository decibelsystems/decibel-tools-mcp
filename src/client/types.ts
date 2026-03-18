// ============================================================================
// FacadeClient Types
// ============================================================================
// Shared types for the agent-facing facade client SDK.
// Consumed by decibel-agent's McpToolRouter and any headless agent.
// ============================================================================

/**
 * Configuration for FacadeClient.
 * Provide either stdio (command) or HTTP (daemonUrl) or both (bridge).
 */
export interface FacadeClientConfig {
  /** Stdio: command to spawn MCP server (e.g. 'node') */
  command?: string;
  /** Stdio: args for the command (e.g. ['dist/server.js']) */
  args?: string[];
  /** Stdio: extra env vars for the child process */
  env?: Record<string, string>;
  /** Stdio: working directory for the child process */
  cwd?: string;

  /** HTTP: daemon URL (e.g. 'http://localhost:4888') */
  daemonUrl?: string;

  /** Auto-injected into every call as agentId */
  agentId?: string;
  /** Auto-injected into every call as project_id */
  projectId?: string;

  /** Restrict dispatch to these facades only */
  allowedFacades?: string[];

  /** Timeout in ms for individual calls (default: 30000) */
  timeoutMs?: number;

  /** Logger (defaults to no-op) */
  logger?: (msg: string) => void;
}

export interface CallResult<T = unknown> {
  data: T;
  isError: false;
}

export interface CallError {
  error: string;
  code?: string;
  isError: true;
}

export type FacadeResponse<T = unknown> = CallResult<T> | CallError;

/**
 * Per-call context that overrides config-level defaults.
 * Threaded via _meta in MCP args, or via HTTP headers on HttpTransport.
 */
export interface CallContext {
  /** Project ID or 'portfolio' — overrides config.projectId for this call */
  scope?: string;
  /** Override config-level agentId for this call */
  agentId?: string;
  /** Trace correlation — vector run ID */
  runId?: string;
  /** Engagement mode: 'suggest' | 'curate' | 'compose' */
  engagementMode?: string;
  /** Identity of the calling user */
  userKey?: string;
}

export interface BatchCall {
  facade: string;
  action: string;
  params?: Record<string, unknown>;
  /** Per-call context (merged with batch-level context if both provided) */
  context?: CallContext;
}

export interface BatchResult {
  facade: string;
  action: string;
  data?: unknown;
  error?: string;
  duration_ms: number;
}
