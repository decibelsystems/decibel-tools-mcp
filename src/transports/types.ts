// ============================================================================
// Transport Adapter Interface
// ============================================================================
// All transports implement this interface so server.ts can start any
// combination without knowing transport internals.
// ============================================================================

import type { ToolKernel } from '../kernel.js';

/**
 * Configuration shared across all transports.
 * Each adapter uses what it needs and ignores the rest.
 */
export interface TransportConfig {
  // HTTP-specific
  port?: number;
  host?: string;
  authToken?: string;
  sseKeepaliveMs?: number;
  timeoutMs?: number;
  retryIntervalMs?: number;
}

/**
 * A transport adapter knows how to expose the kernel to a specific protocol.
 * Adapters are self-contained: they create their own MCP Server, connect
 * their own transport, and manage their own lifecycle.
 */
export interface TransportAdapter {
  readonly name: string;
  start(kernel: ToolKernel, config: TransportConfig): Promise<void>;
  stop(): Promise<void>;
}
