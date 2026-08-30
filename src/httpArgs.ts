// ============================================================================
// HTTP transport argument parsing
// ============================================================================
// Lives apart from httpServer.ts on purpose. Every mode must parse argv —
// including the thin client, which owns no runtime. Leaving this function in
// httpServer.ts meant importing it dragged in the whole HTTP server and, behind
// it, the tool graph: a thin client paid ~50 MB to read `--port`. Nothing here
// imports anything.
// ============================================================================

export interface HttpArgs {
  httpMode: boolean;
  port?: number;
  authToken?: string;
  host?: string;
  sseKeepaliveMs?: number;
  timeoutMs?: number;
  retryIntervalMs?: number;
}

export function parseHttpArgs(args: string[]): HttpArgs {
  const httpMode = args.includes('--http');
  const portIndex = args.indexOf('--port');
  // --port flag wins; else honor PORT env (Render sets it); else leave undefined
  // so daemonConfig's default (4888) applies downstream instead of being
  // short-circuited by a baked-in default here. See server.ts port/host resolution.
  const port = portIndex !== -1
    ? parseInt(args[portIndex + 1], 10)
    : process.env.PORT
      ? parseInt(process.env.PORT, 10)
      : undefined;

  // SECURITY: Prefer env var for auth token (CLI args visible in ps/history)
  // Fall back to --auth-token for backwards compatibility
  const authIndex = args.indexOf('--auth-token');
  const authToken = process.env.DECIBEL_AUTH_TOKEN ||
    (authIndex !== -1 ? args[authIndex + 1] : undefined);

  const hostIndex = args.indexOf('--host');
  // --host flag wins; else leave undefined so daemonConfig host (127.0.0.1, daemon
  // mode) or the transport default applies instead of being short-circuited here.
  const host = hostIndex !== -1 ? args[hostIndex + 1] : undefined;

  // SSE/Connection tuning arguments
  const keepaliveIndex = args.indexOf('--sse-keepalive');
  const sseKeepaliveMs = keepaliveIndex !== -1 ? parseInt(args[keepaliveIndex + 1], 10) : undefined;

  const timeoutIndex = args.indexOf('--timeout');
  const timeoutMs = timeoutIndex !== -1 ? parseInt(args[timeoutIndex + 1], 10) : undefined;

  const retryIndex = args.indexOf('--sse-retry');
  const retryIntervalMs = retryIndex !== -1 ? parseInt(args[retryIndex + 1], 10) : undefined;

  return { httpMode, port, authToken, host, sseKeepaliveMs, timeoutMs, retryIntervalMs };
}
