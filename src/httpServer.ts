/**
 * HTTP Server Mode for Decibel MCP
 *
 * Exposes the MCP server over HTTP for remote access (e.g., ChatGPT).
 *
 * Usage:
 *   node dist/server.js --http --port 8787
 *   node dist/server.js --http --port 8787 --auth-token YOUR_SECRET
 *
 * Then tunnel with ngrok:
 *   ngrok http 8787
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { randomUUID } from 'crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { log } from './config.js';

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
      res.end(JSON.stringify({ status: 'ok', name: 'decibel-tools-mcp', version: '0.1.0' }));
      return;
    }

    // Health check at /health too
    if (path === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
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
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }
    }

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
║  Decibel MCP Server - HTTP Mode                              ║
╠══════════════════════════════════════════════════════════════╣
║  Endpoint:  http://${host}:${port}/mcp${' '.repeat(Math.max(0, 31 - port.toString().length - host.length))}║
║  Health:    http://${host}:${port}/health${' '.repeat(Math.max(0, 28 - port.toString().length - host.length))}║
${authToken ? '║  Auth:     Bearer token required                             ║' : '║  Auth:     None (use --auth-token for security)              ║'}
╠══════════════════════════════════════════════════════════════╣
║  To expose via ngrok:                                        ║
║    ngrok http ${port}${' '.repeat(Math.max(0, 47 - port.toString().length))}║
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
