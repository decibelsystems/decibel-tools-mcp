/**
 * HTTP Server Mode for Decibel MCP
 *
 * Exposes the MCP server over HTTP for remote access (e.g., ChatGPT, Mother).
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
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { log } from './config.js';
import {
  createProposal,
  scaffoldExperiment,
  listDojo,
  runExperiment,
  getExperimentResults,
  addWish,
  listWishes,
  canGraduate,
  readArtifact,
  isDojoError,
  CreateProposalInput,
  ScaffoldExperimentInput,
  ListDojoInput,
  RunExperimentInput,
  GetResultsInput,
  AddWishInput,
  ListWishesInput,
  CanGraduateInput,
  ReadArtifactInput,
} from './tools/dojo.js';
import {
  dojoBench,
  isDojoBenchError,
  DojoBenchInput,
} from './tools/dojoBench.js';
import {
  decibelBench,
  decibelBenchCompare,
  isDecibelBenchError,
  isBenchCompareError,
  DecibelBenchInput,
  BenchCompareInput,
} from './tools/bench.js';
import {
  contextRefresh,
  ContextRefreshInput,
  contextPin,
  ContextPinInput,
  contextUnpin,
  ContextUnpinInput,
  contextList,
  ContextListInput,
  eventAppend,
  EventAppendInput,
  eventSearch,
  EventSearchInput,
  artifactList,
  ArtifactListInput,
  artifactRead,
  ArtifactReadInput,
  isContextError,
} from './tools/context.js';
import {
  createPolicy,
  CreatePolicyInput,
  listPolicies,
  ListPoliciesInput,
  getPolicy,
  GetPolicyInput,
  compileOversight,
  CompileOversightInput,
  isPolicyError,
} from './tools/policy.js';
import {
  createTestSpec,
  CreateTestSpecInput,
  listTestSpecs,
  ListTestSpecsInput,
  compileTests,
  CompileTestsInput,
  auditPolicies,
  AuditPoliciesInput,
  isTestSpecError,
} from './tools/testSpec.js';

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
    return { version: pkg.version || '0.0.0', name: pkg.name || 'decibel-tools-mcp' };
  } catch {
    return { version: '0.3.0', name: 'decibel-tools-mcp' };
  }
}

const PKG = getVersion();

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
 * Parse JSON body from request
 */
async function parseBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
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
// Tool Executor
// ============================================================================

/**
 * Execute a Dojo tool and return normalized result
 */
async function executeDojoTool(
  tool: string,
  args: Record<string, unknown>
): Promise<StatusEnvelope> {
  try {
    let result: unknown;

    switch (tool) {
      case 'dojo_add_wish':
        result = await addWish(args as unknown as AddWishInput);
        break;
      case 'dojo_create_proposal':
        result = await createProposal(args as unknown as CreateProposalInput);
        break;
      case 'dojo_scaffold_experiment':
        result = await scaffoldExperiment(args as unknown as ScaffoldExperimentInput);
        break;
      case 'dojo_run_experiment':
        result = await runExperiment(args as unknown as RunExperimentInput);
        break;
      case 'dojo_get_results':
        result = await getExperimentResults(args as unknown as GetResultsInput);
        break;
      case 'dojo_list':
        result = await listDojo(args as unknown as ListDojoInput);
        break;
      case 'dojo_list_wishes':
        result = await listWishes(args as unknown as ListWishesInput);
        break;
      case 'dojo_can_graduate':
        result = await canGraduate(args as unknown as CanGraduateInput);
        break;
      case 'dojo_read_artifact':
        result = await readArtifact(args as unknown as ReadArtifactInput);
        break;
      case 'dojo_bench':
        result = await dojoBench(args as unknown as DojoBenchInput);
        break;
      // Benchmark tools (ISS-0014)
      case 'decibel_bench':
        result = await decibelBench(args as unknown as DecibelBenchInput);
        break;
      case 'decibel_bench_compare':
        result = await decibelBenchCompare(args as unknown as BenchCompareInput);
        break;
      // Context Pack tools
      case 'decibel_context_refresh':
        result = await contextRefresh(args as unknown as ContextRefreshInput);
        break;
      case 'decibel_context_pin':
        result = await contextPin(args as unknown as ContextPinInput);
        break;
      case 'decibel_context_unpin':
        result = await contextUnpin(args as unknown as ContextUnpinInput);
        break;
      case 'decibel_context_list':
        result = await contextList(args as unknown as ContextListInput);
        break;
      case 'decibel_event_append':
        result = await eventAppend(args as unknown as EventAppendInput);
        break;
      case 'decibel_event_search':
        result = await eventSearch(args as unknown as EventSearchInput);
        break;
      case 'decibel_artifact_list':
        result = await artifactList(args as unknown as ArtifactListInput);
        break;
      case 'decibel_artifact_read':
        result = await artifactRead(args as unknown as ArtifactReadInput);
        break;
      // Architect Policy tools (ADR-004 Oversight Pack)
      case 'architect_createPolicy':
        result = await createPolicy(args as unknown as CreatePolicyInput);
        break;
      case 'architect_listPolicies':
        result = await listPolicies(args as unknown as ListPoliciesInput);
        break;
      case 'architect_getPolicy':
        result = await getPolicy(args as unknown as GetPolicyInput);
        break;
      case 'architect_compileOversight':
        result = await compileOversight(args as unknown as CompileOversightInput);
        break;
      // Sentinel Test tools (ADR-004 Oversight Pack)
      case 'sentinel_createTestSpec':
        result = await createTestSpec(args as unknown as CreateTestSpecInput);
        break;
      case 'sentinel_listTestSpecs':
        result = await listTestSpecs(args as unknown as ListTestSpecsInput);
        break;
      case 'sentinel_compileTests':
        result = await compileTests(args as unknown as CompileTestsInput);
        break;
      case 'sentinel_auditPolicies':
        result = await auditPolicies(args as unknown as AuditPoliciesInput);
        break;
      default:
        return wrapError(`Unknown tool: ${tool}`, 'UNKNOWN_TOOL');
    }

    // Check for Dojo error response
    if (isDojoError(result)) {
      return wrapError(result.error, `EXIT_${result.exitCode}`);
    }
    // Check for Bench error response
    if (isDojoBenchError(result)) {
      return wrapError(result.error, `EXIT_${result.exitCode}`);
    }
    // Check for Decibel Bench error response
    if (isDecibelBenchError(result)) {
      return wrapError(result.error, `EXIT_${result.exitCode}`);
    }
    // Check for Bench Compare error response
    if (isBenchCompareError(result)) {
      return wrapError(result.error, `EXIT_${result.exitCode}`);
    }
    // Check for Context error response
    if (isContextError(result)) {
      return wrapError(result.error, 'CONTEXT_ERROR');
    }
    // Check for Policy error response
    if (isPolicyError(result)) {
      return wrapError(result.message, result.error);
    }
    // Check for TestSpec error response
    if (isTestSpecError(result)) {
      return wrapError(result.message, result.error);
    }

    return wrapSuccess(result as Record<string, unknown>);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // Check for specific error types
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
 * Get list of available tools
 */
function getAvailableTools(): { name: string; description: string }[] {
  return [
    { name: 'dojo_add_wish', description: 'Log a capability wish with optional context' },
    { name: 'dojo_create_proposal', description: 'Create a proposal (can link to wish_id)' },
    { name: 'dojo_scaffold_experiment', description: 'Create experiment from proposal' },
    { name: 'dojo_run_experiment', description: 'Run experiment in sandbox mode' },
    { name: 'dojo_get_results', description: 'Get experiment results' },
    { name: 'dojo_list', description: 'List proposals, experiments, wishes' },
    { name: 'dojo_list_wishes', description: 'List wishes' },
    { name: 'dojo_can_graduate', description: 'Check graduation eligibility' },
    { name: 'dojo_read_artifact', description: 'Read artifact from experiment results' },
    { name: 'dojo_bench', description: 'Run benchmark on a Dojo experiment' },
    // Context Pack tools (ADR-002)
    { name: 'decibel_context_refresh', description: 'Compile full context pack' },
    { name: 'decibel_context_pin', description: 'Pin a fact to persistent memory' },
    { name: 'decibel_context_unpin', description: 'Remove a pinned fact' },
    { name: 'decibel_context_list', description: 'List pinned facts' },
    { name: 'decibel_event_append', description: 'Append event to journal' },
    { name: 'decibel_event_search', description: 'Search events' },
    { name: 'decibel_artifact_list', description: 'List artifacts for a run' },
    { name: 'decibel_artifact_read', description: 'Read artifact by run_id and name' },
    // Architect Policy tools (ADR-004 Oversight Pack)
    { name: 'architect_createPolicy', description: 'Create a policy atom' },
    { name: 'architect_listPolicies', description: 'List policies (filter by severity/tags)' },
    { name: 'architect_getPolicy', description: 'Get a specific policy by ID' },
    { name: 'architect_compileOversight', description: 'Compile policies into documentation' },
    // Sentinel Test tools (ADR-004 Oversight Pack)
    { name: 'sentinel_createTestSpec', description: 'Create a test specification' },
    { name: 'sentinel_listTestSpecs', description: 'List test specifications' },
    { name: 'sentinel_compileTests', description: 'Compile test manifest' },
    { name: 'sentinel_auditPolicies', description: 'Audit policy compliance' },
  ];
}

export interface HttpServerOptions {
  port: number;
  authToken?: string;
  host?: string;
}

/**
 * Start an HTTP server that handles MCP requests
 *
 * Note: This creates a single stateless transport. Each request is handled
 * independently. For full session support, this would need to be expanded.
 */
export async function startHttpServer(
  server: Server,
  options: HttpServerOptions
): Promise<void> {
  const { port, authToken, host = '0.0.0.0' } = options;

  // Create transport in STATELESS mode (better for ChatGPT compatibility)
  // Setting sessionIdGenerator to undefined disables session tracking
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // Stateless mode
  });

  // Connect the MCP server to the transport
  await server.connect(transport);

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const path = url.pathname;

    log(`HTTP: ${req.method} ${path}`);

    // CORS headers for browser access (required for ChatGPT connector)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id, Accept');
    res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');

    // (a) Handle preflight OPTIONS requests
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

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
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        version: PKG.version,
        api_version: 'v1',
      }));
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

    // Auth check (if token provided)
    if (authToken) {
      const authHeader = req.headers.authorization;
      if (!authHeader || authHeader !== `Bearer ${authToken}`) {
        log('HTTP: Unauthorized request');
        sendJson(res, 401, wrapError('Unauthorized', 'UNAUTHORIZED'));
        return;
      }
    }

    // ========================================================================
    // Simple REST Endpoints (for Mother and other AI agents)
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

        log(`HTTP: /call tool=${tool}`);
        const result = await executeDojoTool(tool, args);
        sendJson(res, result.status === 'error' ? 400 : 200, result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sendJson(res, 400, wrapError(message, 'PARSE_ERROR'));
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
        const result = await executeDojoTool('dojo_add_wish', body);
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
        const result = await executeDojoTool('dojo_create_proposal', body);
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
        const result = await executeDojoTool('dojo_scaffold_experiment', body);
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
        const result = await executeDojoTool('dojo_run_experiment', body);
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
        const result = await executeDojoTool('dojo_get_results', body);
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
        const result = await executeDojoTool('dojo_list', body);
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
        const result = await executeDojoTool('dojo_list_wishes', body);
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
        const result = await executeDojoTool('dojo_can_graduate', body);
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
        const result = await executeDojoTool('dojo_read_artifact', body);
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
        const result = await executeDojoTool('dojo_bench', body);
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
        const result = await executeDojoTool('decibel_bench', body);
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
        const result = await executeDojoTool('decibel_bench_compare', body);
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
        const result = await executeDojoTool('decibel_context_refresh', body);
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
        const result = await executeDojoTool('decibel_context_pin', body);
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
        const result = await executeDojoTool('decibel_context_unpin', body);
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
        const result = await executeDojoTool('decibel_context_list', body);
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
        const result = await executeDojoTool('decibel_event_append', body);
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
        const result = await executeDojoTool('decibel_event_search', body);
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
        const result = await executeDojoTool('decibel_artifact_list', body);
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
        const result = await executeDojoTool('decibel_artifact_read', body);
        sendJson(res, result.status === 'error' ? 400 : 200, result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sendJson(res, 400, wrapError(message, 'PARSE_ERROR'));
      }
      return;
    }

    // ========================================================================
    // Full MCP Protocol Endpoint
    // ========================================================================

    // (b) MCP endpoint - supports GET, POST, DELETE via StreamableHTTPServerTransport
    if (path === '/mcp') {
      try {
        await transport.handleRequest(req, res);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log(`HTTP: Error handling MCP request: ${message}`);
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
║  Response format: {"status": "executed"|"error", ...}        ║
╚══════════════════════════════════════════════════════════════╝
`);
  });
}

/**
 * Parse command line arguments for HTTP mode
 */
export function parseHttpArgs(args: string[]): {
  httpMode: boolean;
  port: number;
  authToken?: string;
  host?: string;
} {
  const httpMode = args.includes('--http');
  const portIndex = args.indexOf('--port');
  const port = portIndex !== -1 ? parseInt(args[portIndex + 1], 10) : 8787;
  const authIndex = args.indexOf('--auth-token');
  const authToken = authIndex !== -1 ? args[authIndex + 1] : undefined;
  const hostIndex = args.indexOf('--host');
  const host = hostIndex !== -1 ? args[hostIndex + 1] : '0.0.0.0';

  return { httpMode, port, authToken, host };
}
