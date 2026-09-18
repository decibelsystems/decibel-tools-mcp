import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { localRequest, localJson } from '../../src/runtime/localHttp.js';

// The thin client's every call to the runtime goes through this module. It
// replaced global fetch() (undici, ~10.8 MB resident) with node:http, so these
// tests exist to pin the behaviours the callers actually depend on: status is
// reported rather than thrown on, bodies round-trip, headers and POST bodies
// arrive, and a hung server is bounded.

let server: Server;
let base: string;
let lastRequest: { method?: string; url?: string; headers: Record<string, unknown>; body: string } | null = null;

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      lastRequest = {
        method: req.method,
        url: req.url,
        headers: req.headers as Record<string, unknown>,
        body: Buffer.concat(chunks).toString('utf-8'),
      };

      const path = (req.url || '').split('?')[0];
      if (path === '/json') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, echoed: lastRequest.body || null }));
      } else if (path === '/missing') {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end('<html>no such endpoint</html>');
      } else if (path === '/boom') {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'kaboom' }));
      } else if (path === '/slow') {
        // Trickle: bytes keep arriving, so socket-inactivity timeouts would
        // never fire. The wall-clock bound must still hold.
        res.writeHead(200, { 'Content-Type': 'application/json' });
        const tick = setInterval(() => res.write(' '), 50);
        setTimeout(() => { clearInterval(tick); res.end('{}'); }, 5000);
        req.on('close', () => clearInterval(tick));
      } else {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('plain');
      }
    });
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>(r => server.close(() => r()));
});

describe('localRequest', () => {
  it('returns body and status for a 200', async () => {
    const res = await localRequest(`${base}/json`, { timeoutMs: 2000 });
    expect(res.status).toBe(200);
    expect(res.ok).toBe(true);
    expect(JSON.parse(res.text)).toEqual({ ok: true, echoed: null });
  });

  it('reports a 404 rather than throwing, so callers can explain it', async () => {
    const res = await localRequest(`${base}/missing`, { timeoutMs: 2000 });
    expect(res.status).toBe(404);
    expect(res.ok).toBe(false);
    expect(res.text).toContain('no such endpoint');
  });

  it('sends the query string through', async () => {
    await localRequest(`${base}/json?tier=full`, { timeoutMs: 2000 });
    expect(lastRequest?.url).toBe('/json?tier=full');
  });

  it('sends method, headers and body on a POST', async () => {
    const payload = JSON.stringify({ tool: 'sentinel', arguments: { action: 'list_issues' } });
    const res = await localRequest(`${base}/json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Agent-Id': 'agent-7' },
      body: payload,
      timeoutMs: 2000,
    });
    expect(res.status).toBe(200);
    expect(lastRequest?.method).toBe('POST');
    expect(lastRequest?.headers['x-agent-id']).toBe('agent-7');
    expect(lastRequest?.headers['content-length']).toBe(String(Buffer.byteLength(payload)));
    expect(lastRequest?.body).toBe(payload);
  });

  it('sets Content-Length from byte length, not character count', async () => {
    const payload = JSON.stringify({ note: 'ünïcødé — ✓' });
    await localRequest(`${base}/json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      timeoutMs: 2000,
    });
    expect(lastRequest?.body).toBe(payload);
    expect(Number(lastRequest?.headers['content-length'])).toBe(Buffer.byteLength(payload));
    expect(Buffer.byteLength(payload)).not.toBe(payload.length);
  });

  it('rejects when nothing is listening', async () => {
    // Port 1 is privileged and unbound; connect fails immediately.
    await expect(localRequest('http://127.0.0.1:1/json', { timeoutMs: 2000 }))
      .rejects.toThrow();
  });

  it('bounds a response that trickles forever', async () => {
    await expect(localRequest(`${base}/slow`, { timeoutMs: 300 }))
      .rejects.toThrow(/timed out after 300ms/);
  });
});

describe('localJson', () => {
  it('parses the body and preserves the status', async () => {
    const res = await localJson<{ ok: boolean }>(`${base}/boom`, { timeoutMs: 2000 });
    expect(res.status).toBe(500);
    expect(res.ok).toBe(false);
    expect(res.body).toEqual({ ok: false, error: 'kaboom' });
  });

  it('names the status when the body is not JSON, instead of a bare parse error', async () => {
    await expect(localJson(`${base}/missing`, { timeoutMs: 2000 }))
      .rejects.toThrow(/returned 404 with a non-JSON body/);
  });
});
