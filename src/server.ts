#!/usr/bin/env node

// ============================================================================
// Decibel MCP Server — Entry Point
// ============================================================================
// Parses CLI args, creates the kernel, and starts the appropriate transport(s).
// Phase 2: Transport adapters make this file a thin orchestrator.
// ============================================================================

import { getConfig, log } from './config.js';
import { createKernel } from './kernel.js';
import { StdioAdapter, HttpAdapter } from './transports/index.js';
import type { TransportConfig } from './transports/index.js';
import { parseHttpArgs } from './httpServer.js';

const config = getConfig();

log(`Starting Decibel MCP Server`);
log(`Environment: ${config.env}`);
log(`Organization: ${config.org}`);
log(`Root Directory: ${config.rootDir}`);
if (process.env.DECIBEL_PRO === '1') log('Pro features: ENABLED');
if (process.env.DECIBEL_APPS === '1') log('Apps: ENABLED');

async function main() {
  const kernel = await createKernel();
  const { httpMode, port, authToken, host, sseKeepaliveMs, timeoutMs, retryIntervalMs } = parseHttpArgs(process.argv);

  const transportConfig: TransportConfig = {
    port, host, authToken, sseKeepaliveMs, timeoutMs, retryIntervalMs,
  };

  if (httpMode) {
    const http = new HttpAdapter();
    await http.start(kernel, transportConfig);
  } else {
    const stdio = new StdioAdapter();
    await stdio.start(kernel, transportConfig);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
