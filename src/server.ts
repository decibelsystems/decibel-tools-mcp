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
//   node dist/server.js setup        → multi-client install wizard
// ============================================================================

// ---------------------------------------------------------------------------
// Static imports are deliberately confined to modules that pull in nothing
// heavy: node builtins, argv parsing, config files, daemon lifecycle.
//
// Everything that reaches the tool graph — the kernel, the HTTP server, the
// Supabase clients, the transports that embed them — is imported dynamically
// inside the branch that needs it. This is not stylistic. An ESM static import
// is evaluated at module load, before main() picks a mode, so a plain
// `import { createKernel } from './kernel.js'` loaded all 220 tool modules for
// every client including the ones that only proxy. Skipping the createKernel()
// CALL freed the registry and nothing else; the memory was in the import graph,
// which is why --thin measured WORSE than full stdio (113 MB vs 97 MB) when it
// first landed. Adding a static import of any tool-reaching module here
// silently undoes that. See scripts/measure-memory.mjs.
// ---------------------------------------------------------------------------
import fs from 'fs';
import path from 'path';
import { getConfig, log } from './config.js';
import type { DispatchEvent } from './kernel.js';
import type { TransportAdapter, TransportConfig } from './transports/types.js';
import { parseHttpArgs } from './httpArgs.js';
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
  AgentRegistry,
} from './daemon.js';
import { loadConfig } from './daemonConfig.js';

const config = getConfig();

log(`Starting Decibel MCP Server`);
log(`Environment: ${config.env}`);
log(`Organization: ${config.org}`);
log(`Root Directory: ${config.rootDir}`);
if (process.env.DECIBEL_PRO === '1') log('Pro features: ENABLED');
// Apps tier is no longer an env flag — private facades come from the extension
// allowlist in ~/.decibel/config.yaml and the kernel logs what it loaded and
// what it refused. See runtime/extensions.ts.

async function main() {
  const args = process.argv;

  // Setup wizard — must run before any transport starts (EPIC-0035 Phase 1)
  if (args[2] === 'setup') {
    const { runSetup } = await import('./setup.js');
    process.exit(await runSetup(args.slice(3)));
  }

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

  // Create agent registry for daemon or HTTP mode (multi-agent endpoints need it)
  const agentRegistry = (daemonMode || httpMode) ? new AgentRegistry() : undefined;

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
    agentRegistry,
    daemonConfig,
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
      const { getLicenseValidator } = await import('./license.js');
      getLicenseValidator().prevalidate(daemonConfig.license.key);
    }
  }

  // THIN MODE: this process owns no runtime and proxies to the shared daemon.
  //
  // The kernel must not be built here. `--bridge` already proxies tool CALLS,
  // but building the kernel first means a bridge client still loads all 195
  // tool modules, its own registry and its own caches — the memory is spent
  // before the transport choice is made. Six clients at ~110 MB each, five of
  // them paying for a runtime they immediately forward past. That single
  // unconditional line is the whole of the 663 MB measured on 2026-08-30.
  const thinMode = args.includes('--thin');

  // Dynamic on purpose — see the import-block note above. The `await import`
  // is what keeps kernel.js and its 220 tool modules out of a thin client's
  // heap, not the null assignment.
  const kernel = thinMode ? null : await (await import('./kernel.js')).createKernel();
  const adapters: TransportAdapter[] = [];

  // In daemon mode, log all dispatches to dispatch.jsonl (async buffered writes + rotation)
  if (daemonMode) {
    // Structural, not defensive: --thin and --daemon are contradictory. The
    // daemon IS the runtime everything else proxies to.
    if (!kernel) throw new Error('Daemon mode requires a local kernel — --thin and --daemon cannot be combined');
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

  // Schedule GC interval for daemon mode (coordinator cleanup + stale agent sweep)
  let gcInterval: ReturnType<typeof setInterval> | null = null;
  if (daemonMode && agentRegistry) {
    const gcIntervalSecs = daemonConfig.daemon.gc_interval_secs || 300;
    gcInterval = setInterval(async () => {
      try {
        // Sweep stale agents from registry
        agentRegistry.sweepStale();

        // GC coordinator state across all registered projects
        const { listProjects } = await import('./projectRegistry.js');
        const { coordGarbageCollect } = await import('./tools/coordinator/index.js');
        const projects = listProjects();
        if (projects.length > 0) {
          const projectIds = projects.map(p => p.id);
          await coordGarbageCollect(projectIds);
        }
      } catch (err) {
        log(`Daemon: GC error: ${err}`);
      }
    }, gcIntervalSecs * 1000);
    log(`Daemon: GC interval set to ${gcIntervalSecs}s`);
  }

  // Agent-presence writer: heartbeats live claude-peers sessions to hq.agent_sessions
  // (Plan D agent-presence domain). No-ops if SUPABASE_URL/SERVICE_KEY unset.
  let stopPresence: () => void = () => {};
  let stopCommands: () => void = () => {};
  if (daemonMode) {
    const { startPresenceWriter } = await import('./agentPresence.js');
    const { startCommandDispatcher } = await import('./agentCommands.js');
    stopPresence = startPresenceWriter();
    stopCommands = startCommandDispatcher();
  }

  // Start transport(s)
  if (daemonMode) {
    // Daemon always starts HTTP
    const { HttpAdapter } = await import('./transports/http.js');
    const http = new HttpAdapter();
    await http.start(kernel, transportConfig);
    adapters.push(http);

    // Optionally also start stdio (for dual-mode)
    if (args.includes('--stdio')) {
      const { StdioAdapter } = await import('./transports/stdio.js');
      const stdio = new StdioAdapter();
      await stdio.start(kernel, transportConfig);
      adapters.push(stdio);
    }

    // Install graceful shutdown handlers
    installShutdownHandlers(async () => {
      log('Daemon: stopping all transports...');
      if (gcInterval) clearInterval(gcInterval);
      stopPresence();
      stopCommands();
      await Promise.all(adapters.map(a => a.stop()));
    });
  } else if (httpMode) {
    const { HttpAdapter } = await import('./transports/http.js');
    const http = new HttpAdapter();
    await http.start(kernel, transportConfig);
    adapters.push(http);
  } else if (thinMode) {
    // A thin client never executes a tool locally, so a missing runtime is a
    // startup failure rather than something to paper over. ensureRuntime will
    // start one if none is serving; if it cannot, the error says why and what
    // to run.
    const thinIdx = args.indexOf('--thin');
    const nextThinArg = args[thinIdx + 1];
    const explicitUrl = nextThinArg && nextThinArg.startsWith('http') ? nextThinArg : undefined;

    const { ThinStdioAdapter } = await import('./transports/thinStdio.js');
    const thin = new ThinStdioAdapter(explicitUrl);
    await thin.start(null, transportConfig);
    adapters.push(thin);
  } else if (args.includes('--bridge')) {
    // Bridge mode: stdio with daemon proxy
    const bridgeIdx = args.indexOf('--bridge');
    const nextArg = args[bridgeIdx + 1];
    // If next arg looks like a URL, use it; otherwise auto-detect
    const explicitUrl = nextArg && nextArg.startsWith('http') ? nextArg : null;
    const daemonUrl = explicitUrl || `http://127.0.0.1:${transportConfig.port || 4888}`;

    const { BridgeAdapter } = await import('./transports/bridge.js');
    const bridge = new BridgeAdapter(daemonUrl);
    await bridge.start(kernel, transportConfig);
    adapters.push(bridge);
  } else {
    const { StdioAdapter } = await import('./transports/stdio.js');
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
