// ============================================================================
// Daemon Lifecycle Manager
// ============================================================================
// Handles PID files, process locking, log rotation, and macOS launchd
// integration for long-running daemon mode.
// ============================================================================

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, copyFileSync, statSync, renameSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { log } from './config.js';

// ============================================================================
// Paths
// ============================================================================

const DECIBEL_HOME = join(homedir(), '.decibel');
const PID_PATH = join(DECIBEL_HOME, 'daemon.pid');
const LOG_DIR = join(DECIBEL_HOME, 'logs');
const LOG_PATH = join(LOG_DIR, 'daemon.log');
const PLIST_NAME = 'com.decibel.daemon.plist';
const LAUNCH_AGENTS_DIR = join(homedir(), 'Library', 'LaunchAgents');
const PLIST_DEST = join(LAUNCH_AGENTS_DIR, PLIST_NAME);

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// ============================================================================
// PID Management
// ============================================================================

/**
 * Check if a process with the given PID is alive.
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // Signal 0 = check existence, don't kill
    return true;
  } catch {
    return false;
  }
}

/**
 * Read PID from file. Returns null if file doesn't exist or is invalid.
 */
export function readPid(): number | null {
  try {
    const content = readFileSync(PID_PATH, 'utf-8').trim();
    const pid = parseInt(content, 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

/**
 * Write current process PID to file.
 */
export function writePid(): void {
  ensureDir(DECIBEL_HOME);
  writeFileSync(PID_PATH, String(process.pid), 'utf-8');
  log(`Daemon: PID ${process.pid} written to ${PID_PATH}`);
}

/**
 * Remove PID file.
 */
export function removePid(): void {
  try {
    unlinkSync(PID_PATH);
    log(`Daemon: PID file removed`);
  } catch {
    // File may not exist — that's fine
  }
}

/**
 * Check if another daemon is already running.
 * Returns the PID if running, null if not.
 */
export function checkRunning(): number | null {
  const pid = readPid();
  if (pid === null) return null;
  if (isProcessAlive(pid)) return pid;
  // Stale PID file — clean it up
  log(`Daemon: Stale PID file (process ${pid} not running), cleaning up`);
  removePid();
  return null;
}

// ============================================================================
// Logging
// ============================================================================

export function getLogPath(): string {
  ensureDir(LOG_DIR);
  return LOG_PATH;
}

// ============================================================================
// Log Rotation
// ============================================================================

const DEFAULT_MAX_LOG_BYTES = 10 * 1024 * 1024; // 10MB
const DEFAULT_MAX_LOG_FILES = 3;

/**
 * Rotate a log file if it exceeds maxSizeBytes.
 * Rotation: file → file.1 → file.2 → ... → file.{maxFiles} (deleted)
 * Returns true if rotation occurred.
 */
export function rotateLog(
  filePath: string,
  maxSizeBytes: number = DEFAULT_MAX_LOG_BYTES,
  maxFiles: number = DEFAULT_MAX_LOG_FILES,
): boolean {
  try {
    if (!existsSync(filePath)) return false;
    const stat = statSync(filePath);
    if (stat.size < maxSizeBytes) return false;

    // Shift existing rotated files: .3 → delete, .2 → .3, .1 → .2
    for (let i = maxFiles; i >= 1; i--) {
      const src = i === 1 ? filePath : `${filePath}.${i - 1}`;
      const dst = `${filePath}.${i}`;
      if (i === maxFiles && existsSync(dst)) {
        unlinkSync(dst);
      }
      if (existsSync(src)) {
        renameSync(src, dst);
      }
    }

    // Create empty file in place of the original (which was renamed to .1)
    writeFileSync(filePath, '', 'utf-8');
    log(`Daemon: Rotated log ${filePath} (was ${(stat.size / 1024 / 1024).toFixed(1)}MB)`);
    return true;
  } catch (err) {
    log(`Daemon: Log rotation failed for ${filePath}: ${err}`);
    return false;
  }
}

// ============================================================================
// Crash Loop Protection
// ============================================================================

const META_PATH = join(DECIBEL_HOME, 'daemon.meta');
const MAX_CRASH_COUNT = 5;
const CRASH_WINDOW_MS = 60_000; // 60 seconds
const HEALTH_RESET_MS = 5 * 60_000; // 5 minutes

interface DaemonMeta {
  started_at: string;
  crash_count: number;
}

function readMeta(): DaemonMeta | null {
  try {
    return JSON.parse(readFileSync(META_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

function writeMeta(meta: DaemonMeta): void {
  ensureDir(DECIBEL_HOME);
  writeFileSync(META_PATH, JSON.stringify(meta), 'utf-8');
}

/**
 * Check for crash loop. Returns true if safe to start, false if should exit.
 * Exits process with code 0 if crash loop detected (tells launchd to stop).
 */
export function checkCrashLoop(): boolean {
  const now = Date.now();
  const meta = readMeta();

  let crashCount = 0;
  if (meta) {
    const lastStart = new Date(meta.started_at).getTime();
    if (now - lastStart < CRASH_WINDOW_MS) {
      crashCount = meta.crash_count + 1;
    }
    // else: enough time has passed, reset
  }

  if (crashCount >= MAX_CRASH_COUNT) {
    console.error(`Daemon: Crash loop detected (${crashCount} crashes in <60s). Exiting.`);
    console.error('Daemon: Run with --reset-crashes to clear the counter.');
    writeMeta({ started_at: new Date().toISOString(), crash_count: crashCount });
    return false;
  }

  writeMeta({ started_at: new Date().toISOString(), crash_count: crashCount });
  if (crashCount > 0) {
    log(`Daemon: Crash count: ${crashCount}/${MAX_CRASH_COUNT}`);
  }
  return true;
}

/**
 * Reset crash count after healthy running period.
 * Call once after successful startup.
 */
export function scheduleHealthReset(): void {
  setTimeout(() => {
    const meta = readMeta();
    if (meta && meta.crash_count > 0) {
      writeMeta({ started_at: meta.started_at, crash_count: 0 });
      log('Daemon: Crash counter reset after healthy running');
    }
  }, HEALTH_RESET_MS);
}

/**
 * Clear crash counter (for --reset-crashes CLI flag).
 */
export function resetCrashes(): void {
  writeMeta({ started_at: new Date().toISOString(), crash_count: 0 });
  console.log('Daemon: Crash counter reset.');
}

// ============================================================================
// Graceful Shutdown
// ============================================================================

const DRAIN_TIMEOUT_MS = 30_000;

/**
 * Install signal handlers for graceful shutdown.
 * Returns a promise that resolves when shutdown is requested.
 */
export function installShutdownHandlers(
  cleanup: () => Promise<void>
): void {
  let shuttingDown = false;

  async function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;

    log(`Daemon: ${signal} received, shutting down gracefully...`);

    // Race: cleanup vs timeout
    const timer = setTimeout(() => {
      log(`Daemon: Drain timeout (${DRAIN_TIMEOUT_MS}ms) exceeded, forcing exit`);
      removePid();
      process.exit(1);
    }, DRAIN_TIMEOUT_MS);

    try {
      await cleanup();
      log('Daemon: Clean shutdown complete');
    } catch (err) {
      log(`Daemon: Error during shutdown: ${err}`);
    } finally {
      clearTimeout(timer);
      removePid();
      process.exit(0);
    }
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// ============================================================================
// launchd Integration (macOS)
// ============================================================================

function getTemplateDir(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  return join(__dirname, '..', 'templates');
}

/**
 * Install the launchd plist so the daemon auto-starts on login.
 */
export function installLaunchd(options?: { port?: number }): { installed: boolean; path: string; message: string } {
  const templatePath = join(getTemplateDir(), PLIST_NAME);

  if (!existsSync(templatePath)) {
    return {
      installed: false,
      path: PLIST_DEST,
      message: `Template not found: ${templatePath}`,
    };
  }

  // Read template and substitute variables
  let plist = readFileSync(templatePath, 'utf-8');
  const serverPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'server.js');
  const port = options?.port || 4888;

  plist = plist.replace('{{NODE_PATH}}', process.execPath);
  plist = plist.replace('{{SERVER_PATH}}', serverPath);
  plist = plist.replace('{{PORT}}', String(port));
  plist = plist.replace('{{LOG_PATH}}', LOG_PATH);
  plist = plist.replace('{{ERROR_LOG_PATH}}', join(LOG_DIR, 'daemon-error.log'));

  // Write to LaunchAgents
  ensureDir(LAUNCH_AGENTS_DIR);
  writeFileSync(PLIST_DEST, plist, 'utf-8');

  // Load the agent
  try {
    execSync(`launchctl load ${PLIST_DEST}`, { stdio: 'pipe' });
  } catch {
    // May already be loaded — try unload then load
    try {
      execSync(`launchctl unload ${PLIST_DEST}`, { stdio: 'pipe' });
      execSync(`launchctl load ${PLIST_DEST}`, { stdio: 'pipe' });
    } catch (e) {
      return {
        installed: true,
        path: PLIST_DEST,
        message: `Plist written but launchctl load failed: ${e}`,
      };
    }
  }

  return {
    installed: true,
    path: PLIST_DEST,
    message: `Installed and loaded. Daemon will auto-start on login (port ${port}).`,
  };
}

/**
 * Uninstall the launchd plist and stop the daemon.
 */
export function uninstallLaunchd(): { uninstalled: boolean; message: string } {
  if (!existsSync(PLIST_DEST)) {
    return { uninstalled: false, message: 'Plist not found — daemon not installed.' };
  }

  try {
    execSync(`launchctl unload ${PLIST_DEST}`, { stdio: 'pipe' });
  } catch {
    // May not be loaded
  }

  try {
    unlinkSync(PLIST_DEST);
  } catch {
    return { uninstalled: false, message: 'Failed to remove plist file.' };
  }

  return { uninstalled: true, message: 'Daemon uninstalled. Will no longer auto-start.' };
}

/**
 * Get daemon status.
 */
export function daemonStatus(): {
  running: boolean;
  pid: number | null;
  pidFile: string;
  logFile: string;
  launchd: boolean;
  port: number | null;
} {
  const pid = checkRunning();
  return {
    running: pid !== null,
    pid,
    pidFile: PID_PATH,
    logFile: LOG_PATH,
    launchd: existsSync(PLIST_DEST),
    port: null, // Would need to read from config or PID metadata
  };
}

// ============================================================================
// CLI Subcommands (called from server.ts)
// ============================================================================

/**
 * Handle daemon subcommands: install, uninstall, status.
 * Returns true if a subcommand was handled (and process should exit).
 */
export function handleDaemonSubcommand(args: string[]): boolean {
  const subcommand = args.find(a => ['install', 'uninstall', 'status'].includes(a));
  if (!subcommand) return false;

  switch (subcommand) {
    case 'install': {
      const portIdx = args.indexOf('--port');
      const port = portIdx !== -1 ? parseInt(args[portIdx + 1], 10) : undefined;
      const result = installLaunchd({ port });
      console.log(result.message);
      console.log(`  Plist: ${result.path}`);
      process.exit(result.installed ? 0 : 1);
      return true;
    }
    case 'uninstall': {
      const result = uninstallLaunchd();
      console.log(result.message);
      process.exit(result.uninstalled ? 0 : 1);
      return true;
    }
    case 'status': {
      const status = daemonStatus();
      if (status.running) {
        console.log(`Daemon is running (PID ${status.pid})`);
      } else {
        console.log('Daemon is not running');
      }
      console.log(`  PID file:  ${status.pidFile}`);
      console.log(`  Log file:  ${status.logFile}`);
      console.log(`  launchd:   ${status.launchd ? 'installed' : 'not installed'}`);
      process.exit(0);
      return true;
    }
  }
  return false;
}
