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
import { timingSafeEqual } from 'crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { log } from './config.js';
import { isSupabaseConfigured } from './lib/supabase.js';
import type { ToolKernel, DispatchContext } from './kernel.js';
import { getLicenseValidator } from './license.js';
import { listProjects } from './projectRegistry.js';
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

// Module-level kernel reference — set by startHttpServer()
let kernel: ToolKernel;
let landingPageHtml = '';
let startedAt: number = 0;
let sseConnectionCount = 0;

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

  constructor(maxRpm: number) {
    this.maxRpm = maxRpm;
  }

  /** Returns true if the request should be allowed */
  check(ip: string): boolean {
    const now = Date.now();
    const entry = this.windows.get(ip);

    if (!entry || now - entry.start > 60_000) {
      this.windows.set(ip, { count: 1, start: now });
      return true;
    }

    entry.count++;
    return entry.count <= this.maxRpm;
  }

  /** Update the max RPM (e.g. on config reload) */
  setMaxRpm(rpm: number): void {
    this.maxRpm = rpm;
  }

  /** Periodic cleanup of expired windows */
  cleanup(): void {
    const now = Date.now();
    for (const [ip, entry] of this.windows) {
      if (now - entry.start > 60_000) {
        this.windows.delete(ip);
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
function buildLandingPageHtml(facades: { name: string; description: string; actions: string[] }[]): string {
  const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const totalActions = facades.reduce((sum, f) => sum + f.actions.length, 0);

  const toolSections = facades
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(f => {
      const rows = f.actions
        .sort()
        .map(action => {
          return `        <tr><td class="tool-name">${escHtml(f.name)}(${escHtml(action)})</td><td class="tool-desc"></td></tr>`;
        })
        .join('\n');
      return `      <div class="module-section">
        <h3>${escHtml(f.name)} <span class="tool-count">${f.actions.length} actions</span></h3>
        <p style="color:#888;font-size:0.85rem;margin-bottom:0.75rem">${escHtml(f.description.split('.')[0])}</p>
        <table>${rows}</table>
      </div>`;
    }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Decibel Tools - ${facades.length} Facades</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      background: #0a0a0a;
      color: #e5e5e5;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 2rem;
    }
    .container { max-width: 900px; width: 100%; }
    h1 {
      font-size: 2.5rem;
      font-weight: 700;
      margin-bottom: 0.5rem;
      background: linear-gradient(135deg, #fff 0%, #888 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .tagline { font-size: 1.25rem; color: #888; margin-bottom: 0.5rem; }
    .tool-total { font-size: 0.9rem; color: #555; margin-bottom: 2rem; }
    .features { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem; margin-bottom: 2rem; }
    .feature { background: #111; border: 1px solid #222; border-radius: 8px; padding: 1.25rem; }
    .feature h3 { font-size: 0.9rem; font-weight: 600; margin-bottom: 0.5rem; color: #fff; }
    .feature p { font-size: 0.85rem; color: #888; line-height: 1.5; }
    .module-section { background: #111; border: 1px solid #222; border-radius: 8px; padding: 1.25rem; margin-bottom: 1rem; }
    .module-section h3 { font-size: 0.95rem; font-weight: 600; margin-bottom: 0.75rem; color: #fff; text-transform: capitalize; }
    .tool-count { font-size: 0.75rem; color: #555; font-weight: 400; margin-left: 0.5rem; }
    table { width: 100%; border-collapse: collapse; }
    tr { border-bottom: 1px solid #1a1a1a; }
    tr:last-child { border-bottom: none; }
    td { padding: 0.4rem 0; vertical-align: top; font-size: 0.8rem; }
    .tool-name { color: #ccc; font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace; white-space: nowrap; padding-right: 1rem; width: 1%; }
    .tool-desc { color: #666; }
    footer { margin-top: 2rem; padding-top: 2rem; font-size: 0.8rem; color: #444; }
    footer a { color: #666; text-decoration: none; }
    footer a:hover { color: #888; }
    @media (max-width: 600px) { .features { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <div class="container">
    <h1>Decibel Tools</h1>
    <p class="tagline">Project intelligence for AI coding agents</p>
    <p class="tool-total">${facades.length} facades, ${totalActions} actions &middot; v${PKG.version}</p>
    <div class="features">
      <div class="feature"><h3>Sentinel</h3><p>Track epics, issues, and incidents. Your agent knows what's in flight.</p></div>
      <div class="feature"><h3>Architect</h3><p>Record ADRs and decisions. Context persists across sessions.</p></div>
      <div class="feature"><h3>Dojo</h3><p>Incubate ideas with wishes, proposals, and experiments.</p></div>
      <div class="feature"><h3>Oracle</h3><p>Get AI-powered recommendations on what to work on next.</p></div>
    </div>
${toolSections}
    <footer>
      <a href="https://github.com/decibelsystems/decibel-tools-beta">GitHub</a> &middot;
      <a href="https://modelcontextprotocol.io">MCP Protocol</a>
    </footer>
  </div>
</body>
</html>`;
}

// ============================================================================
// Status Envelope Types
// ============================================================================

interface StatusEnvelope {
  status: 'executed' | 'error' | 'unavailable';
  [key: string]: unknown;
}

interface ErrorEnvelope extends StatusEnvelope {
  status: 'error';
  error: string;
  code?: string;
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
 * Wrap a successful result in status envelope
 */
function wrapSuccess(data: Record<string, unknown>): StatusEnvelope {
  return { status: 'executed', ...data };
}

/**
 * Wrap an error in status envelope
 */
function wrapError(error: string, code?: string): ErrorEnvelope {
  return { status: 'error', error, ...(code && { code }) };
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
    const context: DispatchContext | undefined = req ? {
      agentId: req.headers['x-agent-id'] as string | undefined,
      runId: req.headers['x-run-id'] as string | undefined,
      parentCallId: req.headers['x-parent-call-id'] as string | undefined,
      scope: req.headers['x-scope'] as string | undefined,
      engagementMode: req.headers['x-engagement-mode'] as string | undefined,
      userKey: req.headers['x-user-key'] as string | undefined,
      requestId: req.headers['x-request-id'] as string | undefined,
      tier: tierOverride,
    } : tierOverride ? { tier: tierOverride } : undefined;

    const toolResult = await kernel.dispatch(tool, args, context);
    const text = toolResult.content[0]?.text;

    if (toolResult.isError) {
      return wrapError(text || 'Tool execution failed', 'TOOL_ERROR');
    }

    // Parse JSON result or wrap as message
    let result: Record<string, unknown>;
    if (text) {
      try {
        result = JSON.parse(text);
      } catch {
        result = { message: text };
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
  // Dev mode bypass
  if (process.env.DECIBEL_PRO === '1' || process.env.NODE_ENV !== 'production') {
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
  } = options;

  // Set module-level references
  kernel = kernelInstance;
  startedAt = Date.now();
  log(`HTTP: Using kernel with ${kernel.toolCount} tools`);

  // Rate limiter (clean up stale entries every 60s)
  const rateLimiter = new RateLimiter(rateLimitRpm);
  const rateLimiterCleanup = setInterval(() => rateLimiter.cleanup(), 60_000);

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
      // Daemon mode: restrict REST endpoints to localhost origins
      const origin = req.headers.origin || '';
      const localhostOrigins = ['http://localhost', 'http://127.0.0.1', 'https://localhost', 'https://127.0.0.1'];
      if (localhostOrigins.some(lo => origin.startsWith(lo)) || !origin) {
        res.setHeader('Access-Control-Allow-Origin', origin || 'http://localhost');
      }
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id, Accept');
    res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');

    // (a) Handle preflight OPTIONS requests
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Rate limiting (check before auth to prevent brute force)
    const clientIp = (req.socket.remoteAddress || '127.0.0.1').replace('::ffff:', '');
    if (!rateLimiter.check(clientIp)) {
      log(`HTTP: Rate limited ${clientIp}`);
      sendJson(res, 429, wrapError('Too many requests (rate limit exceeded)', 'RATE_LIMITED'));
      return;
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
      // Determine pro status from config license key
      const proEnabled = process.env.DECIBEL_PRO === '1' || process.env.NODE_ENV !== 'production';
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
        uptime_ms: uptimeMs,
        uptime_human: formatUptime(uptimeMs),
        pid: process.pid,
        facade_count: kernel.facadeCount,
        internal_tool_count: kernel.toolCount,
        connected_clients: activeSseConnections.size,
        active_requests: activeRequests.size,
        pro: licenseTier !== 'core',
        license_tier: licenseTier,
        supabase_configured: isSupabaseConfigured(),
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
    if (path === '/tools' && req.method === 'GET') {
      sendJson(res, 200, wrapSuccess({
        version: PKG.version,
        api_version: 'v1',
        tools: getAvailableTools(),
      }));
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
        sendJson(res, result.status === 'error' ? 400 : 200, result);
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
          requestId: (req.headers['x-request-id'] as string) || bodyContext.requestId,
          allowedFacades: bodyContext.allowedFacades as unknown as string[] | undefined,
          tier,
        };

        log(`HTTP: /batch — ${calls.length} calls (agent=${context.agentId || 'anonymous'}, tier=${tier})`);
        const results = await kernel.batch(calls, context);
        sendJson(res, 200, { status: 'executed', results });
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
        sendJson(res, result.status === 'error' ? 400 : 200, result);
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
        sendJson(res, result.status === 'error' ? 400 : 200, result);
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
        sendJson(res, result.status === 'error' ? 400 : 200, result);
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
        sendJson(res, result.status === 'error' ? 400 : 200, result);
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
        sendJson(res, result.status === 'error' ? 400 : 200, result);
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
        sendJson(res, result.status === 'error' ? 400 : 200, result);
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
        sendJson(res, result.status === 'error' ? 400 : 200, result);
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
        sendJson(res, result.status === 'error' ? 400 : 200, result);
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
        sendJson(res, result.status === 'error' ? 400 : 200, result);
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
        sendJson(res, result.status === 'error' ? 400 : 200, result);
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
        sendJson(res, result.status === 'error' ? 400 : 200, result);
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
        sendJson(res, result.status === 'error' ? 400 : 200, result);
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
        sendJson(res, result.status === 'error' ? 400 : 200, result);
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
        sendJson(res, result.status === 'error' ? 400 : 200, result);
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
        sendJson(res, result.status === 'error' ? 400 : 200, result);
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
        sendJson(res, result.status === 'error' ? 400 : 200, result);
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
        sendJson(res, result.status === 'error' ? 400 : 200, result);
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
        sendJson(res, result.status === 'error' ? 400 : 200, result);
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
        sendJson(res, result.status === 'error' ? 400 : 200, result);
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
        sendJson(res, result.status === 'error' ? 400 : 200, result);
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
        sendJson(res, result.status === 'error' ? 400 : 200, result);
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
${authToken ? '║  Auth:     Bearer token required                             ║' : '║  Auth:     None (use --auth-token for security)              ║'}
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
  port: number;
  authToken?: string;
  host?: string;
  sseKeepaliveMs?: number;
  timeoutMs?: number;
  retryIntervalMs?: number;
} {
  const httpMode = args.includes('--http');
  const portIndex = args.indexOf('--port');
  // Render sets PORT env var - use it if available
  const defaultPort = process.env.PORT ? parseInt(process.env.PORT, 10) : 8787;
  const port = portIndex !== -1 ? parseInt(args[portIndex + 1], 10) : defaultPort;
  const authIndex = args.indexOf('--auth-token');
  const authToken = authIndex !== -1 ? args[authIndex + 1] : undefined;
  const hostIndex = args.indexOf('--host');
  const host = hostIndex !== -1 ? args[hostIndex + 1] : '0.0.0.0';

  // SSE/Connection tuning arguments
  const keepaliveIndex = args.indexOf('--sse-keepalive');
  const sseKeepaliveMs = keepaliveIndex !== -1 ? parseInt(args[keepaliveIndex + 1], 10) : undefined;

  const timeoutIndex = args.indexOf('--timeout');
  const timeoutMs = timeoutIndex !== -1 ? parseInt(args[timeoutIndex + 1], 10) : undefined;

  const retryIndex = args.indexOf('--sse-retry');
  const retryIntervalMs = retryIndex !== -1 ? parseInt(args[retryIndex + 1], 10) : undefined;

  return { httpMode, port, authToken, host, sseKeepaliveMs, timeoutMs, retryIntervalMs };
}
