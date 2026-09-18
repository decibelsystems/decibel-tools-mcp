/**
 * ensureRuntime — the one lifecycle primitive.
 *
 * Every surface that needs the Decibel runtime (MCP adapters, the CLI, the
 * VS Code extension, shell hooks) calls this. None of them should carry their
 * own "is the daemon up? should I start it?" logic — that duplication is how
 * five subtly different startup behaviours end up in one codebase.
 *
 * Two things this deliberately does NOT do:
 *
 *   1. It does not use the PID file as the source of truth. `~/.decibel/daemon.pid`
 *      goes stale — an unclean exit leaves a pid pointing at nothing, or worse,
 *      at a recycled pid belonging to an unrelated process. A successful
 *      `/health` response is the only proof the runtime is actually serving.
 *
 *   2. It does not check-then-spawn. When six clients start at once, six
 *      "is it running? no → start it" sequences race and you get six daemons
 *      fighting over one port. Startup is arbitrated by an atomic O_EXCL lock
 *      file: exactly one caller wins the right to spawn, and the losers wait
 *      for the winner's daemon rather than starting their own.
 */

import { spawn } from 'child_process';
import { openSync, closeSync, writeSync, readFileSync, unlinkSync, statSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { RUNTIME_PROTOCOL_VERSION, isProtocolCompatible } from './protocol.js';
import { localJson } from './localHttp.js';

const DECIBEL_HOME = join(homedir(), '.decibel');
const META_PATH = join(DECIBEL_HOME, 'daemon.meta');
const LOCK_PATH = join(DECIBEL_HOME, 'runtime.lock');

/** Default port the daemon binds. Overridden by daemon.meta or DECIBEL_DAEMON_PORT. */
export const DEFAULT_RUNTIME_PORT = 4888;

/** A lock older than this is presumed abandoned (holder crashed mid-spawn). */
const LOCK_STALE_MS = 30_000;

/** How long to wait for a runtime — ours or someone else's — to become healthy. */
const DEFAULT_STARTUP_TIMEOUT_MS = 15_000;

/** Gap between `/health` polls while waiting for startup. */
const POLL_INTERVAL_MS = 150;

/** Per-probe HTTP timeout. Short: a healthy local daemon answers in single-digit ms. */
const PROBE_TIMEOUT_MS = 1_500;

export interface RuntimeHealth {
  status: string;
  version: string;
  protocol_version?: string;
  pid: number;
  uptime_ms: number;
  facade_count: number;
  license_tier: string;
  [key: string]: unknown;
}

export interface RuntimeHandle {
  /** Base URL, e.g. `http://127.0.0.1:4888`. No trailing slash. */
  url: string;
  port: number;
  /** PID of the serving runtime — reported by /health, not read from a pid file. */
  pid: number;
  /** Package version of the running runtime. */
  version: string;
  /** Wire protocol the running runtime speaks. */
  protocolVersion: string;
  licenseTier: string;
  /** True when this call started the runtime; false when it was already up. */
  spawned: boolean;
  health: RuntimeHealth;
}

export interface EnsureRuntimeOptions {
  /** Protocol version this client requires. Defaults to the compiled-in version. */
  protocolVersion?: string;
  /** Port override. Falls back to daemon.meta, then DECIBEL_DAEMON_PORT, then 4888. */
  port?: number;
  /** Total time to wait for a runtime to become healthy. */
  timeoutMs?: number;
  /**
   * When false, never spawn — probe only, and throw if nothing is serving.
   * Used by callers that must not have side effects (status commands, health
   * checks, anything running inside a hook with a hard timeout).
   */
  autoStart?: boolean;
  /** Absolute path to the runtime entry point. Defaults to this package's dist/server.js. */
  serverEntry?: string;
}

/** Thrown when a runtime is serving but speaks an incompatible protocol. */
export class RuntimeProtocolMismatchError extends Error {
  constructor(
    readonly serverVersion: string | undefined,
    readonly clientVersion: string,
    reason: string
  ) {
    super(
      `Decibel runtime protocol mismatch: ${reason}. ` +
        `Restart the runtime so it matches this client (\`decibel-tools --daemon restart\`), ` +
        `or upgrade the client to match the running runtime.`
    );
    this.name = 'RuntimeProtocolMismatchError';
  }
}

/** Thrown when no runtime is serving and one could not be started. */
export class RuntimeUnavailableError extends Error {
  constructor(port: number, detail: string) {
    super(
      `Decibel runtime is not available on 127.0.0.1:${port}: ${detail}. ` +
        `Start it manually with \`decibel-tools --daemon\` and check ` +
        `~/.decibel/logs/daemon.log for why it did not come up.`
    );
    this.name = 'RuntimeUnavailableError';
  }
}

// ============================================================================
// Port discovery
// ============================================================================

/**
 * Resolve the port to talk to, in precedence order:
 *   explicit option → DECIBEL_DAEMON_PORT → daemon.meta → default.
 *
 * daemon.meta is a *hint*, not proof of life — it records the port the daemon
 * last bound. We still confirm with /health before trusting anything.
 */
export function resolveRuntimePort(explicit?: number): number {
  if (explicit) return explicit;

  const fromEnv = process.env.DECIBEL_DAEMON_PORT;
  if (fromEnv) {
    const parsed = Number(fromEnv);
    if (Number.isInteger(parsed) && parsed > 0 && parsed < 65536) return parsed;
  }

  try {
    const meta = JSON.parse(readFileSync(META_PATH, 'utf-8'));
    if (Number.isInteger(meta?.port)) return meta.port;
  } catch {
    // No meta file, or unreadable — fall through to the default.
  }

  return DEFAULT_RUNTIME_PORT;
}

// ============================================================================
// Health probe
// ============================================================================

/**
 * GET /health. Returns null when nothing is listening or the response is not a
 * usable health payload — callers treat null as "no runtime here", never as an
 * error worth surfacing.
 */
export async function probeRuntime(port: number): Promise<RuntimeHealth | null> {
  try {
    const res = await localJson<RuntimeHealth>(`http://127.0.0.1:${port}/health`, {
      timeoutMs: PROBE_TIMEOUT_MS,
    });
    if (!res.ok) return null;
    if (typeof res.body?.status !== 'string') return null;
    return res.body;
  } catch {
    return null;
  }
}

// ============================================================================
// Startup arbitration
// ============================================================================

/**
 * Try to become the process responsible for spawning the runtime.
 *
 * `wx` is O_EXCL: the create either succeeds atomically or fails because
 * someone else holds it. That is the whole arbitration mechanism — no
 * read-then-write window for a second caller to slip through.
 *
 * A lock whose mtime is older than LOCK_STALE_MS is presumed abandoned (its
 * holder crashed between acquiring and spawning) and is removed so startup can
 * proceed. Without that, one crashed spawn would wedge every future client.
 */
function tryAcquireStartupLock(): boolean {
  mkdirSync(DECIBEL_HOME, { recursive: true });

  try {
    const fd = openSync(LOCK_PATH, 'wx');
    writeSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
    closeSync(fd);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
  }

  // Held by someone. Abandoned?
  try {
    const age = Date.now() - statSync(LOCK_PATH).mtimeMs;
    if (age > LOCK_STALE_MS) {
      unlinkSync(LOCK_PATH);
      return tryAcquireStartupLock();
    }
  } catch {
    // Vanished between our EEXIST and the stat — the holder finished. Retry once.
    try {
      const fd = openSync(LOCK_PATH, 'wx');
      writeSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
      closeSync(fd);
      return true;
    } catch {
      return false;
    }
  }

  return false;
}

function releaseStartupLock(): void {
  try {
    unlinkSync(LOCK_PATH);
  } catch {
    // Already gone (stolen as stale, or cleaned up elsewhere). Nothing to do.
  }
}

/** Default runtime entry point: dist/server.js in this package. */
function defaultServerEntry(): string {
  // src/runtime/ensureRuntime.ts → dist/runtime/ensureRuntime.js at runtime,
  // so ../server.js resolves to dist/server.js in both layouts.
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'server.js');
}

/**
 * Spawn the daemon fully detached so it outlives this client. A runtime that
 * dies when the terminal that happened to start it closes is not a shared
 * runtime.
 */
function spawnRuntime(port: number, serverEntry: string): void {
  const child = spawn(
    process.execPath,
    [serverEntry, '--daemon', '--port', String(port)],
    {
      detached: true,
      stdio: 'ignore',
      env: process.env,
    }
  );
  child.unref();
}

/** Poll /health until it answers compatibly, or the deadline passes. */
async function waitForHealthy(
  port: number,
  clientProtocol: string,
  deadline: number
): Promise<RuntimeHealth | null> {
  while (Date.now() < deadline) {
    const health = await probeRuntime(port);
    if (health) {
      const compat = isProtocolCompatible(health.protocol_version, clientProtocol);
      if (!compat.compatible) {
        throw new RuntimeProtocolMismatchError(
          health.protocol_version,
          clientProtocol,
          compat.reason
        );
      }
      return health;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return null;
}

// ============================================================================
// Entry point
// ============================================================================

/**
 * Return a handle to a healthy, protocol-compatible runtime, starting one if
 * needed.
 *
 * Throws rather than degrading:
 *   - RuntimeProtocolMismatchError when something is serving but speaks a
 *     contract this client does not understand.
 *   - RuntimeUnavailableError when nothing is serving and none could be started.
 *
 * Callers must not silently fall back to doing the work in-process. A client
 * that quietly becomes a second writer is exactly the failure this runtime
 * exists to prevent.
 */
export async function ensureRuntime(
  options: EnsureRuntimeOptions = {}
): Promise<RuntimeHandle> {
  const clientProtocol = options.protocolVersion ?? RUNTIME_PROTOCOL_VERSION;
  const port = resolveRuntimePort(options.port);
  const autoStart = options.autoStart !== false;
  const timeoutMs = options.timeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;

  // Fast path: something is already serving.
  const existing = await probeRuntime(port);
  if (existing) {
    const compat = isProtocolCompatible(existing.protocol_version, clientProtocol);
    if (!compat.compatible) {
      throw new RuntimeProtocolMismatchError(
        existing.protocol_version,
        clientProtocol,
        compat.reason
      );
    }
    return toHandle(existing, port, false);
  }

  if (!autoStart) {
    throw new RuntimeUnavailableError(port, 'nothing is listening and autoStart is disabled');
  }

  const deadline = Date.now() + timeoutMs;

  // Arbitrate. Exactly one caller spawns; the rest wait for that one.
  const isSpawner = tryAcquireStartupLock();

  if (!isSpawner) {
    const health = await waitForHealthy(port, clientProtocol, deadline);
    if (health) return toHandle(health, port, false);
    throw new RuntimeUnavailableError(
      port,
      'another process holds the startup lock but no runtime became healthy before the timeout'
    );
  }

  try {
    // Re-probe under the lock. Between our first probe and acquiring the lock,
    // a previous holder may have finished starting one.
    const raced = await probeRuntime(port);
    if (raced) {
      const compat = isProtocolCompatible(raced.protocol_version, clientProtocol);
      if (!compat.compatible) {
        throw new RuntimeProtocolMismatchError(
          raced.protocol_version,
          clientProtocol,
          compat.reason
        );
      }
      return toHandle(raced, port, false);
    }

    spawnRuntime(port, options.serverEntry ?? defaultServerEntry());

    const health = await waitForHealthy(port, clientProtocol, deadline);
    if (health) return toHandle(health, port, true);

    throw new RuntimeUnavailableError(
      port,
      `spawned a runtime but it did not report healthy within ${timeoutMs}ms`
    );
  } finally {
    releaseStartupLock();
  }
}

function toHandle(health: RuntimeHealth, port: number, spawned: boolean): RuntimeHandle {
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    pid: health.pid,
    version: health.version,
    protocolVersion: health.protocol_version ?? 'unknown',
    licenseTier: health.license_tier,
    spawned,
    health,
  };
}
