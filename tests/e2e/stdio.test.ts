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
        env: {
          ...process.env,
          DECIBEL_MCP_ROOT: ctx.rootDir,
          DECIBEL_PROJECT_ROOT: ctx.rootDir,
          // Use 'dev' so the server emits its lifecycle logs to stderr —
          // startServer() waits for the "running on stdio" line as a ready
          // signal. With env='test', config.log() is a no-op (config.ts:25).
          DECIBEL_ENV: 'dev',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const spawnTimeout = setTimeout(() => {
        proc.kill();
        reject(
          new Error(
            `Server failed to emit ready signal within 30s. stderr so far: ${stderrBuf}`
          )
        );
      }, 30000);

      proc.on('error', (err) => {
        clearTimeout(spawnTimeout);
        reject(err);
      });

      // Wait for the transport to be attached. server.ts logs this line to
      // stderr immediately after `await server.connect(transport)`, so seeing
      // it guarantees stdin is being read.
      let stderrBuf = '';
      let resolved = false;
      const onStderr = (chunk: Buffer) => {
        if (!resolved) {
          stderrBuf += chunk.toString();
          if (stderrBuf.includes('running on stdio')) {
            resolved = true;
            clearTimeout(spawnTimeout);
            resolve(proc);
          }
        }
        // Keep the listener attached after resolve so the stderr buffer stays
        // drained; otherwise post-startup log writes could fill the pipe and
        // block the child process.
      };
      proc.stderr?.on('data', onStderr);
    });
  }

  async function sendRequest(
    proc: ChildProcess,
    request: JsonRpcRequest
  ): Promise<JsonRpcResponse> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Request timed out'));
      }, 5000);

      let buffer = '';

      const onData = (data: Buffer) => {
        buffer += data.toString();

        // Try to parse complete JSON-RPC response
        const lines = buffer.split('\n');
        for (const line of lines) {
          if (line.trim()) {
            try {
              const response = JSON.parse(line) as JsonRpcResponse;
              if (response.id === request.id) {
                clearTimeout(timeout);
                proc.stdout?.off('data', onData);
                resolve(response);
                return;
              }
            } catch {
              // Not complete JSON yet, continue buffering
            }
          }
        }
      };

      proc.stdout?.on('data', onData);

      // Send the request
      proc.stdin?.write(JSON.stringify(request) + '\n');
    });
  }

  it('should start server without errors', async () => {
    serverProcess = await startServer();

    expect(serverProcess.pid).toBeDefined();
    expect(serverProcess.killed).toBe(false);
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
});
