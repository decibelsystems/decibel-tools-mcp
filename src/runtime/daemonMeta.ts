// ============================================================================
// daemon.meta — machine-global daemon discovery
// ============================================================================
//
// ~/.decibel/daemon.meta is how every client on the machine finds the daemon:
// the session-init hook, the issue-close hook, the HQ client, ensureRuntime,
// the CLI. One small JSON file that three modules used to parse for themselves.
//
// ISS-0179. Two defects, and the second is the worse one:
//
//   1. ANY `--http` run advertised itself here, not just `--daemon`. Starting a
//      throwaway server on another port — a test, a second checkout, a port
//      conflict, a demo — silently redirected every hook on the machine to it.
//
//   2. Nothing removed a stale entry and no reader checked one. When that
//      throwaway process died, the entry stayed, and every hook kept dialling a
//      port with nothing behind it. The failure was silent at every layer: curl
//      got connection-refused, the hook read empty output as "nothing to do",
//      and the user saw a successful commit.
//
// The entry records the pid that wrote it, which is enough to tell a live
// advertisement from a dead one. That check lives here, once, because the
// reason it was missing is that it would have had to be written three times.
// ============================================================================

import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Resolved per call rather than captured at import, the way daemonConfig does:
 * os.homedir() tracks $HOME, and a module-level constant freezes whatever it
 * was when the file was first loaded — which makes this unverifiable in a test
 * and wrong in any process that changes HOME.
 */
export function decibelHome(): string {
  return path.join(os.homedir(), '.decibel');
}

export function metaPath(): string {
  return path.join(decibelHome(), 'daemon.meta');
}

/** The port the daemon binds when nothing says otherwise. */
export const DEFAULT_DAEMON_PORT = 4888;

export interface DaemonMeta {
  started_at: string;
  crash_count: number;
  port?: number;
  pid?: number;
}

/**
 * Is this pid a process that currently exists?
 *
 * Signal 0 performs the permission and existence checks without delivering
 * anything. EPERM means the process is there and owned by someone else, which
 * is still alive — only ESRCH means gone.
 */
export function isPidAlive(pid: number | undefined): boolean {
  if (!Number.isInteger(pid) || (pid as number) <= 0) return false;
  try {
    process.kill(pid as number, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function readDaemonMeta(): DaemonMeta | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(metaPath(), 'utf-8'));
    return parsed && typeof parsed === 'object' ? (parsed as DaemonMeta) : null;
  } catch {
    return null;
  }
}

/**
 * The advertised port, or undefined when there is no usable advertisement.
 *
 * An entry whose pid is dead is treated as absent rather than followed. That is
 * the whole point: a stale port is worse than no port, because callers fall
 * back to the default when there is nothing to read and dial a corpse when
 * there is.
 */
export function advertisedPort(): number | undefined {
  const meta = readDaemonMeta();
  if (!meta || !Number.isInteger(meta.port)) return undefined;
  if (meta.pid !== undefined && !isPidAlive(meta.pid)) return undefined;
  return meta.port;
}

/** Discovery order shared by every client: explicit > env > meta > default. */
export function resolveDaemonPort(explicit?: number): number {
  if (Number.isInteger(explicit) && (explicit as number) > 0 && (explicit as number) < 65536) {
    return explicit as number;
  }
  const fromEnv = Number(process.env.DECIBEL_DAEMON_PORT);
  if (Number.isInteger(fromEnv) && fromEnv > 0 && fromEnv < 65536) return fromEnv;
  return advertisedPort() ?? DEFAULT_DAEMON_PORT;
}

/**
 * True when someone else is currently advertising — a live pid that is not us.
 * Taking discovery from a running daemon is how a second instance silently
 * breaks the first one's clients, so callers refuse rather than overwrite.
 */
export function heldByAnotherProcess(): DaemonMeta | null {
  const meta = readDaemonMeta();
  if (!meta || meta.pid === undefined || meta.pid === process.pid) return null;
  return isPidAlive(meta.pid) ? meta : null;
}
