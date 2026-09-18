import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn, ChildProcess } from 'child_process';
import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import path from 'path';
import { fileURLToPath } from 'url';
import { createTestContext, cleanupTestContext, TestContext } from '../utils/test-context.js';
import { buildServerEnv } from '../utils/server-env.js';

// Drives the artifact: a real `--thin` process over stdio, against a stand-in
// runtime. The thin adapter owns no kernel, so everything it answers has to
// come off the wire — which makes this the only place the definitions fetch and
// the call proxy are exercised end to end.

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const READY = 'no local runtime in this process';
const SPAWN_TIMEOUT_MS = 30000;
const REQUEST_TIMEOUT_MS = 8000;

const TOOL_DEFS = [
  { name: 'sentinel', description: 'work tracking', inputSchema: { type: 'object', properties: { action: { type: 'string' } } } },
  { name: 'oracle', description: 'strategy', inputSchema: { type: 'object', properties: { action: { type: 'string' } } } },
];

interface FakeRuntime {
  server: Server;
  port: number;
  calls: Array<{ path: string; headers: Record<string, unknown>; body: string }>;
  /** Set to make POST /call answer with a failure envelope. */
  failNextCall: boolean;
}

async function startFakeRuntime(opts: { protocol?: string; toolsStatus?: number } = {}): Promise<FakeRuntime> {
  const state: FakeRuntime = { server: null as unknown as Server, port: 0, calls: [], failNextCall: false };

  state.server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf-8');
      const url = req.url || '';
      const route = url.split('?')[0];
      state.calls.push({ path: url, headers: req.headers as Record<string, unknown>, body });

      const json = (code: number, payload: unknown) => {
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      };

      if (route === '/health') {
        return json(200, {
          status: 'ok',
          version: '9.9.9-fake',
          protocol_version: opts.protocol ?? '1.1',
          pid: 4242,
          uptime_ms: 1000,
          facade_count: TOOL_DEFS.length,
          license_tier: 'pro',
        });
      }

      if (route === '/mcp/tools') {
        if (opts.toolsStatus === 404) {
          // An older runtime: no such endpoint, and an HTML error page.
          res.writeHead(404, { 'Content-Type': 'text/html' });
          return res.end('<html>404</html>');
        }
        return json(200, { ok: true, tools: TOOL_DEFS });
      }

      if (route === '/call') {
        if (state.failNextCall) {
          return json(200, { ok: false, status: 'error', error: 'runtime said no', code: 'E_NOPE' });
        }
        const parsed = JSON.parse(body) as { tool: string; arguments: Record<string, unknown> };
        // `status: 'open'` is a DOMAIN value here, not the envelope marker —
        // the thin adapter must not strip it (the bug fixed in #55).
        return json(200, {
          ok: true,
          status: 'executed',
          tool: parsed.tool,
          received: parsed.arguments,
          issues: [{ id: 'ISS-0001', status: 'open' }],
        });
      }

      json(404, { ok: false, error: 'not found' });
    });
  });

  await new Promise<void>(r => state.server.listen(0, '127.0.0.1', r));
  state.port = (state.server.address() as AddressInfo).port;
  return state;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: any;
  error?: { code: number; message: string };
}

describe('Thin stdio client E2E', { timeout: 60000 }, () => {
  let ctx: TestContext;
  let proc: ChildProcess | null = null;
  let runtime: FakeRuntime | null = null;

  beforeEach(async () => { ctx = await createTestContext(); });

  afterEach(async () => {
    if (proc) { proc.kill(); proc = null; }
    if (runtime) { await new Promise<void>(r => runtime!.server.close(() => r())); runtime = null; }
    await cleanupTestContext(ctx);
  });

  function startThin(port: number): Promise<{ proc: ChildProcess; stderr: () => string }> {
    return new Promise((resolve, reject) => {
      const p = spawn('node', ['--import', 'tsx', 'src/server.ts', '--thin', `http://127.0.0.1:${port}`], {
        cwd: PROJECT_ROOT,
        env: buildServerEnv(ctx.rootDir),
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let buf = '';
      let done = false;
      const timer = setTimeout(() => {
        p.kill();
        reject(new Error(`thin client never signalled ready. stderr: ${buf}`));
      }, SPAWN_TIMEOUT_MS);

      p.stderr?.on('data', (c: Buffer) => {
        buf += c.toString();
        if (!done && buf.includes(READY)) {
          done = true;
          clearTimeout(timer);
          resolve({ proc: p, stderr: () => buf });
        }
      });
      p.on('exit', () => {
        if (!done) { done = true; clearTimeout(timer); reject(new Error(`thin client exited. stderr: ${buf}`)); }
      });
      p.on('error', (e) => { clearTimeout(timer); reject(e); });
    });
  }

  function send(p: ChildProcess, req: Record<string, unknown>): Promise<JsonRpcResponse> {
    return new Promise((resolve, reject) => {
      let buffer = '';
      const cleanup = () => { clearTimeout(timer); p.stdout?.off('data', onData); };
      const timer = setTimeout(() => { cleanup(); reject(new Error('request timed out')); }, REQUEST_TIMEOUT_MS);
      const onData = (chunk: Buffer) => {
        buffer += chunk.toString();
        for (const line of buffer.split('\n')) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line) as JsonRpcResponse;
            if (msg.id === req.id) { cleanup(); resolve(msg); return; }
          } catch { /* partial line */ }
        }
      };
      p.stdout?.on('data', onData);
      p.stdin?.write(JSON.stringify(req) + '\n');
    });
  }

  async function handshake(p: ChildProcess) {
    await send(p, {
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } },
    });
    p.stdin?.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  }

  it('serves the runtime\'s tool definitions without building a kernel', async () => {
    runtime = await startFakeRuntime();
    const started = await startThin(runtime.port);
    proc = started.proc;

    await handshake(proc);
    const res = await send(proc, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });

    expect(res.result.tools).toHaveLength(2);
    expect(res.result.tools.map((t: { name: string }) => t.name)).toEqual(['sentinel', 'oracle']);
    expect(runtime.calls.some(c => c.path.startsWith('/mcp/tools'))).toBe(true);
  });

  it('proxies a tool call to the runtime and returns the payload', async () => {
    runtime = await startFakeRuntime();
    const started = await startThin(runtime.port);
    proc = started.proc;

    await handshake(proc);
    const res = await send(proc, {
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'sentinel', arguments: { action: 'list_issues', project_id: 'p' } },
    });

    expect(res.result.isError).toBeFalsy();
    const payload = JSON.parse(res.result.content[0].text);
    expect(payload.tool).toBe('sentinel');
    expect(payload.received).toEqual({ action: 'list_issues', project_id: 'p' });

    const call = runtime.calls.find(c => c.path === '/call');
    expect(call).toBeDefined();
    expect(JSON.parse(call!.body)).toEqual({
      tool: 'sentinel',
      arguments: { action: 'list_issues', project_id: 'p' },
    });
  });

  it('strips the envelope marker but keeps a domain status', async () => {
    runtime = await startFakeRuntime();
    const started = await startThin(runtime.port);
    proc = started.proc;

    await handshake(proc);
    const res = await send(proc, {
      jsonrpc: '2.0', id: 4, method: 'tools/call',
      params: { name: 'sentinel', arguments: { action: 'list_issues' } },
    });

    const payload = JSON.parse(res.result.content[0].text);
    expect(payload.ok).toBeUndefined();        // envelope marker, dropped
    expect(payload.status).toBeUndefined();    // 'executed' is envelope, dropped
    expect(payload.issues[0].status).toBe('open'); // domain value, preserved
  });

  it('forwards dispatch context as headers', async () => {
    runtime = await startFakeRuntime();
    const started = await startThin(runtime.port);
    proc = started.proc;

    await handshake(proc);
    await send(proc, {
      jsonrpc: '2.0', id: 5, method: 'tools/call',
      params: {
        name: 'oracle',
        arguments: { action: 'next_actions' },
        _meta: { agentId: 'agent-9', runId: 'run-3', scope: 'project' },
      },
    });

    const call = runtime.calls.find(c => c.path === '/call');
    expect(call!.headers['x-agent-id']).toBe('agent-9');
    expect(call!.headers['x-run-id']).toBe('run-3');
    expect(call!.headers['x-scope']).toBe('project');
  });

  it('surfaces a runtime error as an MCP error rather than a success', async () => {
    runtime = await startFakeRuntime();
    const started = await startThin(runtime.port);
    proc = started.proc;
    runtime.failNextCall = true;

    await handshake(proc);
    const res = await send(proc, {
      jsonrpc: '2.0', id: 6, method: 'tools/call',
      params: { name: 'sentinel', arguments: { action: 'list_issues' } },
    });

    expect(res.result.isError).toBe(true);
    expect(JSON.parse(res.result.content[0].text).error).toBe('runtime said no');
  });

  it('refuses to start against a runtime with no definitions endpoint, naming the fix', async () => {
    runtime = await startFakeRuntime({ toolsStatus: 404 });
    await expect(startThin(runtime.port)).rejects.toThrow(/has no \/mcp\/tools endpoint/);
  });

  it('refuses to start against an incompatible protocol instead of failing per-call', async () => {
    runtime = await startFakeRuntime({ protocol: '0.9' });
    await expect(startThin(runtime.port)).rejects.toThrow(/protocol/i);
  });
});
