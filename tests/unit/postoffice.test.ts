import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { createServer, Server, IncomingMessage } from 'http';
import { AddressInfo } from 'net';
import {
  agentsList, threadsOpen, messagesSend, messagesRead, messagesAck,
  handoffRequest, handoffRespond, isPostOfficeError,
} from '../../src/tools/postoffice.js';

/**
 * EPIC-0037 client half. These run against a stand-in post office rather than
 * the live one, so they pin the contract and the failure mapping without
 * needing a credential or a network.
 *
 * The behaviours that matter most here are the ones that are easy to get wrong
 * and expensive to discover in production: that the credential never appears
 * anywhere except the Authorization header, and that read does not ack.
 */

let server: Server;
let base: string;
let seen: Array<{ body: Record<string, unknown>; headers: IncomingMessage['headers'] }> = [];
let respond: (verb: string) => { status: number; body: unknown } = () => ({ status: 200, body: { ok: true } });

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', c => chunks.push(c as Buffer));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      const body = raw ? JSON.parse(raw) : {};
      seen.push({ body, headers: req.headers });
      const { status, body: out } = respond(String(body.verb ?? ''));
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out));
    });
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => { await new Promise<void>(r => server.close(() => r())); });

beforeEach(() => {
  seen = [];
  respond = () => ({ status: 200, body: { ok: true } });
  process.env.DECIBEL_HQ_URL = base;
  process.env.DECIBEL_HQ_TOKEN = 'test-token-do-not-log';
});

afterEach(() => {
  delete process.env.DECIBEL_HQ_URL;
  delete process.env.DECIBEL_HQ_TOKEN;
});

describe('post office transport', () => {
  it('posts the verb envelope to /agents/mcp', async () => {
    await agentsList();
    expect(seen).toHaveLength(1);
    expect(seen[0].body.verb).toBe('agents.list');
  });

  it('sends the credential as a bearer header and nowhere else', async () => {
    await messagesSend({ to: 'peer', thread: 't1', summary: 'hello' });
    const { headers, body } = seen[0];
    expect(headers.authorization).toBe('Bearer test-token-do-not-log');
    // The token must not leak into the payload under any key.
    expect(JSON.stringify(body)).not.toContain('test-token-do-not-log');
  });

  it('keeps the credential out of error text, which is logged', async () => {
    respond = () => ({ status: 500, body: { error: 'boom' } });
    const res = await agentsList();
    expect(isPostOfficeError(res)).toBe(true);
    expect(JSON.stringify(res)).not.toContain('test-token-do-not-log');
  });

  it('reports an unconfigured credential as instructions, not a failure', async () => {
    delete process.env.DECIBEL_HQ_TOKEN;
    const res = await agentsList();
    expect(isPostOfficeError(res)).toBe(true);
    if (isPostOfficeError(res)) {
      expect(res.code).toBe('HQ_NOT_CONFIGURED');
      expect(res.hint).toContain('issue_agent_token');
    }
    expect(seen).toHaveLength(0); // never attempted
  });

  it('distinguishes 401 from 403 and names the missing scope', async () => {
    respond = () => ({ status: 401, body: { error: 'a valid bearer credential is required' } });
    const unauth = await agentsList();
    expect(isPostOfficeError(unauth) && unauth.code).toBe('HQ_UNAUTHORIZED');

    respond = () => ({ status: 403, body: { error: 'insufficient_scope', required: 'postoffice.write' } });
    const forbidden = await messagesAck({ message: 'm1' });
    expect(isPostOfficeError(forbidden) && forbidden.code).toBe('HQ_FORBIDDEN');
    if (isPostOfficeError(forbidden)) expect(forbidden.error).toContain('postoffice.write');
  });

  it('surfaces an unknown verb with the supported list', async () => {
    respond = () => ({
      status: 400,
      body: { error: 'unknown_verb', supported: ['agents.list', 'threads.open'] },
    });
    const res = await agentsList();
    expect(isPostOfficeError(res)).toBe(true);
    if (isPostOfficeError(res)) expect(res.error).toContain('agents.list');
  });

  it('reports an unreachable host without throwing', async () => {
    process.env.DECIBEL_HQ_URL = 'http://127.0.0.1:1';
    const res = await agentsList();
    expect(isPostOfficeError(res) && res.code).toBe('HQ_UNAVAILABLE');
  });
});

describe('verb payloads', () => {
  it('threads.open passes subject, project and intent', async () => {
    await threadsOpen({ subject: 'Phase 5', project: 'decibel-tools-mcp', intent: 'coordinate' });
    expect(seen[0].body).toMatchObject({
      verb: 'threads.open', subject: 'Phase 5', project: 'decibel-tools-mcp', intent: 'coordinate',
    });
  });

  it('messages.send carries refs and expectations', async () => {
    await messagesSend({
      to: 'decibel-hq', thread: 't1', summary: 'review this',
      intent: 'request', context_refs: ['ISS-0150'], expected_output: 'a verdict',
    });
    expect(seen[0].body).toMatchObject({
      verb: 'messages.send', to: 'decibel-hq', thread: 't1',
      intent: 'request', context_refs: ['ISS-0150'], expected_output: 'a verdict',
    });
  });

  it('handoff.request and handoff.respond hit their own verbs', async () => {
    await handoffRequest({ thread: 't1', to: 'peer', summary: 'yours now' });
    await handoffRespond({ thread: 't1', accept: true });
    expect(seen[0].body.verb).toBe('handoff.request');
    expect(seen[1].body).toMatchObject({ verb: 'handoff.respond', accept: true });
  });
});

describe('read/ack separation', () => {
  it('read sends no status filter by default', async () => {
    // Polling with status='sent' cannot return a message twice, because the far
    // side marks sent->read while serving the read. Omitting the filter is what
    // makes a crashed reader recoverable.
    await messagesRead();
    expect(seen[0].body).toEqual({ verb: 'messages.read' });
    expect(seen[0].body).not.toHaveProperty('status');
  });

  it('read passes an explicit filter when the caller insists', async () => {
    await messagesRead({ thread: 't1', status: 'read', limit: 10 });
    expect(seen[0].body).toMatchObject({ verb: 'messages.read', thread: 't1', status: 'read', limit: 10 });
  });

  it('reading never acks — they are different verbs', async () => {
    await messagesRead();
    await messagesAck({ message: 'm1' });
    expect(seen.map(s => s.body.verb)).toEqual(['messages.read', 'messages.ack']);
    // Nothing in the read call may carry an ack side effect.
    expect(JSON.stringify(seen[0].body)).not.toContain('ack');
  });

  it('ack targets one message by id', async () => {
    await messagesAck({ message: 'msg-123' });
    expect(seen[0].body).toEqual({ verb: 'messages.ack', message: 'msg-123' });
  });
});
