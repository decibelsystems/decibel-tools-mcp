/**
 * Cross-process advisory file lock.
 *
 * Decibel's stores are plain files in `.decibel/`, written concurrently by
 * every MCP client, CLI invocation, hook, and migration script on the machine.
 * An in-process mutex is useless here — the contending writers are separate
 * processes, often separate installs.
 *
 * Acquisition is `open(path, 'wx')`: O_EXCL, which either creates the file
 * atomically or fails with EEXIST. There is no read-then-write window for a
 * second caller to slip through, which is the property that makes this safe
 * where a "does a lock exist?" check would not be.
 *
 * The lock is advisory: it only protects callers that take it. That is why the
 * operations it guards should *also* be individually safe (e.g. creating a file
 * with O_EXCL so a colliding write fails loudly). Old clients, one-off scripts,
 * and migrations are part of the threat model and will not take the lock.
 */

import { openSync, closeSync, writeSync, unlinkSync, statSync, mkdirSync } from 'fs';
import { dirname } from 'path';

export interface FileLockOptions {
  /** Give up acquiring after this long. */
  timeoutMs?: number;
  /** A lock older than this is presumed abandoned by a crashed holder. */
  staleMs?: number;
  /** Delay between acquisition attempts. */
  retryIntervalMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_STALE_MS = 30_000;
const DEFAULT_RETRY_INTERVAL_MS = 25;

/** Thrown when the lock could not be acquired before the timeout. */
export class FileLockTimeoutError extends Error {
  constructor(lockPath: string, timeoutMs: number, holder?: string) {
    super(
      `Timed out after ${timeoutMs}ms acquiring lock ${lockPath}` +
        (holder ? ` (held by ${holder})` : '') +
        `. If no Decibel process is running, remove the lock file and retry.`
    );
    this.name = 'FileLockTimeoutError';
  }
}

function readHolder(lockPath: string): string | undefined {
  try {
    const raw = statSync(lockPath);
    return `pid unknown, age ${Math.round((Date.now() - raw.mtimeMs) / 1000)}s`;
  } catch {
    return undefined;
  }
}

/** One acquisition attempt. Returns true on success. */
function tryAcquire(lockPath: string, staleMs: number): boolean {
  mkdirSync(dirname(lockPath), { recursive: true });

  try {
    const fd = openSync(lockPath, 'wx');
    try {
      writeSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
    } finally {
      closeSync(fd);
    }
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
  }

  // Held. Abandoned by a crashed holder?
  try {
    const age = Date.now() - statSync(lockPath).mtimeMs;
    if (age > staleMs) {
      unlinkSync(lockPath);
      // One retry. If we lose this one too, another waiter beat us to the
      // steal — fine, they hold it legitimately and we keep waiting.
      try {
        const fd = openSync(lockPath, 'wx');
        try {
          writeSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
        } finally {
          closeSync(fd);
        }
        return true;
      } catch {
        return false;
      }
    }
  } catch {
    // Lock vanished between EEXIST and stat — the holder released it. The next
    // loop iteration will acquire normally.
  }

  return false;
}

function release(lockPath: string): void {
  try {
    unlinkSync(lockPath);
  } catch {
    // Already gone (released elsewhere, or stolen as stale). Nothing to do.
  }
}

/**
 * Run `fn` while holding an exclusive cross-process lock.
 *
 * The lock is always released, including when `fn` throws — a failed write must
 * not wedge every other writer on the machine.
 */
export async function withFileLock<T>(
  lockPath: string,
  fn: () => Promise<T>,
  options: FileLockOptions = {}
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
  const retryIntervalMs = options.retryIntervalMs ?? DEFAULT_RETRY_INTERVAL_MS;

  const deadline = Date.now() + timeoutMs;
  let acquired = false;

  while (Date.now() < deadline) {
    if (tryAcquire(lockPath, staleMs)) {
      acquired = true;
      break;
    }
    await new Promise((r) => setTimeout(r, retryIntervalMs));
  }

  if (!acquired) {
    throw new FileLockTimeoutError(lockPath, timeoutMs, readHolder(lockPath));
  }

  try {
    return await fn();
  } finally {
    release(lockPath);
  }
}
