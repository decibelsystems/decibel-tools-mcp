#!/usr/bin/env node

// ============================================================================
// Decibel MCP Server — Entry Point
// ============================================================================
// Modes:
//   node dist/server.js              → stdio (Claude Code, Cursor)
//   node dist/server.js --bridge     → stdio with daemon proxy (auto-detect)
//   node dist/server.js --bridge http://...  → stdio with explicit daemon
//   node dist/server.js --http       → HTTP only (ChatGPT, Mother)
//   node dist/server.js --daemon     → daemon mode (HTTP + PID + graceful shutdown)
//   node dist/server.js --daemon --stdio  → daemon + stdio from one process
//   node dist/server.js --daemon install  → install macOS launchd plist
//   node dist/server.js --daemon uninstall
//   node dist/server.js --daemon status
// ============================================================================

import fs from 'fs';
import path from 'path';
import { getConfig, log } from './config.js';
import { createKernel } from './kernel.js';
import type { DispatchEvent } from './kernel.js';
import { StdioAdapter, HttpAdapter, BridgeAdapter } from './transports/index.js';
import type { TransportAdapter, TransportConfig } from './transports/index.js';
import { parseHttpArgs } from './httpServer.js';
import {
  checkRunning,
  writePid,
  removePid,
  installShutdownHandlers,
  handleDaemonSubcommand,
  getLogPath,
} from './daemon.js';

const config = getConfig();

log(`Starting Decibel MCP Server`);
log(`Environment: ${config.env}`);
log(`Organization: ${config.org}`);
log(`Root Directory: ${config.rootDir}`);
if (process.env.DECIBEL_PRO === '1') log('Pro features: ENABLED');
if (process.env.DECIBEL_APPS === '1') log('Apps: ENABLED');

async function main() {
  const args = process.argv;
  const daemonMode = args.includes('--daemon');

  // Handle daemon subcommands (install, uninstall, status) — exits process
  if (daemonMode && handleDaemonSubcommand(args)) return;

  // Parse transport config
  const { httpMode, port, authToken, host, sseKeepaliveMs, timeoutMs, retryIntervalMs } = parseHttpArgs(args);

  const transportConfig: TransportConfig = {
    port: daemonMode ? (port || 4888) : port,  // Daemon defaults to 4888
    host,
    authToken,
    sseKeepaliveMs,
    timeoutMs,
    retryIntervalMs,
  };

  // Daemon lifecycle: check lock, write PID, setup shutdown
  if (daemonMode) {
    const existingPid = checkRunning();
    if (existingPid) {
      console.error(`Daemon already running (PID ${existingPid}).`);
      console.error(`Kill it with: kill ${existingPid}`);
      console.error(`Or remove stale PID: rm ~/.decibel/daemon.pid`);
      process.exit(1);
    }

    writePid();
    log(`Daemon: mode active, PID ${process.pid}, port ${transportConfig.port}`);
    log(`Daemon: log file at ${getLogPath()}`);
  }

  // Create kernel
  const kernel = await createKernel();
  const adapters: TransportAdapter[] = [];

  // In daemon mode, log all dispatches to dispatch.jsonl
  if (daemonMode) {
    const logsDir = path.join(process.env.HOME || '~', '.decibel', 'logs');
    fs.mkdirSync(logsDir, { recursive: true });
    const dispatchLogPath = path.join(logsDir, 'dispatch.jsonl');

    const writeEvent = (evt: DispatchEvent) => {
      fs.appendFileSync(dispatchLogPath, JSON.stringify(evt) + '\n');
    };

    kernel.on('dispatch', writeEvent);
    kernel.on('result', writeEvent);
    kernel.on('error', writeEvent);
    log(`Daemon: dispatch log at ${dispatchLogPath}`);
  }

  // Start transport(s)
  if (daemonMode) {
    // Daemon always starts HTTP
    const http = new HttpAdapter();
    await http.start(kernel, transportConfig);
    adapters.push(http);

    // Optionally also start stdio (for dual-mode)
    if (args.includes('--stdio')) {
      const stdio = new StdioAdapter();
      await stdio.start(kernel, transportConfig);
      adapters.push(stdio);
    }

    // Install graceful shutdown handlers
    installShutdownHandlers(async () => {
      log('Daemon: stopping all transports...');
      await Promise.all(adapters.map(a => a.stop()));
    });
  } else if (httpMode) {
    const http = new HttpAdapter();
    await http.start(kernel, transportConfig);
    adapters.push(http);
  } else if (args.includes('--bridge')) {
    // Bridge mode: stdio with daemon proxy
    const bridgeIdx = args.indexOf('--bridge');
    const nextArg = args[bridgeIdx + 1];
    // If next arg looks like a URL, use it; otherwise auto-detect
    const explicitUrl = nextArg && nextArg.startsWith('http') ? nextArg : null;
    const daemonUrl = explicitUrl || `http://127.0.0.1:${transportConfig.port || 4888}`;

    const bridge = new BridgeAdapter(daemonUrl);
    await bridge.start(kernel, transportConfig);
    adapters.push(bridge);
  } else {
    const stdio = new StdioAdapter();
    await stdio.start(kernel, transportConfig);
    adapters.push(stdio);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  removePid(); // Clean up PID on crash
  process.exit(1);
});
