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
const LAUNCHD_LABEL = 'com.decibel.daemon';
const PLIST_NAME = `${LAUNCHD_LABEL}.plist`;
const LAUNCH_AGENTS_DIR = join(homedir(), 'Library', 'LaunchAgents');
const PLIST_DEST = join(LAUNCH_AGENTS_DIR, PLIST_NAME);
const SYSTEM_LAUNCH_AGENTS_DIR = '/Library/LaunchAgents';
const ENV_FILE_PATH = join(DECIBEL_HOME, 'env');

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
  port?: number;
  pid?: number;
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
 * Record the bound port and pid in daemon.meta so clients (HQ, CLI, scripts)
 * can discover the daemon without hardcoding 8787. Called after the HTTP
 * server has actually bound the port.
 */
export function setDaemonPort(port: number): void {
  const existing = readMeta();
  writeMeta({
    started_at: existing?.started_at ?? new Date().toISOString(),
    crash_count: existing?.crash_count ?? 0,
    port,
    pid: process.pid,
  });
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

/** The launchd domain for the current user, e.g. `gui/501`. */
function launchdDomain(): string {
  return `gui/${process.getuid?.() ?? 0}`;
}

/**
 * True when `path` lives on the boot volume.
 *
 * launchd refuses to bootstrap user agents from any other volume — it fails
 * with `5: Input/output error`. Used only to explain a failure, never to
 * decide whether the install succeeded (that comes from `isLaunchdLoaded`).
 */
function isOnBootVolume(path: string): boolean {
  // Walk up to the nearest component that exists — the leaf may not be written yet.
  let probe = path;
  while (!existsSync(probe)) {
    const parent = dirname(probe);
    if (parent === probe) return false;
    probe = parent;
  }
  try {
    const dev = statSync(probe).dev;
    // On APFS volume groups `/` and the Data volume report the same st_dev,
    // but check both so this holds on older layouts too.
    for (const root of ['/', '/System/Volumes/Data']) {
      try {
        if (statSync(root).dev === dev) return true;
      } catch {
        // Root probe missing — try the next one.
      }
    }
  } catch {
    // Unstattable: treat as off-volume so we surface the hint rather than hide it.
  }
  return false;
}

/**
 * Ask launchd whether the agent is actually loaded.
 *
 * This is the only trustworthy signal. `launchctl load` exits 0 even when it
 * fails, which is what let install report success for months (ISS-0127).
 */
export function isLaunchdLoaded(): boolean {
  try {
    execSync(`launchctl print ${launchdDomain()}/${LAUNCHD_LABEL}`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Remedies for the case where $HOME is not on the boot volume, so launchd will
 * never load the plist we just wrote. Returns [] when that is not the problem.
 */
function offBootVolumeAdvice(nodePath: string, serverPath: string, port: number): string[] {
  if (isOnBootVolume(LAUNCH_AGENTS_DIR)) return [];
  const systemPlist = join(SYSTEM_LAUNCH_AGENTS_DIR, PLIST_NAME);
  return [
    '',
    `  Cause: your home directory (${homedir()}) is not on the boot volume, and`,
    '  launchd will not load user agents from another volume.',
    '',
    '  Remedy A — install to the boot volume (needs sudo, survives reboot):',
    `    sudo cp ${PLIST_DEST} ${systemPlist}`,
    `    sudo chown root:wheel ${systemPlist}`,
    `    launchctl bootstrap ${launchdDomain()} ${systemPlist}`,
    '',
    '  Remedy B — cron, no sudo required:',
    `    (crontab -l 2>/dev/null; echo "@reboot ${nodePath} ${serverPath} --daemon --port ${port}") | crontab -`,
  ];
}

function getTemplateDir(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  return join(__dirname, '..', 'templates');
}

/**
 * Fill in the launchd plist template. Split out from `installLaunchd` so the
 * substitution can be tested without touching launchctl or ~/Library.
 */
export function renderPlist(options?: { port?: number }): { plist: string; serverPath: string; port: number } {
  const templatePath = join(getTemplateDir(), PLIST_NAME);
  let plist = readFileSync(templatePath, 'utf-8');
  const serverPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'server.js');
  const port = options?.port || 4888;

  // Carry the installing shell's tier opt-in into the agent. Deliberately not
  // hardcoded in the template: a plist in /Library/LaunchAgents is world-readable,
  // and guardian flags DECIBEL_PRO=1 in production as an over-grant.
  //
  // DECIBEL_APPS is gone (EPIC-0038 Phase 7). Private facades come from the
  // allowlist in ~/.decibel/config.yaml, which is the owner's file at mode 600
  // rather than a world-readable plist that has to be regenerated correctly.
  // Losing that flag on a regenerate is exactly how four facades disappeared
  // with no error on 2026-09-01.
  const tierEnv = (['DECIBEL_PRO'] as const)
    .filter(k => process.env[k] === '1')
    .map(k => `        <key>${k}</key>\n        <string>1</string>\n`)
    .join('');

  const substitutions: Record<string, string> = {
    '{{NODE_PATH}}': process.execPath,
    '{{SERVER_PATH}}': serverPath,
    '{{PORT}}': String(port),
    '{{LOG_PATH}}': LOG_PATH,
    '{{ERROR_LOG_PATH}}': join(LOG_DIR, 'daemon-error.log'),
    '{{ENV_FILE}}': ENV_FILE_PATH,
    '{{HOME}}': homedir(),
    '{{TIER_ENV}}': tierEnv,
  };
  for (const [token, value] of Object.entries(substitutions)) {
    plist = plist.split(token).join(value);
  }

  return { plist, serverPath, port };
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

  const { plist, serverPath, port } = renderPlist(options);

  // Write to LaunchAgents
  ensureDir(LAUNCH_AGENTS_DIR);
  writeFileSync(PLIST_DEST, plist, 'utf-8');

  // Reload rather than load: bootstrap refuses a label that is already present,
  // and a reinstall must pick up the plist we just wrote.
  const domain = launchdDomain();
  try {
    execSync(`launchctl bootout ${domain}/${LAUNCHD_LABEL}`, { stdio: 'pipe' });
  } catch {
    // Not loaded — nothing to boot out.
  }

  let bootstrapError = '';
  try {
    execSync(`launchctl bootstrap ${domain} ${PLIST_DEST}`, { stdio: 'pipe' });
  } catch (e) {
    const err = e as { stderr?: Buffer; message?: string };
    bootstrapError = String(err.stderr?.toString() || err.message || e).trim();
  }

  // Never trust the exit code alone — ask launchd what it actually holds.
  if (isLaunchdLoaded()) {
    return {
      installed: true,
      path: PLIST_DEST,
      message: `Installed and loaded. Daemon will auto-start on login (port ${port}).`,
    };
  }

  const lines = [
    `Plist written to ${PLIST_DEST}, but launchd did not load it —`,
    'the daemon will NOT auto-start.',
  ];
  if (bootstrapError) lines.push(`  launchctl: ${bootstrapError}`);
  lines.push(...offBootVolumeAdvice(process.execPath, serverPath, port));

  return { installed: false, path: PLIST_DEST, message: lines.join('\n') };
}

/**
 * Uninstall the launchd plist and stop the daemon.
 */
export function uninstallLaunchd(): { uninstalled: boolean; message: string } {
  const domain = launchdDomain();
  const wasLoaded = isLaunchdLoaded();

  if (wasLoaded) {
    try {
      execSync(`launchctl bootout ${domain}/${LAUNCHD_LABEL}`, { stdio: 'pipe' });
    } catch {
      // Verified below rather than trusted here.
    }
  }

  if (isLaunchdLoaded()) {
    return {
      uninstalled: false,
      message:
        `Failed to unload ${LAUNCHD_LABEL}. If it was bootstrapped from ` +
        `${SYSTEM_LAUNCH_AGENTS_DIR}, remove it with:\n` +
        `  sudo launchctl bootout ${domain}/${LAUNCHD_LABEL}\n` +
        `  sudo rm ${join(SYSTEM_LAUNCH_AGENTS_DIR, PLIST_NAME)}`,
    };
  }

  if (!existsSync(PLIST_DEST)) {
    return {
      uninstalled: wasLoaded,
      message: wasLoaded
        ? `Unloaded ${LAUNCHD_LABEL}. No plist at ${PLIST_DEST} to remove — it was loaded from elsewhere.`
        : 'Plist not found — daemon not installed.',
    };
  }

  try {
    unlinkSync(PLIST_DEST);
  } catch {
    return { uninstalled: false, message: `Unloaded, but failed to remove ${PLIST_DEST}.` };
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
  launchdPlist: boolean;
  port: number | null;
} {
  const pid = checkRunning();
  return {
    running: pid !== null,
    pid,
    pidFile: PID_PATH,
    logFile: LOG_PATH,
    // Whether launchd actually holds the job — not merely whether a file exists.
    launchd: isLaunchdLoaded(),
    launchdPlist: existsSync(PLIST_DEST),
    port: null, // Would need to read from config or PID metadata
  };
}

// ============================================================================
// Agent Registry — in-memory state of connected daemon agents
// ============================================================================

export interface DaemonAgent {
  id: string;
  capabilities: string[];
  connectedAt: string;
  lastHeartbeat: string;
  status: 'active' | 'busy' | 'idle';
  currentTask?: string;
  allowedFacades?: string[];
  tier?: 'core' | 'pro' | 'apps';
}

const DEFAULT_STALE_MS = 5 * 60 * 1000; // 5 minutes

export class AgentRegistry {
  private agents = new Map<string, DaemonAgent>();

  register(init: {
    id: string;
    capabilities?: string[];
    allowedFacades?: string[];
    tier?: 'core' | 'pro' | 'apps';
  }): DaemonAgent {
    const now = new Date().toISOString();
    const existing = this.agents.get(init.id);
    const agent: DaemonAgent = {
      id: init.id,
      capabilities: init.capabilities || existing?.capabilities || [],
      connectedAt: existing?.connectedAt || now,
      lastHeartbeat: now,
      status: 'active',
      allowedFacades: init.allowedFacades || existing?.allowedFacades,
      tier: init.tier || existing?.tier,
    };
    this.agents.set(init.id, agent);
    log(`AgentRegistry: registered ${init.id} (${this.agents.size} total)`);
    return agent;
  }

  heartbeat(agentId: string, update?: {
    status?: 'active' | 'busy' | 'idle';
    currentTask?: string;
  }): DaemonAgent | null {
    const agent = this.agents.get(agentId);
    if (!agent) return null;
    agent.lastHeartbeat = new Date().toISOString();
    if (update?.status) agent.status = update.status;
    if (update?.currentTask !== undefined) agent.currentTask = update.currentTask;
    return agent;
  }

  disconnect(agentId: string): boolean {
    const had = this.agents.has(agentId);
    this.agents.delete(agentId);
    if (had) log(`AgentRegistry: disconnected ${agentId} (${this.agents.size} remaining)`);
    return had;
  }

  get(agentId: string): DaemonAgent | undefined {
    return this.agents.get(agentId);
  }

  list(): DaemonAgent[] {
    return [...this.agents.values()];
  }

  sweepStale(staleMs: number = DEFAULT_STALE_MS): string[] {
    const cutoff = Date.now() - staleMs;
    const swept: string[] = [];
    for (const [id, agent] of this.agents) {
      if (new Date(agent.lastHeartbeat).getTime() < cutoff) {
        this.agents.delete(id);
        swept.push(id);
      }
    }
    if (swept.length > 0) {
      log(`AgentRegistry: swept ${swept.length} stale agent(s): ${swept.join(', ')}`);
    }
    return swept;
  }

  get count(): number {
    return this.agents.size;
  }

  toJSON(): object[] {
    return this.list().map(a => ({ ...a }));
  }
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
      const launchdState = status.launchd
        ? 'loaded (auto-starts on login)'
        : status.launchdPlist
          ? 'plist present but NOT loaded — will not auto-start'
          : 'not installed';
      console.log(`  launchd:   ${launchdState}`);
      process.exit(0);
      return true;
    }
  }
  return false;
}
