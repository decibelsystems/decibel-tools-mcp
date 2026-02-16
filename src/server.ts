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
  rotateLog,
  checkCrashLoop,
  scheduleHealthReset,
  resetCrashes,
} from './daemon.js';
import { loadConfig } from './daemonConfig.js';
import { getLicenseValidator } from './license.js';

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

  // Handle --reset-crashes flag
  if (args.includes('--reset-crashes')) {
    resetCrashes();
    process.exit(0);
  }

  // Parse transport config
  const { httpMode, port, authToken, host, sseKeepaliveMs, timeoutMs, retryIntervalMs } = parseHttpArgs(args);

  // Load daemon config file (CLI flags override config)
  const daemonConfig = loadConfig();

  const transportConfig: TransportConfig = {
    port: daemonMode ? (port || daemonConfig.daemon.port || 4888) : port,
    host: host || (daemonMode ? daemonConfig.daemon.host : undefined),
    authToken: authToken || daemonConfig.daemon.auth_token,
    sseKeepaliveMs,
    timeoutMs,
    retryIntervalMs,
    isDaemon: daemonMode,
    rateLimitRpm: daemonConfig.daemon.rate_limit_rpm,
    configLicenseKey: daemonConfig.license?.key,
  };

  // Daemon lifecycle: check lock, crash loop, write PID, setup shutdown
  if (daemonMode) {
    // Crash loop protection: exit cleanly if restarting too fast
    if (!checkCrashLoop()) {
      process.exit(0); // Exit 0 tells launchd to stop retrying
    }

    const existingPid = checkRunning();
    if (existingPid) {
      console.error(`Daemon already running (PID ${existingPid}).`);
      console.error(`Kill it with: kill ${existingPid}`);
      console.error(`Or remove stale PID: rm ~/.decibel/daemon.pid`);
      process.exit(1);
    }

    writePid();
    scheduleHealthReset(); // Reset crash counter after 5 minutes of healthy running
    log(`Daemon: mode active, PID ${process.pid}, port ${transportConfig.port}`);
    log(`Daemon: log file at ${getLogPath()}`);

    // Pre-validate license key from config (fire and forget)
    if (daemonConfig.license?.key) {
      getLicenseValidator().prevalidate(daemonConfig.license.key);
    }
  }

  // Create kernel
  const kernel = await createKernel();
  const adapters: TransportAdapter[] = [];

  // In daemon mode, log all dispatches to dispatch.jsonl (async buffered writes + rotation)
  if (daemonMode) {
    const logsDir = path.join(process.env.HOME || '~', '.decibel', 'logs');
    fs.mkdirSync(logsDir, { recursive: true });
    const dispatchLogPath = path.join(logsDir, 'dispatch.jsonl');
    const daemonLogPath = path.join(logsDir, 'daemon.log');

    // Parse log rotation CLI flags
    const maxSizeIdx = args.indexOf('--log-max-size');
    const maxFilesIdx = args.indexOf('--log-max-files');
    const logMaxSizeBytes = maxSizeIdx !== -1
      ? parseInt(args[maxSizeIdx + 1], 10) * 1024 * 1024
      : 10 * 1024 * 1024; // 10MB default
    const logMaxFiles = maxFilesIdx !== -1
      ? parseInt(args[maxFilesIdx + 1], 10)
      : 3;

    let writesSinceRotationCheck = 0;

    // Buffered async writer — batches writes to reduce I/O
    let writeBuffer: string[] = [];
    let writeTimer: ReturnType<typeof setTimeout> | null = null;
    const flushBuffer = async () => {
      if (writeBuffer.length === 0) return;
      const batch = writeBuffer.join('');
      writeBuffer = [];
      try {
        // Check rotation every 100 writes
        writesSinceRotationCheck += batch.split('\n').length;
        if (writesSinceRotationCheck >= 100) {
          writesSinceRotationCheck = 0;
          rotateLog(dispatchLogPath, logMaxSizeBytes, logMaxFiles);
        }
        await fs.promises.appendFile(dispatchLogPath, batch);
      } catch (err) {
        log(`Daemon: dispatch log write error: ${err}`);
      }
    };

    const writeEvent = (evt: DispatchEvent) => {
      writeBuffer.push(JSON.stringify(evt) + '\n');
      // Flush every 500ms or when buffer reaches 50 entries
      if (writeBuffer.length >= 50) {
        if (writeTimer) clearTimeout(writeTimer);
        writeTimer = null;
        flushBuffer();
      } else if (!writeTimer) {
        writeTimer = setTimeout(() => {
          writeTimer = null;
          flushBuffer();
        }, 500);
      }
    };

    kernel.on('dispatch', writeEvent);
    kernel.on('result', writeEvent);
    kernel.on('error', writeEvent);

    // SIGHUP: rotate daemon.log (launchd sends this for log rotation)
    process.on('SIGHUP', () => {
      log('Daemon: SIGHUP received, rotating logs');
      rotateLog(dispatchLogPath, logMaxSizeBytes, logMaxFiles);
      rotateLog(daemonLogPath, logMaxSizeBytes, logMaxFiles);
    });

    log(`Daemon: dispatch log at ${dispatchLogPath}`);
    log(`Daemon: log rotation: max ${logMaxSizeBytes / 1024 / 1024}MB, keep ${logMaxFiles} files`);
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
