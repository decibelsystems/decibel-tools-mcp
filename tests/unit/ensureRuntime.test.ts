import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createServer, Server } from 'http';
import { existsSync, unlinkSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import {
  ensureRuntime,
  probeRuntime,
  resolveRuntimePort,
  RuntimeProtocolMismatchError,
  RuntimeUnavailableError,
  DEFAULT_RUNTIME_PORT,
} from '../../src/runtime/ensureRuntime.js';
import { RUNTIME_PROTOCOL_VERSION } from '../../src/runtime/protocol.js';

const LOCK_PATH = join(homedir(), '.decibel', 'runtime.lock');

/** Minimal stand-in for the daemon's /health endpoint. */
function startFakeRuntime(
  payload: Record<string, unknown>
): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    // Port 0 → OS assigns a free one, so tests never collide with a real daemon.
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      resolve({ server, port });
    });
  });
}

function healthPayload(overrides: Record<string, unknown> = {}) {
  return {
    status: 'ok',
    version: '2.2.0-beta.0',
    protocol_version: RUNTIME_PROTOCOL_VERSION,
    pid: 12345,
    uptime_ms: 1000,
    facade_count: 24,
    license_tier: 'core',
    ...overrides,
  };
}

/** A free port with nothing bound to it. */
async function findClosedPort(): Promise<number> {
  const { server, port } = await startFakeRuntime(healthPayload());
  await new Promise<void>((r) => server.close(() => r()));
  return port;
}

describe('resolveRuntimePort', () => {
  const originalEnv = process.env.DECIBEL_DAEMON_PORT;

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.DECIBEL_DAEMON_PORT;
    else process.env.DECIBEL_DAEMON_PORT = originalEnv;
  });

  it('prefers an explicit port over everything', () => {
    process.env.DECIBEL_DAEMON_PORT = '9999';
    expect(resolveRuntimePort(1234)).toBe(1234);
  });

  it('reads DECIBEL_DAEMON_PORT when no explicit port is given', () => {
    process.env.DECIBEL_DAEMON_PORT = '9999';
    expect(resolveRuntimePort()).toBe(9999);
  });

  it('ignores a malformed env port rather than crashing', () => {
    process.env.DECIBEL_DAEMON_PORT = 'not-a-port';
    // Falls through to daemon.meta or the default; both are valid ports.
    const port = resolveRuntimePort();
    expect(Number.isInteger(port)).toBe(true);
    expect(port).toBeGreaterThan(0);
  });
});

describe('probeRuntime', () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) await new Promise<void>((r) => server!.close(() => r()));
    server = undefined;
  });

  it('returns the health payload when a runtime is serving', async () => {
    const started = await startFakeRuntime(healthPayload());
    server = started.server;
    const health = await probeRuntime(started.port);
    expect(health?.status).toBe('ok');
    expect(health?.protocol_version).toBe(RUNTIME_PROTOCOL_VERSION);
  });

  it('returns null when nothing is listening', async () => {
    const port = await findClosedPort();
    expect(await probeRuntime(port)).toBeNull();
  });

  it('returns null for a response that is not a health payload', async () => {
    const started = await startFakeRuntime({ unexpected: true });
    server = started.server;
    expect(await probeRuntime(started.port)).toBeNull();
  });
});

describe('ensureRuntime', () => {
  let server: Server | undefined;

  beforeEach(() => {
    mkdirSync(join(homedir(), '.decibel'), { recursive: true });
    if (existsSync(LOCK_PATH)) unlinkSync(LOCK_PATH);
  });

  afterEach(async () => {
    if (server) await new Promise<void>((r) => server!.close(() => r()));
    server = undefined;
    if (existsSync(LOCK_PATH)) unlinkSync(LOCK_PATH);
  });

  it('returns a handle for an already-running compatible runtime without spawning', async () => {
    const started = await startFakeRuntime(healthPayload());
    server = started.server;

    const handle = await ensureRuntime({ port: started.port });

    expect(handle.spawned).toBe(false);
    expect(handle.pid).toBe(12345);
    expect(handle.port).toBe(started.port);
    expect(handle.url).toBe(`http://127.0.0.1:${started.port}`);
    expect(handle.protocolVersion).toBe(RUNTIME_PROTOCOL_VERSION);
    expect(handle.licenseTier).toBe('core');
  });

  it('throws on protocol mismatch instead of using the runtime anyway', async () => {
    const started = await startFakeRuntime(healthPayload({ protocol_version: '2.0' }));
    server = started.server;

    await expect(ensureRuntime({ port: started.port })).rejects.toThrow(
      RuntimeProtocolMismatchError
    );
  });

  it('throws on a runtime that predates protocol negotiation', async () => {
    const payload = healthPayload();
    delete (payload as Record<string, unknown>).protocol_version;
    const started = await startFakeRuntime(payload);
    server = started.server;

    await expect(ensureRuntime({ port: started.port })).rejects.toThrow(
      RuntimeProtocolMismatchError
    );
  });

  it('does not spawn when autoStart is false', async () => {
    const port = await findClosedPort();

    await expect(
      ensureRuntime({ port, autoStart: false })
    ).rejects.toThrow(RuntimeUnavailableError);

    // Probe-only mode must not leave a lock behind for other callers to wait on.
    expect(existsSync(LOCK_PATH)).toBe(false);
  });

  it('releases the startup lock even when startup fails', async () => {
    const port = await findClosedPort();

    await expect(
      ensureRuntime({
        port,
        timeoutMs: 400,
        // Point at a path that cannot start a runtime, so spawn fails fast.
        serverEntry: join(homedir(), '.decibel', '__nonexistent_runtime__.js'),
      })
    ).rejects.toThrow(RuntimeUnavailableError);

    expect(existsSync(LOCK_PATH)).toBe(false);
  });

  it('waits for the lock holder rather than spawning a competing runtime', async () => {
    // Simulate another client mid-spawn: lock held, nothing serving yet.
    writeFileSync(LOCK_PATH, JSON.stringify({ pid: 999999, at: new Date().toISOString() }));
    const port = await findClosedPort();

    await expect(ensureRuntime({ port, timeoutMs: 400 })).rejects.toThrow(
      /startup lock/
    );

    // The waiter must not clear a lock it does not own.
    expect(existsSync(LOCK_PATH)).toBe(true);
  });

  it('steals an abandoned lock so one crashed spawn cannot wedge every client', async () => {
    // Lock with an mtime well past LOCK_STALE_MS (30s).
    writeFileSync(LOCK_PATH, JSON.stringify({ pid: 999999, at: 'old' }));
    const stale = Date.now() - 120_000;
    const { utimesSync } = await import('fs');
    utimesSync(LOCK_PATH, stale / 1000, stale / 1000);

    const port = await findClosedPort();

    // Proves we took the spawner path: the error is the spawn timeout,
    // not the "another process holds the lock" wait.
    await expect(
      ensureRuntime({
        port,
        timeoutMs: 400,
        serverEntry: join(homedir(), '.decibel', '__nonexistent_runtime__.js'),
      })
    ).rejects.toThrow(/did not report healthy/);
  });
});
