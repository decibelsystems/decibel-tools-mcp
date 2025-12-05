import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import {
  createTestContext,
  cleanupTestContext,
  TestContext,
} from '../utils/test-context.js';

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

describe('MCP Server E2E (stdio)', () => {
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
        cwd: path.resolve(process.cwd()),
        env: {
          ...process.env,
          DECIBEL_MCP_ROOT: ctx.rootDir,
          DECIBEL_ENV: 'test',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      proc.on('error', reject);

      // Give server time to start
      setTimeout(() => resolve(proc), 500);
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
    expect(result.serverInfo.name).toBe('decibel-tools-mcp');
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
    expect(result.tools).toHaveLength(8);
    expect(result.tools.map((t) => t.name)).toContain(
      'designer.record_design_decision'
    );
    expect(result.tools.map((t) => t.name)).toContain(
      'sentinel.log_epic'
    );
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
        name: 'designer.record_design_decision',
        arguments: {
          project_id: 'e2e-test',
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
