import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  createTestContext,
  cleanupTestContext,
  TestContext,
} from '../utils/test-context.js';

// Resolve the project root from this test file's location, not from
// process.cwd(). createTestContext() chdirs into a tmp dir, so any spawn
// that depends on cwd-relative module resolution (e.g. `--import tsx`) breaks.
const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..'
);

import { buildServerEnv, STDERR_BUF_LIMIT } from '../utils/server-env.js';
export { buildServerEnv };

const REQUEST_TIMEOUT_MS = 5000;
const SPAWN_READY_TIMEOUT_MS = 30000;

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

describe('MCP Server E2E (stdio)', { timeout: 45000 }, () => {
  let ctx: TestContext;
  let serverProcess: ChildProcess | null = null;

  beforeEach(async () => {
    ctx = await createTestContext();
  });

  afterEach(async () => {
    if (serverProcess) {
      serverProcess.kill();
      serverProcess = null;
    }
    await cleanupTestContext(ctx);
  });

  function startServer(): Promise<ChildProcess> {
    return new Promise((resolve, reject) => {
      const proc = spawn('node', ['--import', 'tsx', 'src/server.ts'], {
        cwd: PROJECT_ROOT,
        env: buildServerEnv(ctx.rootDir),
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stderrBuf = '';
      let resolved = false;

      const spawnTimeout = setTimeout(() => {
        proc.kill();
        reject(
          new Error(
            `Server failed to emit ready signal within ${SPAWN_READY_TIMEOUT_MS}ms. stderr so far: ${stderrBuf}`
          )
        );
      }, SPAWN_READY_TIMEOUT_MS);

      proc.on('error', (err) => {
        clearTimeout(spawnTimeout);
        reject(err);
      });

      // Wait for the transport to be attached. server.ts logs this line to
      // stderr immediately after `await server.connect(transport)`, so seeing
      // it guarantees stdin is being read.
      const onStderr = (chunk: Buffer) => {
        if (!resolved) {
          stderrBuf += chunk.toString();
          if (stderrBuf.length > STDERR_BUF_LIMIT) {
            stderrBuf = stderrBuf.slice(-STDERR_BUF_LIMIT);
          }
          if (stderrBuf.includes('running on stdio')) {
            resolved = true;
            clearTimeout(spawnTimeout);
            resolve(proc);
          }
        }
        // Listener stays attached after resolve so the stderr buffer keeps
        // draining; otherwise the OS pipe could fill and block the child.
      };
      proc.stderr?.on('data', onStderr);
    });
  }

  async function sendRequest(
    proc: ChildProcess,
    request: JsonRpcRequest
  ): Promise<JsonRpcResponse> {
    return new Promise((resolve, reject) => {
      // Server may have already exited before this call.
      if (proc.exitCode !== null || proc.signalCode !== null) {
        reject(
          new Error(
            `Cannot send request: server already exited (code=${proc.exitCode}, signal=${proc.signalCode})`
          )
        );
        return;
      }

      let buffer = '';

      const cleanup = () => {
        clearTimeout(timeout);
        proc.stdout?.off('data', onData);
        proc.off('exit', onExit);
      };

      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Request timed out'));
      }, REQUEST_TIMEOUT_MS);

      const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
        cleanup();
        reject(
          new Error(
            `Server exited before responding (code=${code}, signal=${signal})`
          )
        );
      };

      const onData = (data: Buffer) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const response = JSON.parse(line) as JsonRpcResponse;
            if (response.id === request.id) {
              cleanup();
              resolve(response);
              return;
            }
          } catch {
            // Not complete JSON yet, continue buffering
          }
        }
      };

      proc.stdout?.on('data', onData);
      proc.once('exit', onExit);

      proc.stdin?.write(JSON.stringify(request) + '\n');
    });
  }

  it('should start, expose ready signal, and exit cleanly when killed', async () => {
    serverProcess = await startServer();
    expect(serverProcess.pid).toBeDefined();
    expect(serverProcess.killed).toBe(false);

    const exitPromise = new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
    }>((resolve) => {
      serverProcess!.once('exit', (code, signal) =>
        resolve({ code, signal })
      );
    });

    serverProcess.kill();
    const { code, signal } = await exitPromise;
    // SIGTERM produces signal='SIGTERM' code=null, or code=0 if the server
    // installed a graceful handler.
    expect(code === 0 || signal === 'SIGTERM').toBe(true);
  });

  it('should respond to initialize request', async () => {
    serverProcess = await startServer();

    const response = await sendRequest(serverProcess, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {
          name: 'test-client',
          version: '1.0.0',
        },
      },
    });

    expect(response.error).toBeUndefined();
    expect(response.result).toBeDefined();

    const result = response.result as {
      protocolVersion: string;
      serverInfo: { name: string; version: string };
      capabilities: Record<string, unknown>;
    };

    expect(result.protocolVersion).toBeDefined();
    expect(result.serverInfo.name).toBe('@decibelsystems/tools');
    expect(result.capabilities.tools).toBeDefined();
  });

  it('should list tools after initialization', async () => {
    serverProcess = await startServer();

    // Initialize first
    await sendRequest(serverProcess, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0.0' },
      },
    });

    // Send initialized notification
    serverProcess.stdin?.write(
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      }) + '\n'
    );

    // List tools
    const response = await sendRequest(serverProcess, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
    });

    expect(response.error).toBeUndefined();
    const result = response.result as { tools: Array<{ name: string }> };
    // The MCP layer exposes facade-level tools (e.g. `designer`, `sentinel`),
    // and operations are invoked via an `action` parameter on the facade.
    // Assert facade names + a lower bound on count so new facades don't churn.
    expect(result.tools.length).toBeGreaterThan(20);
    const names = result.tools.map((t) => t.name);
    expect(names).toContain('designer');
    expect(names).toContain('sentinel');
    expect(names).toContain('oracle');
  });

  it('should execute tool call via stdio', async () => {
    serverProcess = await startServer();

    // Initialize
    await sendRequest(serverProcess, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0.0' },
      },
    });

    serverProcess.stdin?.write(
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      }) + '\n'
    );

    // Call tool
    const response = await sendRequest(serverProcess, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        // The MCP API routes through a facade tool with an `action` enum
        // rather than exposing every operation as its own tool.
        name: 'designer',
        arguments: {
          action: 'create_decision',
          projectId: 'e2e-test',
          area: 'Testing',
          summary: 'E2E test decision',
        },
      },
    });

    expect(response.error).toBeUndefined();
    const result = response.result as {
      content: Array<{ type: string; text: string }>;
    };
    expect(result.content).toHaveLength(1);

    const toolResult = JSON.parse(result.content[0].text);
    expect(toolResult.id).toMatch(/\.md$/);
    expect(toolResult.path).toContain('e2e-test');
  });

  // ── Regression tests for the recent fixes ───────────────────────────────

  it('removes its stdout listener after a successful sendRequest', async () => {
    serverProcess = await startServer();

    const before = serverProcess.stdout!.listenerCount('data');
    await sendRequest(serverProcess, {
      jsonrpc: '2.0',
      id: 42,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'leak-test', version: '1.0.0' },
      },
    });
    const after = serverProcess.stdout!.listenerCount('data');
    expect(after).toBe(before);
  });

  it('rejects sendRequest fast when the server exits mid-call', async () => {
    serverProcess = await startServer();

    // Kill the server before sending. Without the exit-aware fix this would
    // wait the full REQUEST_TIMEOUT_MS (5s).
    serverProcess.kill('SIGKILL');
    await new Promise<void>((resolve) =>
      serverProcess!.once('exit', () => resolve())
    );

    const start = Date.now();
    await expect(
      sendRequest(serverProcess, {
        jsonrpc: '2.0',
        id: 99,
        method: 'tools/list',
      })
    ).rejects.toThrow(/already exited/);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(1000);
  });
});

// ── buildServerEnv unit tests ─────────────────────────────────────────────
// These don't spawn anything — they verify the env-allowlist logic directly.

describe('buildServerEnv', () => {
  const SECRET_KEY = 'TEST_FAKE_SECRET_LIBJV';

  afterEach(() => {
    delete process.env[SECRET_KEY];
    delete process.env.DECIBEL_PRO;
  });

  it('drops parent env vars not on the allowlist', () => {
    process.env[SECRET_KEY] = 'leaked-credentials';
    const env = buildServerEnv('/tmp/whatever');
    expect(env[SECRET_KEY]).toBeUndefined();
  });

  it('forwards DECIBEL_* parent env vars by name prefix', () => {
    process.env.DECIBEL_PRO = '1';
    const env = buildServerEnv('/tmp/whatever');
    expect(env.DECIBEL_PRO).toBe('1');
  });

  it('overrides DECIBEL_ENV to "dev" regardless of parent value', () => {
    process.env.DECIBEL_ENV = 'production';
    const env = buildServerEnv('/tmp/whatever');
    expect(env.DECIBEL_ENV).toBe('dev');
  });

  it('forwards PATH so the spawned node can resolve binaries', () => {
    const env = buildServerEnv('/tmp/whatever');
    expect(env.PATH).toBe(process.env.PATH);
  });

  it('sets DECIBEL_MCP_ROOT and DECIBEL_PROJECT_ROOT to the rootDir argument', () => {
    const env = buildServerEnv('/tmp/some-test-dir');
    expect(env.DECIBEL_MCP_ROOT).toBe('/tmp/some-test-dir');
    expect(env.DECIBEL_PROJECT_ROOT).toBe('/tmp/some-test-dir');
  });
});
