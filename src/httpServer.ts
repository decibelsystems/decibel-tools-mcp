/**
 * HTTP Server Mode for Decibel MCP
 *
 * Exposes the MCP server over HTTP for remote access (e.g., ChatGPT, external agents).
 *
 * Usage:
 *   node dist/server.js --http --port 8787
 *   node dist/server.js --http --port 8787 --auth-token YOUR_SECRET
 *
 * Endpoints:
 *   GET  /health              - Health check
 *   GET  /tools               - List available tools
 *   POST /call                - Execute any tool: { tool: string, arguments: object }
 *   POST /dojo/wish           - Shorthand for dojo_add_wish
 *   POST /dojo/propose        - Shorthand for dojo_create_proposal
 *   POST /dojo/scaffold       - Shorthand for dojo_scaffold_experiment
 *   POST /dojo/run            - Shorthand for dojo_run_experiment
 *   POST /dojo/results        - Shorthand for dojo_get_results
 *   POST /dojo/artifact       - Shorthand for dojo_read_artifact
 *   GET  /dojo/list           - Shorthand for dojo_list
 *   POST /mcp                 - Full MCP protocol endpoint
 *
 * All responses use status envelope:
 *   { "status": "executed", ...data }
 *   { "status": "error", "error": "...", "code": "..." }
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { timingSafeEqual, randomBytes } from 'crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { log } from './config.js';
import { writeLocalAgentSession } from './agentPresence.js';
import {
  drainCommands,
  setSessionToken,
  getSessionToken,
  dropSessionToken,
  ackOwnerOf,
  clearAckOwner,
} from './agentInbox.js';
import { settleCommandFromAck, ORG_ID } from './agentCommands.js';
import { isSupabaseConfigured, getSupabaseServiceClient } from './lib/supabase.js';
import { shouldQueueForAgent, parseToolCall } from './httpQueueDetection.js';
import type { ToolKernel, DispatchContext, DispatchEvent } from './kernel.js';
import { getLicenseValidator } from './license.js';
import { listProjects } from './projectRegistry.js';
import type { AgentRegistry } from './daemon.js';
import { setDaemonPort } from './daemon.js';
import type { DaemonConfig } from './daemonConfig.js';
import { RUNTIME_PROTOCOL_VERSION } from './runtime/protocol.js';
import type { DetailTier } from './facades/types.js';
import {
  wrapSuccess,
  wrapError,
  envelopeHttpStatus,
  type StatusEnvelope,
  type ErrorEnvelope,
} from './lib/envelope.js';
import {
  listEpics,
  listRepoIssues,
  isProjectResolutionError,
} from './tools/sentinel.js';
import {
  voiceInboxAdd,
  VoiceInboxAddInput,
} from './tools/voice.js';
import {
  generateImage,
  getImageStatus,
  GenerateImageInput,
  meshyGenerate,
  getMeshyStatus,
  meshyDownload,
  MeshyGenerateInput,
  tripoGenerate,
  getTripoStatus,
  tripoDownload,
  TripoGenerateInput,
  klingGenerateVideo,
  klingGenerateTextVideo,
  klingGenerateAvatar,
  getKlingStatus,
  KlingVideoInput,
  KlingAvatarInput,
  listTasks,
} from './tools/studio/index.js';

// Module-level references — set by startHttpServer()
let kernel: ToolKernel;
let landingPageHtml = '';
let startedAt: number = 0;
let sseConnectionCount = 0;
let agentRegistry: AgentRegistry | undefined;
let daemonConfig: DaemonConfig | undefined;
// Mirrored from startHttpServer options so module-scoped executeTool can reason
// about the connection's trust boundary (the 127.0.0.1 daemon bind vs a
// network-exposed --http server) and whether auth is enforced. Used by the
// queue-write authorization decoupling (principal, not label).
let serverIsDaemon = false;
let serverAuthToken: string | undefined;

// ============================================================================
// Security: Body Size Limit
// ============================================================================

const MAX_BODY_BYTES = 1_048_576; // 1MB

// ============================================================================
// Security: Rate Limiter
// ============================================================================

class RateLimiter {
  private windows = new Map<string, { count: number; start: number }>();
  private maxRpm: number;
  private agentLimits = new Map<string, number>();

  constructor(maxRpm: number) {
    this.maxRpm = maxRpm;
  }

  /** Returns true if the request should be allowed. Uses agent-scoped key when agentId is provided. */
  check(ip: string, agentId?: string): boolean {
    const key = agentId ? `agent:${agentId}` : `ip:${ip}`;
    const limit = agentId ? (this.agentLimits.get(agentId) ?? this.maxRpm) : this.maxRpm;
    const now = Date.now();
    const entry = this.windows.get(key);

    if (!entry || now - entry.start > 60_000) {
      this.windows.set(key, { count: 1, start: now });
      return true;
    }

    entry.count++;
    return entry.count <= limit;
  }

  /** Set a per-agent RPM override */
  setAgentLimit(agentId: string, rpm: number): void {
    this.agentLimits.set(agentId, rpm);
  }

  /** Update the max RPM (e.g. on config reload) */
  setMaxRpm(rpm: number): void {
    this.maxRpm = rpm;
  }

  /** Periodic cleanup of expired windows */
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.windows) {
      if (now - entry.start > 60_000) {
        this.windows.delete(key);
      }
    }
  }
}

// ============================================================================
// Security: Timing-Safe Token Comparison
// ============================================================================

function timingSafeTokenCompare(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'utf-8');
  const b = Buffer.from(expected, 'utf-8');
  if (a.length !== b.length) {
    // Still do a comparison to keep timing constant
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

/**
 * The connection's trust boundary for the /agents/* endpoints: ONLY a process on
 * this machine may register/poll/ack a local runtime (the 127.0.0.1 bind is the
 * principal — confused-deputy rule). We check the real socket peer address (not a
 * spoofable header). An EMPTY remoteAddress is rejected (was previously allowed) —
 * a genuine TCP loopback connection always presents 127.0.0.1/::1, so empty only
 * arises from a destroyed/odd socket and must not be treated as local.
 */
function isLocalAgentPeer(req: IncomingMessage): boolean {
  const peer = (req.socket.remoteAddress || '').replace('::ffff:', '');
  return peer === '127.0.0.1' || peer === '::1';
}

/**
 * Mint-or-return the per-session capability token (proof-of-possession the SDK must
 * present on poll/ack). Idempotent per session_key so a heartbeat keeps the token
 * stable; after a daemon restart the in-memory store is empty, so the next
 * register/heartbeat mints a fresh one and the SDK adopts it from the response.
 */
function ensureSessionToken(sessionKey: string): string {
  let token = getSessionToken(sessionKey);
  if (!token) {
    token = randomBytes(32).toString('hex');
    setSessionToken(sessionKey, token);
  }
  return token;
}

/**
 * True only for genuine localhost origins. Parses the Origin URL and compares the
 * HOST exactly (localhost / 127.0.0.1 / [::1]) — NOT a startsWith prefix, which
 * `https://localhost.evil.com` and `http://127.0.0.1.evil.com` both defeat.
 */
function isLocalhostOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
  } catch {
    return false;
  }
}

// ============================================================================
// Version Info
// ============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function getVersion(): { version: string; name: string } {
  try {
    // Try to read from package.json (works in both dev and prod)
    const pkgPath = join(__dirname, '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    return { version: pkg.version || '0.0.0', name: pkg.name || '@decibelsystems/tools' };
  } catch {
    return { version: '2.0.0', name: '@decibelsystems/tools' };
  }
}

const PKG = getVersion();

// ============================================================================
// Landing Page HTML
// ============================================================================

/**
 * Generate landing page HTML from facade definitions.
 */
function buildLandingPageHtml(_facades: { name: string; description: string; actions: string[] }[]): string {
  // Load full API docs from template (uses module-level __dirname)
  const templatePath = join(__dirname, '..', 'templates', 'docs.html');
  try {
    return readFileSync(templatePath, 'utf-8')
      .replace(/\{\{VERSION\}\}/g, PKG.version)
      .replace(/\{\{FACADE_COUNT\}\}/g, String(_facades.length))
      .replace(/\{\{TOOL_COUNT\}\}/g, String(_facades.reduce((s, f) => s + f.actions.length, 0)));
  } catch {
    return `<html><body><h1>Decibel Tools v${PKG.version}</h1><p>Docs template not found.</p></body></html>`;
  }
}

// ============================================================================
// Response Helpers
// ============================================================================

/**
 * Format milliseconds into human-readable uptime string.
 */
function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

/**
 * Send JSON response with status envelope
 */
function sendJson(res: ServerResponse, statusCode: number, data: StatusEnvelope): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

/**
 * Parse JSON body from request (with 1MB size limit)
 */
async function parseBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = '';
    let bytes = 0;
    req.on('data', (chunk: Buffer | string) => {
      bytes += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error('Request body too large (max 1MB)'));
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

// ============================================================================
// Tool Executor — unified dispatch through modular tool registry
// ============================================================================

/**
 * Execute any tool via the kernel's dispatch.
 * Extracts agent context from HTTP headers when present.
 */
async function executeTool(
  tool: string,
  args: Record<string, unknown>,
  req?: IncomingMessage,
  tierOverride?: 'core' | 'pro' | 'apps',
): Promise<StatusEnvelope> {
  try {
    // Extract agent context from HTTP headers
    const headerAgentId = req?.headers['x-agent-id'] as string | undefined;

    // Queue detection: if this is a write call from a remote agent, queue instead of execute.
    //
    // AUTHORIZATION DECOUPLING (sec review 2026-06-07, issue B / confused-deputy):
    // queueForAgent writes to agent_queue via SERVICE_ROLE (bypassing RLS) with
    // created_by = agentId. That is a PRIVILEGED side effect, so the agent identity
    // MUST come from an authenticated PRINCIPAL of the connection — never a
    // caller-supplied X-Agent-Id label (which anyone can set, and — via the
    // unauthenticated /connect — even pre-register, so registry membership is NOT
    // an authenticated identity). The trust boundary differs by mode:
    //   - localhost daemon (serverIsDaemon): the 127.0.0.1 bind IS the principal
    //     boundary — only local processes reach it. A local process naming an
    //     agent_id is acceptable for a local-sync write. Keep the known-agent check
    //     as defense-in-depth.
    //   - hosted/--http (network-exposed): the principal is the bound auth token.
    //     A queue write is allowed ONLY if the request authenticated (serverAuthToken
    //     set AND this request passed it — it reached here past the auth gate). With
    //     no auth token configured, there is NO authenticated principal, so refuse to
    //     do a service-role write on a spoofable label; fall through to normal
    //     dispatch (tier/facade checks) instead.
    const agentIsKnown =
      !!headerAgentId &&
      ((agentRegistry?.get(headerAgentId) !== undefined) ||
        daemonConfig?.agents?.[headerAgentId] !== undefined);
    const principalAuthorizesQueueWrite = serverIsDaemon
      ? agentIsKnown                       // local bind = principal; known-agent is DiD
      : !!serverAuthToken && agentIsKnown; // hosted: require an authenticated request
    if (headerAgentId && principalAuthorizesQueueWrite && shouldQueueForAgent(tool, args, headerAgentId)) {
      const parsed = parseToolCall(tool, args)!;
      const { action: _action, ...queueArgs } = args;
      return await queueForAgent(parsed.facade, parsed.action, queueArgs, headerAgentId, (args.projectId as string) || 'default');
    }

    // Resolve allowedFacades: header > agent registry > agent config > none
    let allowedFacades: string[] | undefined;
    const facadesHeader = req?.headers['x-allowed-facades'] as string | undefined;
    if (facadesHeader) {
      allowedFacades = facadesHeader.split(',').map(s => s.trim()).filter(Boolean);
    } else if (headerAgentId && agentRegistry) {
      const registeredAgent = agentRegistry.get(headerAgentId);
      if (registeredAgent?.allowedFacades) {
        allowedFacades = registeredAgent.allowedFacades;
      }
    }
    if (!allowedFacades && headerAgentId && daemonConfig?.agents?.[headerAgentId]?.allowed_facades) {
      allowedFacades = daemonConfig.agents[headerAgentId].allowed_facades;
    }

    const context: DispatchContext | undefined = req ? {
      agentId: headerAgentId,
      runId: req.headers['x-run-id'] as string | undefined,
      parentCallId: req.headers['x-parent-call-id'] as string | undefined,
      scope: req.headers['x-scope'] as string | undefined,
      engagementMode: req.headers['x-engagement-mode'] as string | undefined,
      userKey: req.headers['x-user-key'] as string | undefined,
      orgId: req.headers['x-org-key'] as string | undefined,
      requestId: req.headers['x-request-id'] as string | undefined,
      tier: tierOverride,
      allowedFacades,
    } : tierOverride ? { tier: tierOverride } : undefined;

    const toolResult = await kernel.dispatch(tool, args, context);
    const text = toolResult.content[0]?.text;

    if (toolResult.isError) {
      return wrapError(text || 'Tool execution failed', 'TOOL_ERROR');
    }

    // Parse the tool's payload, or carry it as prose when it isn't JSON.
    //
    // The prose branch is legitimate — some tools return markdown — but it used
    // to be indistinguishable from a data response that failed to parse. A
    // caller expecting `events` got an object with no `events` key, `ok: true`,
    // and no indication that anything unusual happened. That is how a
    // concatenated feedback prompt (fixed in tools/shared/response.ts) turned
    // one call in fifteen into a silent empty result for every HTTP consumer.
    // `payload_format` makes the two cases tellable apart.
    let result: Record<string, unknown>;
    if (text) {
      try {
        result = JSON.parse(text);
      } catch {
        log(`HTTP: tool ${tool} returned non-JSON text (${text.length} bytes) — carrying it as prose`);
        result = { message: text, payload_format: 'text' };
      }
    } else {
      result = { success: true };
    }

    return wrapSuccess(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (message.includes('Rate limit')) {
      return wrapError(message, 'RATE_LIMITED');
    }
    if (message.includes('Access denied')) {
      return wrapError(message, 'ACCESS_DENIED');
    }
    if (message.includes('not found')) {
      return wrapError(message, 'NOT_FOUND');
    }

    return wrapError(message, 'EXECUTION_ERROR');
  }
}

/**
 * Queue a write operation for later local sync instead of executing immediately.
 * Used when a remote agent calls a queueable write action.
 */
async function queueForAgent(
  facade: string,
  action: string,
  args: Record<string, unknown>,
  agentId: string,
  projectId: string,
): Promise<StatusEnvelope> {
  if (!isSupabaseConfigured()) {
    return wrapError('Agent queue requires Supabase configuration', 'QUEUE_UNAVAILABLE');
  }

  const supabase = getSupabaseServiceClient();

  const { data, error } = await supabase
    .from('agent_queue')
    .insert({
      project_id: projectId,
      facade,
      action,
      arguments: args,
      created_by: agentId,
    })
    .select('id')
    .single();

  if (error) {
    return wrapError(`Failed to queue: ${error.message}`, 'QUEUE_ERROR');
  }

  return {
    status: 'queued',
    ok: true,
    queue_id: data.id,
    message: 'Queued for local sync. Use agentic queue_status to check result.',
  };
}

/**
 * Get list of available facades — public API for tool discovery
 */
function getAvailableTools(): { name: string; description: string; actions: string[] }[] {
  return kernel.facades.map(f => ({
    name: f.name,
    description: f.description,
    actions: Object.keys(f.actions),
  }));
}

/**
 * OpenAI function calling format for a tool
 */
interface OpenAIFunction {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}

/**
 * Get tools in OpenAI function calling format (facade-based)
 */
function getOpenAITools(): OpenAIFunction[] {
  return kernel.getMcpToolDefinitions('full').map(def => ({
    type: 'function' as const,
    function: {
      name: def.name,
      description: def.description,
      parameters: {
        type: 'object' as const,
        properties: def.inputSchema.properties,
        required: def.inputSchema.required,
      },
    },
  }));
}

// ============================================================================
// License Tier Resolution
// ============================================================================

/**
 * Resolve the caller's license tier from the request.
 * - DECIBEL_PRO=1 env var → skip validation (dev mode)
 * - Authorization header with DCBL-XXXX key → validate via LicenseValidator
 * - No key → 'core' tier (only core facades)
 * - Config-level key → use that as default
 */
async function resolveTier(
  req: IncomingMessage,
  configLicenseKey?: string,
): Promise<'core' | 'pro' | 'apps'> {
  // Dev mode bypass — EXPLICIT opt-in only. Previously this also fired on
  // `NODE_ENV !== 'production'`, which fails OPEN: the default for
  // `node dist/server.js --http`, most containers, and Render/Heroku is an unset
  // NODE_ENV, so every unauthenticated hosted caller silently got 'pro'/'apps'.
  // The request-time tier boundary must fail CLOSED to 'core' unless an operator
  // explicitly opts in via DECIBEL_PRO=1. (Sec review 2026-06-04, ISS tier-gating.)
  if (process.env.DECIBEL_PRO === '1') {
    return 'pro';
  }

  // Extract license key from Authorization header (separate from auth token)
  // Format: X-License-Key: DCBL-XXXX-XXXX-XXXX
  const licenseHeader = req.headers['x-license-key'] as string | undefined;
  const key = licenseHeader || configLicenseKey;

  if (!key) return 'core';

  const validator = getLicenseValidator();
  const result = await validator.validate(key);
  return result.valid ? result.tier : 'core';
}

export interface HttpServerOptions {
  port: number;
  authToken?: string;
  host?: string;
  // SSE/Connection settings
  sseKeepaliveMs?: number;      // Heartbeat interval (default: 30000)
  timeoutMs?: number;            // Request timeout (default: 120000)
  retryIntervalMs?: number;      // SSE retry interval for clients (default: 3000)
  // Security settings
  rateLimitRpm?: number;         // Max requests per minute per IP (default: 100)
  isDaemon?: boolean;            // Running in daemon mode (affects CORS policy)
  // License
  configLicenseKey?: string;     // License key from config file (fallback)
  // Multi-agent
  agentRegistry?: AgentRegistry;
  daemonConfig?: DaemonConfig;
}

/**
 * Handle returned by startHttpServer for lifecycle management.
 * Used by the HttpAdapter to implement TransportAdapter.stop().
 */
export interface HttpServerHandle {
  stop(): Promise<void>;
}

/**
 * Start an HTTP server that handles MCP requests
 *
 * Note: This creates a single stateless transport. Each request is handled
 * independently. For full session support, this would need to be expanded.
 */
export async function startHttpServer(
  server: Server,
  kernelInstance: ToolKernel,
  options: HttpServerOptions
): Promise<HttpServerHandle> {
  const {
    port,
    authToken,
    host = '0.0.0.0',
    sseKeepaliveMs = 30000,     // Send keepalive every 30s
    timeoutMs = 120000,         // 2 minute default timeout
    retryIntervalMs = 3000,     // 3s retry for SSE clients
    rateLimitRpm = 100,         // 100 req/min per IP default
    isDaemon = false,
    configLicenseKey,
    agentRegistry: optAgentRegistry,
    daemonConfig: optDaemonConfig,
  } = options;

  // Set module-level references
  kernel = kernelInstance;
  startedAt = Date.now();
  agentRegistry = optAgentRegistry;
  daemonConfig = optDaemonConfig;
  serverIsDaemon = isDaemon;
  serverAuthToken = authToken;
  log(`HTTP: Using kernel with ${kernel.toolCount} tools`);

  // Rate limiter (clean up stale entries every 60s)
  const rateLimiter = new RateLimiter(rateLimitRpm);
  const rateLimiterCleanup = setInterval(() => rateLimiter.cleanup(), 60_000);

  // Apply per-agent rate limits from daemon config
  if (daemonConfig?.agents) {
    for (const [agentId, agentCfg] of Object.entries(daemonConfig.agents)) {
      if (agentCfg.rate_limit_rpm) {
        rateLimiter.setAgentLimit(agentId, agentCfg.rate_limit_rpm);
      }
    }
  }

  // Build landing page from actual tool list
  landingPageHtml = buildLandingPageHtml(getAvailableTools());

  // Create transport in STATELESS mode (better for ChatGPT compatibility)
  // Setting sessionIdGenerator to undefined disables session tracking
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // Stateless mode
    enableJsonResponse: true,      // Enable JSON fallback for non-streaming clients
    retryInterval: retryIntervalMs, // Tell clients how long to wait before retry
  });

  // Connect the MCP server to the transport
  await server.connect(transport);

  // Track active SSE connections for keepalive
  const activeSseConnections = new Set<ServerResponse>();

  // Track active in-flight requests for graceful shutdown
  const activeRequests = new Set<IncomingMessage>();

  // Start SSE keepalive heartbeat
  const keepaliveInterval = setInterval(() => {
    if (activeSseConnections.size > 0) {
      log(`SSE keepalive: pinging ${activeSseConnections.size} connection(s)`);
    }
    for (const res of activeSseConnections) {
      try {
        if (!res.writableEnded) {
          // Send SSE comment as keepalive (standard pattern)
          res.write(': keepalive\n\n');
        } else {
          activeSseConnections.delete(res);
        }
      } catch (e) {
        // Connection likely closed
        activeSseConnections.delete(res);
      }
    }
  }, sseKeepaliveMs);

  // Clean up on process exit
  process.on('SIGTERM', () => {
    clearInterval(keepaliveInterval);
  });

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const path = url.pathname;

    log(`HTTP: ${req.method} ${path}`);

    // CORS headers — /mcp needs '*' for ChatGPT; REST endpoints restrict to localhost in daemon mode
    const isMcpRoute = path === '/mcp' || path === '/sse' || path === '/sse/';
    if (isMcpRoute || !isDaemon) {
      res.setHeader('Access-Control-Allow-Origin', '*');
    } else {
      // Daemon mode: restrict REST endpoints to localhost origins.
      // EXACT host match — a prefix/startsWith check is bypassable by an attacker
      // origin like `https://localhost.evil.com` or `http://127.0.0.1.evil.com`
      // (both startWith an allowed value), which would let a malicious page read
      // localhost daemon data cross-origin. Parse the origin and compare host.
      const origin = req.headers.origin || '';
      if (!origin) {
        // Non-CORS (curl, same-origin) — no ACAO needed.
      } else if (isLocalhostOrigin(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
      }
      // else: untrusted origin → no ACAO header (browser blocks the read).
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id, Accept, X-Agent-Id, X-Run-Id, X-License-Key, X-Allowed-Facades, X-Scope, X-Request-Id, X-Parent-Call-Id, X-Engagement-Mode, X-User-Key, X-Org-Key');
    res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');

    // (a) Handle preflight OPTIONS requests
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // HOSTED FAIL-CLOSED, checked EARLY (before the rate limiter) so an
    // unauthenticated hosted caller can't consume/poison the rate-limit map or any
    // downstream state before being refused. Public infra routes stay open so
    // health/landing/discovery keep working; everything else needs auth in hosted
    // (--http) mode. (Sec review 2026-06-07; the main gate below still enforces the
    // token when one IS configured.)
    const PUBLIC_HOSTED_ROUTES = new Set([
      '/', '/health', '/ready', '/docs', '/tools', '/openapi.yaml', '/openapi.json',
      '/.well-known/oauth-authorization-server', '/.well-known/openid-configuration',
      '/oauth/authorize', '/oauth/token', '/oauth/register',
    ]);
    if (!isDaemon && !authToken && !PUBLIC_HOSTED_ROUTES.has(path)) {
      sendJson(res, 401, wrapError(
        'This endpoint requires authentication. Hosted (--http) mode must be started with DECIBEL_AUTH_TOKEN set.',
        'AUTH_NOT_CONFIGURED',
      ));
      return;
    }

    // Rate limiting (check before auth to prevent brute force)
    const clientIp = (req.socket.remoteAddress || '127.0.0.1').replace('::ffff:', '');
    const reqAgentId = req.headers['x-agent-id'] as string | undefined;
    if (!rateLimiter.check(clientIp, reqAgentId)) {
      log(`HTTP: Rate limited ${reqAgentId || clientIp}`);
      sendJson(res, 429, wrapError('Too many requests (rate limit exceeded)', 'RATE_LIMITED'));
      return;
    }

    // Implicit heartbeat: any authenticated request with X-Agent-Id keeps the agent alive
    if (reqAgentId && agentRegistry) {
      agentRegistry.heartbeat(reqAgentId);
    }

    // Track in-flight request
    activeRequests.add(req);
    res.on('finish', () => activeRequests.delete(req));
    res.on('close', () => activeRequests.delete(req));

    // (c) Root health check - GET / returns 200
    if (path === '/' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        name: PKG.name,
        version: PKG.version,
        api_version: 'v1',
      }));
      return;
    }

    // Health check at /health too
    if (path === '/health') {
      const uptimeMs = Date.now() - startedAt;
      // Determine pro status from config license key. Explicit opt-in only —
      // do NOT infer from NODE_ENV (fails open on hosted; see resolveTier).
      const proEnabled = process.env.DECIBEL_PRO === '1';
      let licenseTier: string = proEnabled ? 'pro' : 'core';
      if (configLicenseKey && !proEnabled) {
        const cached = getLicenseValidator().getCachedResult(configLicenseKey);
        if (cached) licenseTier = cached.tier;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        version: PKG.version,
        api_version: 'v1',
        // Wire-contract version, negotiated by ensureRuntime(). Distinct from
        // `version` — a long-lived daemon can outlive the clients connecting to
        // it, and most releases do not change the contract. See runtime/protocol.ts.
        protocol_version: RUNTIME_PROTOCOL_VERSION,
        uptime_ms: uptimeMs,
        uptime_human: formatUptime(uptimeMs),
        pid: process.pid,
        facade_count: kernel.facadeCount,
        internal_tool_count: kernel.toolCount,
        connected_clients: activeSseConnections.size,
        active_requests: activeRequests.size,
        connected_agents: agentRegistry?.count ?? 0,
        agents: agentRegistry?.toJSON() ?? [],
        pro: licenseTier !== 'core',
        license_tier: licenseTier,
        supabase_configured: isSupabaseConfigured(),
        // Facades whose dependency is failing. `{}` is the healthy case — a
        // non-empty object means calls to those facades are being refused fast
        // rather than left to time out. See runtime/circuitBreaker.ts.
        circuits: kernel.circuitSnapshot(),
      }));
      return;
    }

    // Readiness probe at /ready
    if (path === '/ready') {
      // Ready if kernel loaded and at least one facade is available
      const ready = kernel && kernel.facadeCount > 0;
      res.writeHead(ready ? 200 : 503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ready,
        facade_count: kernel?.facadeCount || 0,
      }));
      return;
    }

    // GET /events — query dispatch event log (dispatch.jsonl)
    if (path === '/events' && req.method === 'GET') {
      // AUTH BEFORE DATA: /events returns operational telemetry (agent ids, tool
      // names, run/request ids, timestamps, error strings). It sits above the main
      // auth gate, so it must enforce auth itself (sec review 2026-06-04/06-07):
      //   - hosted (--http) with no token → fail closed (no authenticated principal);
      //   - any mode with a token → require it.
      if (!isDaemon && !authToken) {
        sendJson(res, 401, wrapError(
          'This endpoint requires authentication. Hosted (--http) mode must be started with DECIBEL_AUTH_TOKEN set.',
          'AUTH_NOT_CONFIGURED',
        ));
        return;
      }
      if (authToken) {
        const authHeader = req.headers.authorization;
        if (!authHeader || !timingSafeTokenCompare(authHeader, `Bearer ${authToken}`)) {
          sendJson(res, 401, wrapError('Unauthorized', 'UNAUTHORIZED'));
          return;
        }
      }
      const dispatchLogPath = join(
        process.env.HOME || '~', '.decibel', 'logs', 'dispatch.jsonl'
      );

      try {
        const content = readFileSync(dispatchLogPath, 'utf-8');
        const lines = content.trim().split('\n').filter(Boolean);

        // Parse query params from URL
        const since = url.searchParams.get('since');
        const agentFilter = url.searchParams.get('agent_id');
        const limitParam = url.searchParams.get('limit');
        const limit = limitParam ? parseInt(limitParam, 10) : 100;

        let events = lines.map(line => {
          try { return JSON.parse(line); }
          catch { return null; }
        }).filter(Boolean);

        // Filter by timestamp
        if (since) {
          events = events.filter((e: Record<string, unknown>) =>
            (e.timestamp as string) >= since
          );
        }

        // Filter by agent
        if (agentFilter) {
          events = events.filter((e: Record<string, unknown>) =>
            e.agentId === agentFilter
          );
        }

        // Limit + return most recent
        const recent = events.slice(-limit);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ events: recent, total: events.length }));
      } catch {
        // No dispatch log yet — empty response
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ events: [], total: 0 }));
      }
      return;
    }

    // Landing page at /docs (always HTML)
    if (path === '/docs' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(landingPageHtml);
      return;
    }

    // GET /tools — HTML for browsers, JSON for API clients
    if (path === '/tools' && req.method === 'GET') {
      const accept = req.headers.accept || '';
      if (accept.includes('text/html')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(landingPageHtml);
        return;
      }
      // JSON response (for curl, agents, etc.) — falls through to auth + tool list below
    }

    // Serve OpenAPI spec for ChatGPT Actions (handle GET and POST)
    if ((path === '/openapi.yaml' || path === '/openapi.json') && (req.method === 'GET' || req.method === 'POST')) {
      try {
        const specPath = join(__dirname, '..', 'openapi.yaml');
        const spec = readFileSync(specPath, 'utf-8');
        if (path === '/openapi.json') {
          // Convert YAML to JSON if requested
          const yaml = await import('yaml');
          const parsed = yaml.parse(spec);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(parsed, null, 2));
        } else {
          res.writeHead(200, { 'Content-Type': 'text/yaml' });
          res.end(spec);
        }
      } catch (error) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'OpenAPI spec not found' }));
      }
      return;
    }

    // (d) OAuth discovery routes - return 404 (not 400) to keep connector wizard happy
    if (path === '/.well-known/oauth-authorization-server' ||
        path === '/.well-known/openid-configuration' ||
        path === '/oauth/authorize' ||
        path === '/oauth/token' ||
        path === '/oauth/register') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    // HOSTED FAIL-CLOSED (sec review 2026-06-07, issue A): in --http (non-daemon)
    // mode the server is network-exposed. If no auth token is configured there is
    // NO authenticated principal, so every route that reaches this gate (the
    // sensitive surface — /call, /connect, /batch, /mcp, /events, etc.; the public
    // infra routes /, /health, /docs, /tools-html, /openapi, OAuth already returned
    // above) MUST be refused rather than served open. In localhost daemon mode the
    // 127.0.0.1 bind is the boundary, so an unset token stays allowed there.
    if (!isDaemon && !authToken) {
      log('HTTP: refusing request — hosted mode requires DECIBEL_AUTH_TOKEN');
      sendJson(res, 401, wrapError(
        'This endpoint requires authentication. Hosted (--http) mode must be started with DECIBEL_AUTH_TOKEN set.',
        'AUTH_NOT_CONFIGURED',
      ));
      return;
    }

    // Auth check (timing-safe comparison to prevent timing attacks)
    if (authToken) {
      const authHeader = req.headers.authorization;
      if (!authHeader || !timingSafeTokenCompare(authHeader, `Bearer ${authToken}`)) {
        log('HTTP: Unauthorized request');
        sendJson(res, 401, wrapError('Unauthorized', 'UNAUTHORIZED'));
        return;
      }
    }

    // ========================================================================
    // Simple REST Endpoints (for external AI agents)
    // ========================================================================

    // GET /tools - List available tools
    // MCP tool definitions, verbatim — the shape a `tools/list` response needs.
    //
    // This is what lets a stdio client stop building its own kernel. /tools
    // above is a human/OpenAI-shaped summary; this one is the exact array the
    // MCP handler returns, so a thin adapter can serve tools/list by forwarding
    // it rather than loading 195 tool modules to produce the same bytes.
    if (path === '/mcp/tools' && req.method === 'GET') {
      const tierParam = url.searchParams.get('tier');
      const tier = (tierParam === 'compact' || tierParam === 'micro' ? tierParam : 'full') as DetailTier;
      sendJson(res, 200, wrapSuccess({
        version: PKG.version,
        protocol_version: RUNTIME_PROTOCOL_VERSION,
        tier,
        tools: kernel.getMcpToolDefinitions(tier),
      }));
      return;
    }

    if (path === '/tools' && req.method === 'GET') {
      sendJson(res, 200, wrapSuccess({
        version: PKG.version,
        api_version: 'v1',
        tools: getAvailableTools(),
      }));
      return;
    }

    // ========================================================================
    // Multi-Agent Endpoints (ISS-0052)
    // ========================================================================

    // POST /connect — Agent handshake with daemon
    if (path === '/connect' && req.method === 'POST') {
      if (!agentRegistry) {
        sendJson(res, 503, wrapError('Agent registry not available (not in daemon mode)', 'NOT_DAEMON'));
        return;
      }
      try {
        const body = await parseBody(req);
        const agentId = body.agent_id as string;
        if (!agentId) {
          sendJson(res, 400, wrapError('Missing "agent_id" field', 'MISSING_AGENT_ID'));
          return;
        }

        // Look up per-agent config
        const agentCfg = daemonConfig?.agents?.[agentId];
        const agent = agentRegistry.register({
          id: agentId,
          capabilities: (body.capabilities as string[]) || [],
          allowedFacades: agentCfg?.allowed_facades,
          tier: agentCfg?.tier,
        });

        // Apply per-agent rate limit if configured
        if (agentCfg?.rate_limit_rpm) {
          rateLimiter.setAgentLimit(agentId, agentCfg.rate_limit_rpm);
        }

        log(`HTTP: /connect agent=${agentId}`);
        sendJson(res, 200, wrapSuccess({
          agent_id: agent.id,
          connected_at: agent.connectedAt,
          capabilities: agent.capabilities,
          allowed_facades: agent.allowedFacades || null,
          tier: agent.tier || null,
          rate_limit_rpm: agentCfg?.rate_limit_rpm || rateLimitRpm,
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sendJson(res, 400, wrapError(message, 'CONNECT_ERROR'));
      }
      return;
    }

    // POST /disconnect — Graceful agent disconnect
    if (path === '/disconnect' && req.method === 'POST') {
      if (!agentRegistry) {
        sendJson(res, 503, wrapError('Agent registry not available (not in daemon mode)', 'NOT_DAEMON'));
        return;
      }
      try {
        const body = await parseBody(req);
        const agentId = body.agent_id as string;
        if (!agentId) {
          sendJson(res, 400, wrapError('Missing "agent_id" field', 'MISSING_AGENT_ID'));
          return;
        }

        const disconnected = agentRegistry.disconnect(agentId);
        log(`HTTP: /disconnect agent=${agentId} (was_connected=${disconnected})`);
        sendJson(res, 200, wrapSuccess({
          agent_id: agentId,
          disconnected,
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sendJson(res, 400, wrapError(message, 'DISCONNECT_ERROR'));
      }
      return;
    }

    // POST /agents/register and /agents/heartbeat — generic local-runtime presence
    // (swarm P2). The @decibel/hq SDK calls these so ANY local runtime (hermes,
    // openclaw, codex, cursor, custom) appears on HQ's /agents board tagged with its
    // runtime — generalizing the claude-peers presence path beyond Claude Code.
    //
    // IDENTITY = the localhost-bind connection principal (confused-deputy rule): only
    // a LOCAL process may register a local runtime. We check the actual socket peer
    // address (not a spoofable header). The runtime/session_key are untrusted LABELS
    // from a trusted-LOCATION caller — fine for a local presence write. The hosted/BYO
    // path uses an agent-token instead (P4), which is not this endpoint.
    if ((path === '/agents/register' || path === '/agents/heartbeat') && req.method === 'POST') {
      if (!isLocalAgentPeer(req)) {
        sendJson(res, 403, wrapError(
          'agents.register is local-only (the 127.0.0.1 bind is the principal). Hosted/BYO agents use the agent-token ingest path.',
          'LOCAL_ONLY',
        ));
        return;
      }
      try {
        const body = await parseBody(req);
        const session_key = body.session_key as string;
        const runtime = body.runtime as string;
        if (!session_key || !runtime) {
          sendJson(res, 400, wrapError('Missing "session_key" and/or "runtime"', 'MISSING_FIELDS'));
          return;
        }
        const reqStatus = body.status === 'ended' ? 'ended' : 'active';
        const ok = await writeLocalAgentSession({
          session_key,
          runtime,
          agent: (body.agent as string) ?? null,
          cwd: (body.cwd as string) ?? null,
          summary: (body.summary as string) ?? null,
          meta: (body.meta as Record<string, unknown>) ?? undefined,
          status: reqStatus,
        });
        if (!ok) {
          sendJson(res, 503, wrapError(
            'Presence store unavailable (SUPABASE_URL/SERVICE_KEY not configured, or write failed).',
            'PRESENCE_UNAVAILABLE',
          ));
          return;
        }
        // Capability token: on 'ended' forget it; otherwise mint-or-return the
        // session's token and hand it back so the SDK can authorize poll/ack. The
        // token is the secret that distinguishes THIS registrant from any other
        // co-resident local process guessing the (public) session_key.
        let token: string | undefined;
        if (reqStatus === 'ended') {
          dropSessionToken(session_key);
        } else {
          token = ensureSessionToken(session_key);
        }
        log(`HTTP: /agents/${path.endsWith('register') ? 'register' : 'heartbeat'} runtime=${runtime} session=${session_key}`);
        sendJson(res, 200, wrapSuccess({ session_key, runtime, ok: true, ...(token && { token }) }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sendJson(res, 400, wrapError(message, 'REGISTER_ERROR'));
      }
      return;
    }

    // GET /agents/commands?session_key=... — SDK command inbox poll (swarm onCommand).
    // A local SDK runtime polls for HQ commands the dispatcher enqueued for it, runs
    // onCommand, then acks via POST /agents/commands/ack. LOCALHOST-ONLY (same
    // principal as register): the daemon holds the service_role; the SDK never does.
    if (path === '/agents/commands' && req.method === 'GET') {
      if (!isLocalAgentPeer(req)) {
        sendJson(res, 403, wrapError('agent command inbox is local-only', 'LOCAL_ONLY'));
        return;
      }
      const sessionKey = url.searchParams.get('session_key');
      if (!sessionKey) {
        sendJson(res, 400, wrapError('Missing "session_key" query param', 'MISSING_SESSION_KEY'));
        return;
      }
      // Capability check: session_key is a guessable label, so a co-resident local
      // process could otherwise drain another runtime's inbox. The token proves the
      // caller is the registrant. Timing-safe compare; unknown session → no token →
      // reject. (drainCommands also org-scopes — defense-in-depth on cross-org.)
      const token = url.searchParams.get('token') || '';
      const expected = getSessionToken(sessionKey);
      if (!expected || !timingSafeTokenCompare(token, expected)) {
        sendJson(res, 403, wrapError('Invalid or missing session token', 'BAD_SESSION_TOKEN'));
        return;
      }
      const commands = drainCommands(sessionKey, ORG_ID);
      sendJson(res, 200, wrapSuccess({ session_key: sessionKey, commands, count: commands.length }));
      return;
    }

    // POST /agents/commands/ack — SDK reports a command's outcome; daemon settles the
    // hq.agent_commands row in Core (service_role). LOCALHOST-ONLY. Only done|failed.
    if (path === '/agents/commands/ack' && req.method === 'POST') {
      if (!isLocalAgentPeer(req)) {
        sendJson(res, 403, wrapError('agent command ack is local-only', 'LOCAL_ONLY'));
        return;
      }
      try {
        const body = await parseBody(req);
        const id = body.id as string;
        const status = body.status as string;
        if (!id || (status !== 'done' && status !== 'failed')) {
          sendJson(res, 400, wrapError('Require "id" and "status" in {done|failed}', 'INVALID_ACK'));
          return;
        }
        // Capability check: only the session this command was enqueued for may ack
        // it (else any local process could forge a 'done' + arbitrary result for
        // another runtime's command). Map id→owning session, verify its token.
        const owner = ackOwnerOf(id);
        const expected = owner ? getSessionToken(owner) : undefined;
        const token = typeof body.token === 'string' ? body.token : '';
        if (!owner || !expected || !timingSafeTokenCompare(token, expected)) {
          sendJson(res, 403, wrapError('Ack not authorized for this command', 'BAD_SESSION_TOKEN'));
          return;
        }
        // Defense-in-depth: cap the forged-able result blob (1MB body limit already
        // applies; this bounds a single field written to Core under service_role).
        const result = (body.result as Record<string, unknown>) ?? null;
        if (result && Buffer.byteLength(JSON.stringify(result)) > 64 * 1024) {
          sendJson(res, 400, wrapError('Ack "result" too large (max 64KB)', 'RESULT_TOO_LARGE'));
          return;
        }
        const errStr = typeof body.error === 'string' ? body.error : null;
        const ok = await settleCommandFromAck(id, status, result, errStr);
        if (!ok) {
          sendJson(res, 503, wrapError('Command store unavailable (Supabase not configured)', 'STORE_UNAVAILABLE'));
          return;
        }
        clearAckOwner(id);
        sendJson(res, 200, wrapSuccess({ id, status, ok: true }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sendJson(res, 400, wrapError(message, 'ACK_ERROR'));
      }
      return;
    }

    // GET /agents — List connected agents
    if (path === '/agents' && req.method === 'GET') {
      if (!agentRegistry) {
        sendJson(res, 200, wrapSuccess({ agents: [], count: 0 }));
        return;
      }
      sendJson(res, 200, wrapSuccess({
        agents: agentRegistry.toJSON(),
        count: agentRegistry.count,
      }));
      return;
    }

    // GET /events/stream — SSE stream of real-time dispatch events
    if (path === '/events/stream' && req.method === 'GET') {
      // Filter params
      const filterAgentId = url.searchParams.get('agent_id');
      const filterFacade = url.searchParams.get('facade');

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      res.write(': connected\n\n');

      const listener = (evt: DispatchEvent) => {
        // Apply filters
        if (filterAgentId && evt.agentId !== filterAgentId) return;
        if (filterFacade && evt.facade !== filterFacade) return;
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify(evt)}\n\n`);
        }
      };

      kernel.on('dispatch', listener);
      kernel.on('result', listener);
      kernel.on('error', listener);

      // Track for keepalive
      activeSseConnections.add(res);
      log(`HTTP: /events/stream opened (${activeSseConnections.size} SSE connections)`);

      // Cleanup on close
      const cleanup = () => {
        kernel.off('dispatch', listener);
        kernel.off('result', listener);
        kernel.off('error', listener);
        activeSseConnections.delete(res);
        log(`HTTP: /events/stream closed (${activeSseConnections.size} SSE connections)`);
      };
      res.on('close', cleanup);
      res.on('error', cleanup);
      return;
    }

    // GET /conductor/stream — SSE live-tail of the conductor trace ledger (C3).
    // Pure live-from-now: history is conductor.trace's job. Optional ?session_id / ?project_id filter.
    if (path === '/conductor/stream' && req.method === 'GET') {
      const filterSession = url.searchParams.get('session_id');
      const filterProject = url.searchParams.get('project_id');
      // mirrors conductor/index.ts ledgerPath() — same file the runs append to
      const lp = process.env.CONDUCTOR_LEDGER
        || join(process.env.CONDUCTOR_DIR || resolve(process.cwd(), '../decibel-orchestrator'),
                '.decibel/conductor/trace.jsonl');

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      res.write(': connected\n\n');

      let offset = 0;
      try { offset = existsSync(lp) ? readFileSync(lp, 'utf8').length : 0; } catch { offset = 0; }
      let buf = '';
      // ponytail: re-reads the whole JSONL per poll — fine at trace sizes; switch to
      // fd offset reads if the ledger grows large.
      const poll = setInterval(() => {
        if (res.writableEnded) return;
        let content = '';
        try { content = existsSync(lp) ? readFileSync(lp, 'utf8') : ''; } catch { return; }
        if (content.length < offset) { offset = 0; buf = ''; }   // rotated/truncated
        if (content.length <= offset) return;
        buf += content.slice(offset);
        offset = content.length;
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
          if (!line.trim()) continue;
          let evt: Record<string, unknown>;
          try { evt = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
          if (filterSession && evt.request_id !== filterSession) continue;
          if (filterProject && evt.project_id !== filterProject) continue;
          if (!res.writableEnded) res.write(`data: ${JSON.stringify(evt)}\n\n`);
        }
      }, 300);

      activeSseConnections.add(res);
      log(`HTTP: /conductor/stream opened (${activeSseConnections.size} SSE connections)`);
      const cleanup = () => {
        clearInterval(poll);
        activeSseConnections.delete(res);
        log(`HTTP: /conductor/stream closed (${activeSseConnections.size} SSE connections)`);
      };
      res.on('close', cleanup);
      res.on('error', cleanup);
      return;
    }

    // GET /facades - Facade registry for agent bootstrap
    if (path === '/facades' && req.method === 'GET') {
      const tier = (url.searchParams.get('tier') || 'full') as 'full' | 'compact' | 'micro';
      sendJson(res, 200, wrapSuccess({
        facades: kernel.facades
          .filter(f => tier !== 'micro' || f.microEligible)
          .map(f => ({
            name: f.name,
            description: tier === 'compact' ? f.compactDescription : f.description,
            actions: Object.keys(f.actions),
            tier: f.tier,
          })),
        tier,
        facade_count: kernel.facadeCount,
        internal_tool_count: kernel.toolCount,
      }));
      return;
    }

    // POST /call - Execute any tool
    if (path === '/call' && req.method === 'POST') {
      try {
        const body = await parseBody(req);
        const tool = body.tool as string;
        const args = (body.arguments || {}) as Record<string, unknown>;

        if (!tool) {
          sendJson(res, 400, wrapError('Missing "tool" field', 'MISSING_TOOL'));
          return;
        }

        const tier = await resolveTier(req, configLicenseKey);
        log(`HTTP: /call tool=${tool} tier=${tier}`);
        const result = await executeTool(tool, args, req, tier);
        sendJson(res, envelopeHttpStatus(result), result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('too large')) {
          sendJson(res, 413, wrapError(message, 'BODY_TOO_LARGE'));
        } else {
          sendJson(res, 400, wrapError(message, 'PARSE_ERROR'));
        }
      }
      return;
    }

    // POST /batch - Dispatch multiple independent calls in parallel
    if (path === '/batch' && req.method === 'POST') {
      try {
        const body = await parseBody(req);
        const calls = body.calls as Array<{ facade: string; action: string; params?: Record<string, unknown> }>;

        if (!Array.isArray(calls) || calls.length === 0) {
          sendJson(res, 400, wrapError('Missing or empty "calls" array', 'INVALID_BATCH'));
          return;
        }

        if (calls.length > 20) {
          sendJson(res, 400, wrapError('Batch limited to 20 calls', 'BATCH_TOO_LARGE'));
          return;
        }

        const tier = await resolveTier(req, configLicenseKey);

        // Build context from headers + optional body context
        const bodyContext = (body.context || {}) as Record<string, string>;
        const context: DispatchContext = {
          agentId: (req.headers['x-agent-id'] as string) || bodyContext.agentId,
          runId: (req.headers['x-run-id'] as string) || bodyContext.runId,
          parentCallId: (req.headers['x-parent-call-id'] as string) || bodyContext.parentCallId,
          scope: (req.headers['x-scope'] as string) || bodyContext.scope,
          engagementMode: (req.headers['x-engagement-mode'] as string) || bodyContext.engagementMode,
          userKey: (req.headers['x-user-key'] as string) || bodyContext.userKey,
          orgId: (req.headers['x-org-key'] as string) || bodyContext.orgId,
          requestId: (req.headers['x-request-id'] as string) || bodyContext.requestId,
          allowedFacades: bodyContext.allowedFacades as unknown as string[] | undefined,
          tier,
        };

        log(`HTTP: /batch — ${calls.length} calls (agent=${context.agentId || 'anonymous'}, tier=${tier})`);
        const results = await kernel.batch(calls, context);
        sendJson(res, 200, { status: 'executed', ok: true, results });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sendJson(res, 400, wrapError(message, 'BATCH_ERROR'));
      }
      return;
    }

    // ========================================================================
    // OpenAI-Compatible REST API (for SDK function calling)
    // ========================================================================

    // GET /api/tools - List tools in OpenAI function calling format
    if (path === '/api/tools' && req.method === 'GET') {
      const tools = getOpenAITools();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(tools));
      return;
    }

    // POST /api/tools/{name} - Execute a tool by name
    if (path.startsWith('/api/tools/') && req.method === 'POST') {
      try {
        const toolName = path.replace('/api/tools/', '');
        if (!toolName) {
          sendJson(res, 400, wrapError('Missing tool name in path', 'MISSING_TOOL_NAME'));
          return;
        }

        const body = await parseBody(req);
        log(`HTTP: /api/tools/${toolName}`);

        const result = await executeTool(toolName, body);
        sendJson(res, envelopeHttpStatus(result), result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sendJson(res, 400, wrapError(message, 'EXECUTION_ERROR'));
      }
      return;
    }

    // ========================================================================
    // Dojo Convenience Endpoints
    // ========================================================================

    // POST /dojo/wish - Add a wish
    if (path === '/dojo/wish' && req.method === 'POST') {
      try {
        const body = await parseBody(req);
        log('HTTP: /dojo/wish');
        const result = await executeTool('dojo_add_wish', body);
        sendJson(res, envelopeHttpStatus(result), result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sendJson(res, 400, wrapError(message, 'PARSE_ERROR'));
      }
      return;
    }

    // POST /dojo/propose - Create a proposal
    if (path === '/dojo/propose' && req.method === 'POST') {
      try {
        const body = await parseBody(req);
        log('HTTP: /dojo/propose');
        const result = await executeTool('dojo_create_proposal', body);
        sendJson(res, envelopeHttpStatus(result), result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sendJson(res, 400, wrapError(message, 'PARSE_ERROR'));
      }
      return;
    }

    // POST /dojo/scaffold - Scaffold experiment
    if (path === '/dojo/scaffold' && req.method === 'POST') {
      try {
        const body = await parseBody(req);
        log('HTTP: /dojo/scaffold');
        const result = await executeTool('dojo_scaffold_experiment', body);
        sendJson(res, envelopeHttpStatus(result), result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sendJson(res, 400, wrapError(message, 'PARSE_ERROR'));
      }
      return;
    }

    // POST /dojo/run - Run experiment
    if (path === '/dojo/run' && req.method === 'POST') {
      try {
        const body = await parseBody(req);
        log('HTTP: /dojo/run');
        const result = await executeTool('dojo_run_experiment', body);
        sendJson(res, envelopeHttpStatus(result), result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sendJson(res, 400, wrapError(message, 'PARSE_ERROR'));
      }
      return;
    }

    // POST /dojo/results - Get experiment results
    if (path === '/dojo/results' && req.method === 'POST') {
      try {
        const body = await parseBody(req);
        log('HTTP: /dojo/results');
        const result = await executeTool('dojo_read_results', body);
        sendJson(res, envelopeHttpStatus(result), result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sendJson(res, 400, wrapError(message, 'PARSE_ERROR'));
      }
      return;
    }

    // GET /dojo/list - List all (or POST with filter)
    if (path === '/dojo/list') {
      try {
        const body = req.method === 'POST' ? await parseBody(req) : {};
        // For GET, try to get project_id from query params
        if (req.method === 'GET') {
          const projectId = url.searchParams.get('project_id');
          if (projectId) {
            (body as Record<string, unknown>).project_id = projectId;
          }
        }
        log('HTTP: /dojo/list');
        const result = await executeTool('dojo_list', body);
        sendJson(res, envelopeHttpStatus(result), result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sendJson(res, 400, wrapError(message, 'PARSE_ERROR'));
      }
      return;
    }

    // GET /dojo/wishes - List wishes
    if (path === '/dojo/wishes') {
      try {
        const body = req.method === 'POST' ? await parseBody(req) : {};
        if (req.method === 'GET') {
          const projectId = url.searchParams.get('project_id');
          if (projectId) {
            (body as Record<string, unknown>).project_id = projectId;
          }
        }
        log('HTTP: /dojo/wishes');
        const result = await executeTool('dojo_list_wishes', body);
        sendJson(res, envelopeHttpStatus(result), result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sendJson(res, 400, wrapError(message, 'PARSE_ERROR'));
      }
      return;
    }

    // POST /dojo/can-graduate - Check graduation eligibility
    if (path === '/dojo/can-graduate' && req.method === 'POST') {
      try {
        const body = await parseBody(req);
        log('HTTP: /dojo/can-graduate');
        const result = await executeTool('dojo_can_graduate', body);
        sendJson(res, envelopeHttpStatus(result), result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sendJson(res, 400, wrapError(message, 'PARSE_ERROR'));
      }
      return;
    }

    // POST /dojo/artifact - Read artifact from experiment results
    if (path === '/dojo/artifact' && req.method === 'POST') {
      try {
        const body = await parseBody(req);
        log('HTTP: /dojo/artifact');
        const result = await executeTool('dojo_read_artifact', body);
        sendJson(res, envelopeHttpStatus(result), result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sendJson(res, 400, wrapError(message, 'PARSE_ERROR'));
      }
      return;
    }

    // POST /dojo/bench - Run benchmark on experiment
    if (path === '/dojo/bench' && req.method === 'POST') {
      try {
        const body = await parseBody(req);
        log('HTTP: /dojo/bench');
        const result = await executeTool('dojo_bench', body);
        sendJson(res, envelopeHttpStatus(result), result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sendJson(res, 400, wrapError(message, 'PARSE_ERROR'));
      }
      return;
    }

    // ========================================================================
    // Benchmark Endpoints (ISS-0014)
    // ========================================================================

    // POST /bench/run - Run a benchmark suite
    if (path === '/bench/run' && req.method === 'POST') {
      try {
        const body = await parseBody(req);
        log('HTTP: /bench/run');
        const result = await executeTool('decibel_bench', body);
        sendJson(res, envelopeHttpStatus(result), result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sendJson(res, 400, wrapError(message, 'PARSE_ERROR'));
      }
      return;
    }

    // POST /bench/compare - Compare two baselines
    if (path === '/bench/compare' && req.method === 'POST') {
      try {
        const body = await parseBody(req);
        log('HTTP: /bench/compare');
        const result = await executeTool('decibel_bench_compare', body);
        sendJson(res, envelopeHttpStatus(result), result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sendJson(res, 400, wrapError(message, 'PARSE_ERROR'));
      }
      return;
    }

    // ========================================================================
    // Context Pack Endpoints (ADR-002)
    // ========================================================================

    // POST /context/refresh - Compile full context pack
    if (path === '/context/refresh' && req.method === 'POST') {
      try {
        const body = await parseBody(req);
        log('HTTP: /context/refresh');
        const result = await executeTool('decibel_context_refresh', body);
        sendJson(res, envelopeHttpStatus(result), result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sendJson(res, 400, wrapError(message, 'PARSE_ERROR'));
      }
      return;
    }

    // POST /context/pin - Pin a fact
    if (path === '/context/pin' && req.method === 'POST') {
      try {
        const body = await parseBody(req);
        log('HTTP: /context/pin');
        const result = await executeTool('decibel_context_pin', body);
        sendJson(res, envelopeHttpStatus(result), result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sendJson(res, 400, wrapError(message, 'PARSE_ERROR'));
      }
      return;
    }

    // POST /context/unpin - Unpin a fact
    if (path === '/context/unpin' && req.method === 'POST') {
      try {
        const body = await parseBody(req);
        log('HTTP: /context/unpin');
        const result = await executeTool('decibel_context_unpin', body);
        sendJson(res, envelopeHttpStatus(result), result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sendJson(res, 400, wrapError(message, 'PARSE_ERROR'));
      }
      return;
    }

    // GET/POST /context/list - List pinned facts
    if (path === '/context/list' && (req.method === 'GET' || req.method === 'POST')) {
      try {
        const body = req.method === 'POST' ? await parseBody(req) : {};
        if (req.method === 'GET') {
          const projectId = url.searchParams.get('project_id');
          if (projectId) {
            (body as Record<string, unknown>).project_id = projectId;
          }
        }
        log('HTTP: /context/list');
        const result = await executeTool('decibel_context_list', body);
        sendJson(res, envelopeHttpStatus(result), result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sendJson(res, 400, wrapError(message, 'PARSE_ERROR'));
      }
      return;
    }

    // POST /event/append - Append event to journal
    if (path === '/event/append' && req.method === 'POST') {
      try {
        const body = await parseBody(req);
        log('HTTP: /event/append');
        const result = await executeTool('decibel_event_append', body);
        sendJson(res, envelopeHttpStatus(result), result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sendJson(res, 400, wrapError(message, 'PARSE_ERROR'));
      }
      return;
    }

    // GET/POST /event/search - Search events
    if (path === '/event/search' && (req.method === 'GET' || req.method === 'POST')) {
      try {
        const body = req.method === 'POST' ? await parseBody(req) : {};
        if (req.method === 'GET') {
          const projectId = url.searchParams.get('project_id');
          const query = url.searchParams.get('query');
          const limit = url.searchParams.get('limit');
          if (projectId) {
            (body as Record<string, unknown>).project_id = projectId;
          }
          if (query) {
            (body as Record<string, unknown>).query = query;
          }
          if (limit) {
            (body as Record<string, unknown>).limit = parseInt(limit, 10);
          }
        }
        log('HTTP: /event/search');
        const result = await executeTool('decibel_event_search', body);
        sendJson(res, envelopeHttpStatus(result), result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sendJson(res, 400, wrapError(message, 'PARSE_ERROR'));
      }
      return;
    }

    // POST /artifact/list - List artifacts for a run
    if (path === '/artifact/list' && req.method === 'POST') {
      try {
        const body = await parseBody(req);
        log('HTTP: /artifact/list');
        const result = await executeTool('decibel_artifact_list', body);
        sendJson(res, envelopeHttpStatus(result), result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sendJson(res, 400, wrapError(message, 'PARSE_ERROR'));
      }
      return;
    }

    // POST /artifact/read - Read artifact by run_id and name
    if (path === '/artifact/read' && req.method === 'POST') {
      try {
        const body = await parseBody(req);
        log('HTTP: /artifact/read');
        const result = await executeTool('decibel_artifact_read', body);
        sendJson(res, envelopeHttpStatus(result), result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sendJson(res, 400, wrapError(message, 'PARSE_ERROR'));
      }
      return;
    }

    // ========================================================================
    // iOS Mobile App Endpoint
    // ========================================================================

    // Helper: Call ML classifier sidecar (optional, graceful fallback)
    async function classifyWithML(transcript: string): Promise<{ intent: string; confidence: number } | null> {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 1000); // 1s timeout

        const resp = await fetch('http://127.0.0.1:8790/classify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transcript }),
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (resp.ok) {
          return await resp.json() as { intent: string; confidence: number };
        }
      } catch {
        // Classifier not running or timed out - that's fine
      }
      return null;
    }

    // Helper: Log training sample to ML classifier
    async function logTrainingSample(data: {
      transcript: string;
      user_label: string;
      predicted: string;
      confidence: number;
      was_overridden: boolean;
    }): Promise<void> {
      try {
        await fetch('http://127.0.0.1:8790/log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
      } catch {
        // Best effort logging
      }
    }

    // POST /api/inbox - Receive voice transcript from iOS app
    if (path === '/api/inbox' && req.method === 'POST') {
      try {
        const body = await parseBody(req);
        log('HTTP: /api/inbox (iOS)');

        // Validate required field
        const transcript = body.transcript as string;
        if (!transcript) {
          sendJson(res, 400, wrapError('Missing "transcript" field', 'MISSING_TRANSCRIPT'));
          return;
        }

        // Build tags array
        const tags: string[] = [];
        if (body.device) tags.push(`device:${body.device}`);

        // User's explicit intent (from button tap)
        // iOS sends as "event_type", also accept "intent" for compatibility
        const userIntent = (body.event_type || body.intent) as string | undefined;

        // ML classification (optional - graceful fallback if not running)
        const mlResult = await classifyWithML(transcript);
        let finalIntent = userIntent;
        let wasOverridden = false;
        let mlConfidence = 0;

        if (mlResult) {
          mlConfidence = mlResult.confidence;
          log(`HTTP: ML classified as "${mlResult.intent}" (${(mlResult.confidence * 100).toFixed(0)}%)`);

          if (userIntent) {
            // User provided intent - ML can override if confident and disagrees
            if (mlResult.intent !== userIntent && mlResult.confidence > 0.75) {
              finalIntent = mlResult.intent;
              wasOverridden = true;
              tags.push('ml:overridden');
              log(`HTTP: ML overriding user intent "${userIntent}" → "${mlResult.intent}"`);
            }

            // Log training sample (user label = ground truth)
            logTrainingSample({
              transcript,
              user_label: userIntent,
              predicted: mlResult.intent,
              confidence: mlResult.confidence,
              was_overridden: wasOverridden,
            });
          } else {
            // No user intent - use ML prediction
            finalIntent = mlResult.intent;
            tags.push('ml:predicted');
          }
        }

        // Mark as human-labeled if user provided intent
        if (userIntent) {
          tags.push('labeled:human');
          tags.push(`user_intent:${userIntent}`);
        }

        // Map iOS payload to VoiceInboxAddInput
        const voiceInput: VoiceInboxAddInput = {
          transcript,
          source: 'mobile_app',
          project_id: body.project_id as string | undefined,
          process_immediately: true, // Process on receipt
          tags: tags.length > 0 ? tags : undefined,
          // Pass final intent (may be ML-overridden)
          explicit_intent: finalIntent,
        };

        const result = await voiceInboxAdd(voiceInput);
        sendJson(res, 200, wrapSuccess({
          inbox_id: result.inbox_id,
          transcript: result.transcript,
          intent: result.intent,
          intent_confidence: result.intent_confidence,
          inbox_status: result.status,
          immediate_result: result.immediate_result,
          // ML metadata
          labeled: !!userIntent,
          user_intent: userIntent || null,
          ml_intent: mlResult?.intent || null,
          ml_confidence: mlResult ? Math.round(mlResult.confidence * 100) / 100 : null,
          was_overridden: wasOverridden,
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log(`HTTP: /api/inbox error: ${message}`);
        sendJson(res, 400, wrapError(message, 'VOICE_INBOX_ERROR'));
      }
      return;
    }

    // ========================================================================
    // iOS App API Endpoints (StatusSnapshot compatible)
    // ========================================================================

    // GET /api/projects - List registered projects for iOS project picker
    if (path === '/api/projects' && req.method === 'GET') {
      try {
        log('HTTP: /api/projects');
        const projects = listProjects();

        sendJson(res, 200, wrapSuccess({
          projects: projects.map(p => ({
            id: p.id,
            name: p.name || p.id,
            aliases: p.aliases || [],
          })),
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log(`HTTP: /api/projects error: ${message}`);
        sendJson(res, 500, wrapError(message, 'PROJECTS_ERROR'));
      }
      return;
    }

    // GET /api/status - StatusSnapshot for iOS StatusView
    if (path === '/api/status' && req.method === 'GET') {
      try {
        log('HTTP: /api/status');
        const projects = listProjects();

        // Check system health by listing each project's data
        const systemsHealth: Record<string, { status: string; message: string | null }> = {
          sentinel: { status: 'healthy', message: null },
          oracle: { status: 'healthy', message: null },
          dojo: { status: 'healthy', message: null },
          architect: { status: 'healthy', message: null },
        };

        // Build project summaries
        const projectSummaries: Array<{
          project_id: string;
          name: string;
          health_score?: number;
          active_epics: number;
          open_issues: number;
          last_activity: string | null;
        }> = [];

        for (const project of projects) {
          try {
            // Get epic count
            const epicsResult = await listEpics({ projectId: project.id });
            const epicCount = isProjectResolutionError(epicsResult)
              ? 0
              : epicsResult.epics?.length || 0;

            // Get open issues count
            const issuesResult = await listRepoIssues({ projectId: project.id, status: 'open' });
            const openIssueCount = isProjectResolutionError(issuesResult)
              ? 0
              : issuesResult.issues?.length || 0;

            projectSummaries.push({
              project_id: project.id,
              name: project.name || project.id,
              active_epics: epicCount,
              open_issues: openIssueCount,
              last_activity: null, // Would need to scan files for timestamps
            });
          } catch {
            // If we can't get data for a project, still include it with zeros
            projectSummaries.push({
              project_id: project.id,
              name: project.name || project.id,
              active_epics: 0,
              open_issues: 0,
              last_activity: null,
            });
          }
        }

        const snapshot = {
          snapshot_id: crypto.randomUUID(),
          generated_at: new Date().toISOString(),
          source: {
            generator: 'mcp-server',
            version: PKG.version,
          },
          systems: systemsHealth,
          projects: projectSummaries,
          builds: [],
          alerts: [],
        };

        sendJson(res, 200, wrapSuccess(snapshot));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log(`HTTP: /api/status error: ${message}`);
        sendJson(res, 500, wrapError(message, 'STATUS_ERROR'));
      }
      return;
    }

    // ========================================================================
    // Studio API Endpoints (frontend_v0.2 compatible)
    // ========================================================================

    // POST /api/generate-flux-kontext-image - Start image generation
    if (path === '/api/generate-flux-kontext-image' && req.method === 'POST') {
      try {
        const body = await parseBody(req);
        log('HTTP: /api/generate-flux-kontext-image');

        // Validate required fields
        if (!body.prompt) {
          sendJson(res, 400, wrapError('Missing "prompt" field', 'MISSING_PROMPT'));
          return;
        }

        const input: GenerateImageInput = {
          asset_id: (body.asset_id as string) || `asset_${Date.now()}`,
          user_id: (body.user_id as string) || 'anonymous',
          prompt: body.prompt as string,
          input_image: body.input_image as string | null,
          aspect_ratio: (body.aspect_ratio as '16:9' | '9:16' | '1:1') || '16:9',
          model: (body.model as string) || 'flux-kontext-pro',
        };

        const result = await generateImage(input);
        sendJson(res, 200, wrapSuccess(result as unknown as Record<string, unknown>));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log(`HTTP: /api/generate-flux-kontext-image error: ${message}`);
        sendJson(res, 500, wrapError(message, 'GENERATION_ERROR'));
      }
      return;
    }

    // GET /api/flux-kontext-status/:taskId - Check image generation status
    if (path.startsWith('/api/flux-kontext-status/') && req.method === 'GET') {
      try {
        const taskId = path.replace('/api/flux-kontext-status/', '');
        log(`HTTP: /api/flux-kontext-status/${taskId}`);

        if (!taskId) {
          sendJson(res, 400, wrapError('Missing task ID', 'MISSING_TASK_ID'));
          return;
        }

        const status = getImageStatus(taskId);
        if (!status) {
          sendJson(res, 404, wrapError('Task not found', 'TASK_NOT_FOUND'));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(status));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log(`HTTP: /api/flux-kontext-status error: ${message}`);
        sendJson(res, 500, wrapError(message, 'STATUS_ERROR'));
      }
      return;
    }

    // ========================================================================
    // Meshy 3D Generation Endpoints
    // ========================================================================

    // POST /api/meshy/generate - Start 3D generation
    if (path === '/api/meshy/generate' && req.method === 'POST') {
      try {
        const body = await parseBody(req);
        log('HTTP: /api/meshy/generate');

        if (!body.mode) {
          sendJson(res, 400, wrapError('Missing "mode" field', 'MISSING_MODE'));
          return;
        }

        const input: MeshyGenerateInput = {
          mode: body.mode as MeshyGenerateInput['mode'],
          prompt: body.prompt as string,
          image_url: body.image_url as string,
          image_urls: body.image_urls as string[],
          preview_task_id: body.preview_task_id as string,
          model_input: body.model_input as MeshyGenerateInput['model_input'],
          parameters: body.parameters as Record<string, unknown>,
          asset_id: body.asset_id as string,
          user_id: body.user_id as string,
        };

        const result = await meshyGenerate(input);
        sendJson(res, 200, wrapSuccess(result as unknown as Record<string, unknown>));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log(`HTTP: /api/meshy/generate error: ${message}`);
        sendJson(res, 500, wrapError(message, 'MESHY_ERROR'));
      }
      return;
    }

    // GET /api/meshy/status/:taskId - Check 3D generation status
    if (path.startsWith('/api/meshy/status/') && req.method === 'GET') {
      try {
        const taskId = path.replace('/api/meshy/status/', '').split('?')[0];
        log(`HTTP: /api/meshy/status/${taskId}`);

        const status = getMeshyStatus(taskId);
        if (!status) {
          sendJson(res, 404, wrapError('Task not found', 'TASK_NOT_FOUND'));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(status));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sendJson(res, 500, wrapError(message, 'STATUS_ERROR'));
      }
      return;
    }

    // POST /api/meshy/download - Download completed model
    if (path === '/api/meshy/download' && req.method === 'POST') {
      try {
        const body = await parseBody(req);
        log('HTTP: /api/meshy/download');

        if (!body.task_id) {
          sendJson(res, 400, wrapError('Missing "task_id" field', 'MISSING_TASK_ID'));
          return;
        }

        const result = await meshyDownload(
          body.task_id as string,
          body.asset_id as string || `asset_${Date.now()}`,
          body.user_id as string || 'anonymous'
        );
        sendJson(res, 200, wrapSuccess(result));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sendJson(res, 500, wrapError(message, 'DOWNLOAD_ERROR'));
      }
      return;
    }

    // ========================================================================
    // Tripo 3D Generation Endpoints
    // ========================================================================

    // POST /api/tripo/generate - Start Tripo 3D generation
    if (path === '/api/tripo/generate' && req.method === 'POST') {
      try {
        const body = await parseBody(req);
        log('HTTP: /api/tripo/generate');

        if (!body.type) {
          sendJson(res, 400, wrapError('Missing "type" field', 'MISSING_TYPE'));
          return;
        }

        const input: TripoGenerateInput = {
          type: body.type as TripoGenerateInput['type'],
          prompt: body.prompt as string,
          image_url: body.image_url as string,
          image_urls: body.image_urls as TripoGenerateInput['image_urls'],
          parameters: body.parameters as Record<string, unknown>,
          asset_id: body.asset_id as string,
          user_id: body.user_id as string,
        };

        const result = await tripoGenerate(input);
        sendJson(res, 200, wrapSuccess(result as unknown as Record<string, unknown>));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log(`HTTP: /api/tripo/generate error: ${message}`);
        sendJson(res, 500, wrapError(message, 'TRIPO_ERROR'));
      }
      return;
    }

    // GET /api/tripo/task/:taskId - Check Tripo task status
    if (path.startsWith('/api/tripo/task/') && req.method === 'GET') {
      try {
        const taskId = path.replace('/api/tripo/task/', '');
        log(`HTTP: /api/tripo/task/${taskId}`);

        const status = getTripoStatus(taskId);
        if (!status) {
          sendJson(res, 404, wrapError('Task not found', 'TASK_NOT_FOUND'));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(status));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sendJson(res, 500, wrapError(message, 'STATUS_ERROR'));
      }
      return;
    }

    // POST /api/tripo/download/:taskId - Download Tripo model
    if (path.startsWith('/api/tripo/download/') && req.method === 'POST') {
      try {
        const taskId = path.replace('/api/tripo/download/', '');
        const body = await parseBody(req);
        log(`HTTP: /api/tripo/download/${taskId}`);

        const result = await tripoDownload(
          taskId,
          body.asset_id as string || `asset_${Date.now()}`,
          body.user_id as string || 'anonymous'
        );
        sendJson(res, 200, wrapSuccess(result));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sendJson(res, 500, wrapError(message, 'DOWNLOAD_ERROR'));
      }
      return;
    }

    // ========================================================================
    // Kling Video Generation Endpoints
    // ========================================================================

    // POST /api/generate-kling-video - Image to video
    if (path === '/api/generate-kling-video' && req.method === 'POST') {
      try {
        const body = await parseBody(req);
        log('HTTP: /api/generate-kling-video');

        if (!body.image_url || !body.prompt) {
          sendJson(res, 400, wrapError('Missing "image_url" or "prompt" field', 'MISSING_FIELDS'));
          return;
        }

        const input: KlingVideoInput = {
          asset_id: (body.asset_id as string) || `asset_${Date.now()}`,
          image_url: body.image_url as string,
          prompt: body.prompt as string,
          negative_prompt: body.negative_prompt as string,
          duration: (body.duration as 5 | 10) || 5,
          aspect_ratio: (body.aspect_ratio as '16:9' | '9:16' | '1:1') || '16:9',
          cfg_scale: body.cfg_scale as number,
          seed: body.seed as number,
          user_id: body.user_id as string,
          model: body.model as string,
          sound: body.sound as boolean,
        };

        const result = await klingGenerateVideo(input);
        sendJson(res, 200, wrapSuccess(result as unknown as Record<string, unknown>));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log(`HTTP: /api/generate-kling-video error: ${message}`);
        sendJson(res, 500, wrapError(message, 'KLING_ERROR'));
      }
      return;
    }

    // POST /api/generate-kling-text-video - Text to video
    if (path === '/api/generate-kling-text-video' && req.method === 'POST') {
      try {
        const body = await parseBody(req);
        log('HTTP: /api/generate-kling-text-video');

        if (!body.prompt) {
          sendJson(res, 400, wrapError('Missing "prompt" field', 'MISSING_PROMPT'));
          return;
        }

        const input: KlingVideoInput = {
          asset_id: (body.asset_id as string) || `asset_${Date.now()}`,
          prompt: body.prompt as string,
          negative_prompt: body.negative_prompt as string,
          duration: (body.duration as 5 | 10) || 5,
          aspect_ratio: (body.aspect_ratio as '16:9' | '9:16' | '1:1') || '16:9',
          cfg_scale: body.cfg_scale as number,
          user_id: body.user_id as string,
          model: body.model as string,
          sound: body.sound as boolean,
        };

        const result = await klingGenerateTextVideo(input);
        sendJson(res, 200, wrapSuccess(result as unknown as Record<string, unknown>));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log(`HTTP: /api/generate-kling-text-video error: ${message}`);
        sendJson(res, 500, wrapError(message, 'KLING_ERROR'));
      }
      return;
    }

    // POST /api/generate-kling-avatar - Avatar/lip-sync video
    if (path === '/api/generate-kling-avatar' && req.method === 'POST') {
      try {
        const body = await parseBody(req);
        log('HTTP: /api/generate-kling-avatar');

        if (!body.image_url || !body.audio_url) {
          sendJson(res, 400, wrapError('Missing "image_url" or "audio_url" field', 'MISSING_FIELDS'));
          return;
        }

        const input: KlingAvatarInput = {
          asset_id: (body.asset_id as string) || `asset_${Date.now()}`,
          image_url: body.image_url as string,
          audio_url: body.audio_url as string,
          prompt: body.prompt as string,
          user_id: body.user_id as string,
          model: body.model as string,
        };

        const result = await klingGenerateAvatar(input);
        sendJson(res, 200, wrapSuccess(result as unknown as Record<string, unknown>));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log(`HTTP: /api/generate-kling-avatar error: ${message}`);
        sendJson(res, 500, wrapError(message, 'KLING_ERROR'));
      }
      return;
    }

    // GET /api/kling-video-status/:taskId - Check video generation status
    if (path.startsWith('/api/kling-video-status/') && req.method === 'GET') {
      try {
        const taskId = path.replace('/api/kling-video-status/', '');
        log(`HTTP: /api/kling-video-status/${taskId}`);

        const status = getKlingStatus(taskId);
        if (!status) {
          sendJson(res, 404, wrapError('Task not found', 'TASK_NOT_FOUND'));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(status));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sendJson(res, 500, wrapError(message, 'STATUS_ERROR'));
      }
      return;
    }

    // GET /api/studio/tasks - List all tasks (debug endpoint)
    if (path === '/api/studio/tasks' && req.method === 'GET') {
      try {
        log('HTTP: /api/studio/tasks');
        const tasks = listTasks();
        sendJson(res, 200, wrapSuccess({ tasks, count: tasks.length }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sendJson(res, 500, wrapError(message, 'LIST_ERROR'));
      }
      return;
    }

    // ========================================================================
    // Full MCP Protocol Endpoint
    // ========================================================================

    // (b) MCP endpoint - supports GET, POST, DELETE via StreamableHTTPServerTransport
    // Handle at /mcp, /sse, /sse/ (ChatGPT uses trailing slash), and root / for compatibility
    if (path === '/mcp' || path === '/sse' || path === '/sse/' || (path === '/' && (req.method === 'POST' || req.method === 'DELETE'))) {
      try {
        // Track SSE connections for keepalive (GET requests establish SSE streams)
        if (req.method === 'GET') {
          activeSseConnections.add(res);
          log(`HTTP: SSE stream opened via GET ${path} (${activeSseConnections.size} active) - keepalive enabled`);

          // Clean up when connection closes
          res.on('close', () => {
            activeSseConnections.delete(res);
            log(`HTTP: SSE stream closed (${activeSseConnections.size} active)`);
          });

          res.on('error', (err) => {
            activeSseConnections.delete(res);
            log(`HTTP: SSE stream error: ${err.message}`);
          });
        } else if (req.method === 'POST') {
          log(`HTTP: StreamableHTTP request via POST ${path} - no keepalive needed`);
        }

        await transport.handleRequest(req, res);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log(`HTTP: Error handling MCP request: ${message}`);

        // Remove from active connections on error
        activeSseConnections.delete(res);

        if (!res.writableEnded) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: message }));
        }
      }
      return;
    }

    // 404 for all other paths
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  // Configure HTTP server timeouts to prevent premature connection drops
  httpServer.keepAliveTimeout = timeoutMs;
  httpServer.headersTimeout = timeoutMs + 1000; // Slightly longer than keepAliveTimeout

  httpServer.listen(port, host, () => {
    log(`HTTP Server listening on http://${host}:${port}`);
    // Advertise port + pid in daemon.meta so clients can discover the daemon.
    try {
      setDaemonPort(port);
    } catch (err) {
      log(`Daemon: failed to write port to meta: ${err instanceof Error ? err.message : String(err)}`);
    }
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║  Decibel MCP Server - HTTP Mode  v${PKG.version}${' '.repeat(Math.max(0, 24 - PKG.version.length))}║
╠══════════════════════════════════════════════════════════════╣
║  Endpoints:                                                  ║
║    GET  /health           Health check                       ║
║    GET  /tools            List tools                         ║
║    POST /call             Execute tool (generic)             ║
║    POST /batch            Batch dispatch (parallel)          ║
║    GET  /events           Dispatch event log (query)         ║
║    POST /dojo/wish        Add wish                           ║
║    POST /dojo/propose     Create proposal                    ║
║    POST /dojo/scaffold    Scaffold experiment                ║
║    POST /dojo/run         Run experiment                     ║
║    POST /dojo/results     Get results                        ║
║    POST /dojo/artifact    Read artifact file                 ║
║    GET  /dojo/list        List all                           ║
║    POST /mcp              Full MCP protocol                  ║
╠══════════════════════════════════════════════════════════════╣
║  Base URL: http://${host}:${port}${' '.repeat(Math.max(0, 40 - port.toString().length - host.length))}║
${authToken ? '║  Auth:     Bearer token required                             ║' : '║  Auth:     None (set DECIBEL_AUTH_TOKEN env var)             ║'}
╠══════════════════════════════════════════════════════════════╣
║  SSE Settings:                                               ║
║    Keepalive:  ${sseKeepaliveMs}ms${' '.repeat(Math.max(0, 43 - sseKeepaliveMs.toString().length))}║
║    Timeout:    ${timeoutMs}ms${' '.repeat(Math.max(0, 43 - timeoutMs.toString().length))}║
║    Retry:      ${retryIntervalMs}ms${' '.repeat(Math.max(0, 43 - retryIntervalMs.toString().length))}║
╠══════════════════════════════════════════════════════════════╣
║  Response format: {"status": "executed"|"error", ...}        ║
╚══════════════════════════════════════════════════════════════╝
`);
  });

  // Return lifecycle handle for TransportAdapter.stop()
  return {
    async stop() {
      clearInterval(keepaliveInterval);
      clearInterval(rateLimiterCleanup);

      // Stop accepting new connections
      httpServer.close(() => {});

      // Wait for in-flight requests to drain (max 10s)
      if (activeRequests.size > 0) {
        log(`HTTP: Waiting for ${activeRequests.size} in-flight request(s) to drain...`);
        const drainStart = Date.now();
        while (activeRequests.size > 0 && Date.now() - drainStart < 10_000) {
          await new Promise(r => setTimeout(r, 100));
        }
        if (activeRequests.size > 0) {
          log(`HTTP: ${activeRequests.size} request(s) still active after 10s drain timeout`);
        }
      }

      // Close SSE connections
      for (const conn of activeSseConnections) {
        try { if (!conn.writableEnded) conn.end(); } catch { /* ignore */ }
      }
      activeSseConnections.clear();

      // Final close
      await new Promise<void>((resolve) => {
        // Server may already be closed from above — handle gracefully
        httpServer.close(() => resolve());
        // If already closed, resolve immediately
        setTimeout(resolve, 100);
      });
      log('HTTP server stopped');
    },
  };
}

/**
 * Parse command line arguments for HTTP mode
 */
export function parseHttpArgs(args: string[]): {
  httpMode: boolean;
  port?: number;
  authToken?: string;
  host?: string;
  sseKeepaliveMs?: number;
  timeoutMs?: number;
  retryIntervalMs?: number;
} {
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
