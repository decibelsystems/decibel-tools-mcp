// ============================================================================
// S4 — transport equivalence runner
// ============================================================================
// Spec: .decibel/specs/2026-09-02-tool-torture-test.md § S4
//
// The same call, four ways: stdio, thin stdio client, HTTP /call, HTTP /batch.
// This process owns all four and reports, per call, what each one answered.
//
// WHY THIS CANNOT BE A KERNEL TEST. S1 and S2 dispatch straight into the
// kernel, so they describe what the TOOLS do. Everything between the tool and
// the client — the MCP envelope, the wire envelope, the thin client's
// unwrapping, the batch result shape, the local-only gate — is invisible to
// them. "Both transports must stay in sync" is a stated project rule with no
// test behind it, and the failure it names (a tool that works in Claude Code
// and is missing in ChatGPT) is a shape only a cross-transport comparison can
// see.
//
// THE FOUR TRANSPORTS ARE FOUR REAL PROCESSES, not four code paths in one.
// A daemon is spawned, an stdio server is spawned, a thin client is spawned
// and pointed at the daemon, and the HTTP calls go over a socket. Simulating
// any of them in-process would test the simulation.
// ============================================================================

import { spawn, type ChildProcess } from 'child_process';
import fs from 'fs';
import net from 'net';
import path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createKernel } from '../../src/kernel.js';
import { sanitizeErrorMessage } from '../../src/lib/envelope.js';
import { buildSurface, normalise, DECLARED_DIFFERENCES, REPO_ROOT } from './harness.js';
import type { TransportName, TransportAnswer, EquivalenceRow, S4Report, BatchContract } from './harness.js';

const [, , sweep, ...rest] = process.argv;

function flag(name: string): string | undefined {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
}

const only = flag('only')?.split(',').filter(Boolean);
const callTimeoutMs = Number(flag('timeout') ?? 20_000);
const TSX = path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx');
const SERVER = path.join(REPO_ROOT, 'src', 'server.ts');

interface Call {
  id: string;
  facade: string;
  args: Record<string, unknown>;
}

// ============================================================================
// Digest — the comparison unit
// ============================================================================

/**
 * SANITISE BEFORE DIGESTING, ON EVERY TRANSPORT.
 *
 * `/call` runs every error message through sanitizeErrorMessage, which rewrites
 * `/Users/ben/x/.decibel/y` to `.decibel/y` and other absolute paths to
 * `[path]`. stdio does not. That is a deliberate difference — an error crossing
 * a network bind should not carry a home directory — but left alone it makes
 * every error-carrying payload look transport-dependent, and the real
 * differences drown in it.
 *
 * Applying the SAME function to all four sides is not a way of manufacturing
 * agreement: it is deterministic and lossy in exactly one direction, and
 * anything HTTP mangled beyond path redaction still shows up. The difference
 * itself is asserted separately, on the raw text, so it stays visible rather
 * than merely accommodated.
 */
function digestOf(payload: unknown): string {
  const sanitised = JSON.parse(sanitizeErrorMessage(JSON.stringify(payload)));
  return JSON.stringify(normalise(dropVolatile(sanitised), 0));
}

/**
 * Elapsed-time fields, removed before the digest is taken.
 *
 * `normalise` deliberately keeps zero distinct from nonzero, because the
 * healthiest readers in this codebase signal a degraded store through a count
 * and collapsing every number to one token condemned them (see its own note).
 * The cost of that choice shows up here: a scan that takes 0 ms on one
 * transport and 1 ms on the next reads as a payload difference. A duration is
 * the one field where the value genuinely carries no contract, so S4 drops it
 * rather than weakening the rule the other sweeps depend on.
 */
const VOLATILE_KEY = /(^|_)(duration|elapsed|uptime)(_|$)|duration$|Duration$|_ms$|Ms$/;

function dropVolatile(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(dropVolatile);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (VOLATILE_KEY.test(k)) continue;
      out[k] = dropVolatile(v);
    }
    return out;
  }
  return value;
}

function answerFromPayload(text: string, isError: boolean): TransportAnswer {
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return { isError, parsed: false, digest: '', sample: text.slice(0, 300), raw: text.slice(0, 300) };
  }
  return {
    isError,
    parsed: true,
    digest: digestOf(payload),
    sample: text.slice(0, 300),
    raw: text.slice(0, 300),
  };
}

function failed(failure: string): TransportAnswer {
  return { isError: false, parsed: false, digest: '', sample: '', raw: '', failure };
}

/** An MCP tool result, as stdio, thin and each /batch entry all return one. */
function answerFromMcp(result: unknown): TransportAnswer {
  const r = result as { content?: Array<{ text?: string }>; isError?: boolean } | undefined;
  if (!r) return failed('no result');
  const text = r.content?.[0]?.text ?? '';
  return answerFromPayload(text, !!r.isError);
}

// ============================================================================
// Declared envelope differences
// ============================================================================
// Each is a transform applied to ONE transport's answer so the payloads become
// comparable. The table lives in harness.ts, because the test asserts this list
// is EXHAUSTIVE — anything else that differs is a finding, and a difference that
// has to be added to it is a decision someone made rather than a shape that
// drifted. Importing it here keeps the runner and the assertion on one list.

const DIFFERENCES = DECLARED_DIFFERENCES;


/**
 * Undo `envelope:status+ok`, and `envelope:error-restringify` when it applies.
 * Shared by /call and the thin client, because the thin client IS an HTTP
 * client — it reads the same envelope and does its own partial unwrapping.
 */
function unwrapWireEnvelope(body: Record<string, unknown>): TransportAnswer {
  const failedCall = typeof body.ok === 'boolean' ? !body.ok : body.status === 'error';

  if (failedCall) {
    // envelope:error-restringify — the inner payload came back as a string.
    // It only un-nests when the string is actually the payload: a transport-
    // level failure (rate limit, body too large) carries prose here, and
    // rewriting that into an unparseable answer would report a divergence in
    // the tool when the difference is in the transport.
    if (typeof body.error === 'string') {
      const inner = answerFromPayload(body.error, true);
      if (inner.parsed) return { ...inner, unwrapped: 'envelope:error-restringify' };
    }
    return answerFromPayload(JSON.stringify({ error: body.error, code: body.code }), true);
  }

  const { ok: _ok, ...rest } = body;
  if (rest.status === 'executed') delete rest.status;
  return { ...answerFromPayload(JSON.stringify(rest), false), unwrapped: 'envelope:status+ok' };
}

// ============================================================================
// Ports and processes
// ============================================================================

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

async function waitForHealth(port: number, ms: number): Promise<Record<string, unknown>> {
  const deadline = Date.now() + ms;
  let last = '';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return (await res.json()) as Record<string, unknown>;
      last = `status ${res.status}`;
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(`daemon never became healthy on ${port}: ${last}`);
}

// ============================================================================
// The four drivers
// ============================================================================

interface Driver {
  name: TransportName;
  run(calls: Call[]): Promise<Map<string, TransportAnswer>>;
  listTools(): Promise<string[]>;
  stop(): Promise<void>;
}

/** stdio and thin differ only in the argv they are spawned with. */
async function mcpDriver(name: TransportName, args: string[]): Promise<Driver> {
  const transport = new StdioClientTransport({
    command: TSX,
    args: [SERVER, ...args],
    cwd: process.cwd(),
    env: process.env as Record<string, string>,
    stderr: 'ignore',
  });
  const client = new Client({ name: `torture-${name}`, version: '1.0.0' });
  await client.connect(transport);

  const isThin = name === 'thin';

  return {
    name,
    async listTools() {
      const res = await client.listTools();
      return res.tools.map(t => t.name).sort();
    },
    async run(calls) {
      const out = new Map<string, TransportAnswer>();
      for (const c of calls) {
        try {
          const result = await client.callTool(
            { name: c.facade, arguments: c.args },
            undefined,
            { timeout: callTimeoutMs }
          );
          // The thin client has already stripped `ok` and the "executed"
          // marker, but a FAILED call still carries the re-stringified inner
          // payload it got from /call. unThin un-nests that, so a thin failure
          // compares against the same payload stdio produced.
          out.set(c.id, isThin ? unThin(result) : answerFromMcp(result));
        } catch (err) {
          out.set(c.id, failed(err instanceof Error ? err.message : String(err)));
        }
      }
      return out;
    },
    async stop() {
      await client.close().catch(() => { /* the child is going away anyway */ });
    },
  };
}

/**
 * The thin client's failure path returns `{error: <json string>, code}` — the
 * wire envelope's error shape, minus the envelope. Un-nest it so a failure
 * compares against the same payload stdio produced.
 *
 * Only fires when the shape matches exactly and the string parses: the thin
 * client's OWN error (runtime unavailable) carries four keys and a prose
 * message, and must stay visible as itself.
 */
function unThin(result: unknown): TransportAnswer {
  const answer = answerFromMcp(result);
  if (!answer.isError || !answer.parsed) return answer;

  const r = result as { content?: Array<{ text?: string }> };
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(r.content?.[0]?.text ?? '') as Record<string, unknown>;
  } catch {
    return answer;
  }

  const keys = Object.keys(obj).sort().join(',');
  if (keys !== 'error' && keys !== 'code,error') return answer;
  if (typeof obj.error !== 'string') return answer;
  try {
    JSON.parse(obj.error);
  } catch {
    return answer;
  }
  return { ...answerFromPayload(obj.error, true), unwrapped: 'envelope:error-restringify' };
}

function httpCallDriver(port: number, toolNames: () => Promise<string[]>): Driver {
  return {
    name: 'http-call',
    listTools: toolNames,
    async run(calls) {
      const out = new Map<string, TransportAnswer>();
      for (const c of calls) {
        try {
          const res = await fetch(`http://127.0.0.1:${port}/call`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tool: c.facade, arguments: c.args }),
            signal: AbortSignal.timeout(callTimeoutMs),
          });
          const body = (await res.json()) as Record<string, unknown>;
          const answer = unwrapWireEnvelope(body);
          // The status code is part of the contract, not decoration: a caller
          // that branches on it must reach the same conclusion as one reading
          // `ok`.
          answer.httpStatus = res.status;
          out.set(c.id, answer);
        } catch (err) {
          out.set(c.id, failed(err instanceof Error ? err.message : String(err)));
        }
      }
      return out;
    },
    async stop() { /* nothing owned */ },
  };
}

const BATCH_LIMIT = 20;

/**
 * Split the call list into chunks holding AT MOST ONE CALL PER FACADE.
 *
 * /batch dispatches a chunk in parallel, and its contract says the calls are
 * independent. Two calls to the same facade against the same store are not:
 * `auditor.health_history` came back with one snapshot fewer than every other
 * transport because the `auditor.health` in its own chunk was still appending
 * to the log it was reading. That is /batch behaving exactly as documented,
 * and comparing it against three sequential transports would report it as a
 * transport bug.
 *
 * Chunking this way keeps the parallelism under test — chunks are still full,
 * still up to 20 wide — while making the calls in one genuinely independent.
 */
function independentChunks(calls: Call[]): Call[][] {
  const remaining = [...calls];
  const chunks: Call[][] = [];

  while (remaining.length) {
    const chunk: Call[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < remaining.length && chunk.length < BATCH_LIMIT; ) {
      if (seen.has(remaining[i].facade)) { i++; continue; }
      seen.add(remaining[i].facade);
      chunk.push(remaining.splice(i, 1)[0]);
    }
    chunks.push(chunk);
  }
  return chunks;
}

function httpBatchDriver(port: number, toolNames: () => Promise<string[]>): Driver {
  return {
    name: 'http-batch',
    listTools: toolNames,
    async run(calls) {
      const out = new Map<string, TransportAnswer>();
      for (const chunk of independentChunks(calls)) {
        try {
          const res = await fetch(`http://127.0.0.1:${port}/batch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              calls: chunk.map(c => {
                const { action, ...params } = c.args as { action?: string };
                return { facade: c.facade, action, params };
              }),
            }),
            signal: AbortSignal.timeout(callTimeoutMs * chunk.length),
          });
          const body = (await res.json()) as {
            ok?: boolean;
            results?: Array<{ facade: string; action: string; result?: unknown; error?: string; code?: string; duration_ms?: number }>;
          };
          const results = body.results ?? [];
          chunk.forEach((c, j) => {
            const entry = results[j];
            if (!entry) { out.set(c.id, failed('batch returned no entry for this call')); return; }
            // envelope:duration_ms — dropped. A structural miss has no `result`
            // at all and is reported as itself rather than as an empty answer.
            if (entry.result === undefined) {
              out.set(c.id, {
                ...answerFromPayload(JSON.stringify({ error: entry.error, code: entry.code }), true),
                batchStructuralMiss: true,
                batchOuterOk: body.ok,
              });
              return;
            }
            out.set(c.id, { ...answerFromMcp(entry.result), batchOuterOk: body.ok });
          });
        } catch (err) {
          const failure = err instanceof Error ? err.message : String(err);
          for (const c of chunk) out.set(c.id, failed(`batch chunk failed: ${failure}`));
        }
      }
      return out;
    },
    async stop() { /* nothing owned */ },
  };
}

/**
 * The two /batch outcomes that must stay distinguishable.
 *
 * `ok` reflects STRUCTURAL validity — did every call name something this
 * runtime has — and NOT whether the calls succeeded. A call that ran and
 * failed leaves ok true, because partial failure is a normal batch outcome
 * and callers depend on it. A call naming a facade that is not registered
 * does not, because since Phase 7 the registered set is machine-dependent and
 * a missing extension must not read as an empty answer.
 *
 * Both halves are asserted, because collapsing them is the obvious
 * simplification and it would be silent.
 */
async function probeBatchContract(port: number): Promise<BatchContract> {
  const post = async (calls: unknown[]) => {
    const res = await fetch(`http://127.0.0.1:${port}/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ calls }),
      signal: AbortSignal.timeout(callTimeoutMs),
    });
    const body = (await res.json()) as {
      ok?: boolean;
      results?: Array<{ result?: { isError?: boolean }; code?: string }>;
    };
    return { httpStatus: res.status, body };
  };

  // One call that succeeds and one that runs and fails on missing arguments.
  const partial = await post([
    { facade: 'sentinel', action: 'list_issues', params: { project_id: 'torture' } },
    { facade: 'sentinel', action: 'create_issue', params: {} },
  ]);

  // A facade this runtime does not have. Named so it cannot ever exist.
  const structural = await post([
    { facade: 'sentinel', action: 'list_issues', params: { project_id: 'torture' } },
    { facade: 'no_such_facade_at_all', action: 'x', params: {} },
  ]);

  return {
    partialFailure: {
      outerOk: partial.body.ok,
      httpStatus: partial.httpStatus,
      innerIsError: (partial.body.results ?? []).map(r => !!r.result?.isError),
      codes: (partial.body.results ?? []).map(r => r.code ?? null),
    },
    structuralMiss: {
      outerOk: structural.body.ok,
      httpStatus: structural.httpStatus,
      codes: (structural.body.results ?? []).map(r => r.code ?? null),
      hasResult: (structural.body.results ?? []).map(r => r.result !== undefined),
    },
  };
}

// ============================================================================
// Call lists
// ============================================================================

const SITUATIONS = {
  empty: 'torture-empty',
  unreadable: 'torture-unreadable',
  unparseable: 'torture-unparseable',
  unresolvable: 'no-such-project-exists-anywhere-at-all',
} as const;

const kernel = await createKernel();
const surface = buildSurface(kernel);

function callList(): Call[] {
  const actions = surface.actions.filter(a => !only || only.includes(a.id));

  if (sweep === 'S2') {
    const reads = actions.filter(a => a.readOnly);
    return reads.flatMap(a =>
      Object.entries(SITUATIONS).map(([situation, projectId]) => ({
        id: `${a.id}::${situation}`,
        facade: a.facade,
        args: { action: a.action, project_id: projectId },
      }))
    );
  }

  return actions.map(a => ({ id: a.id, facade: a.facade, args: { action: a.action } }));
}

// ============================================================================
// Run
// ============================================================================

/**
 * Return the sandbox to the state the first transport found.
 *
 * THE WHOLE PROJECT DIRECTORY, not just its `.decibel` store. Resetting only
 * the store left three actions diverging on the FIRST pass whichever transport
 * ran it — `auditor.init` writes `naming-conventions.yml` beside the store
 * rather than inside it, and `sentinel.audit_policies` compiles alongside. The
 * reversed-order run is what proved it: the odd answer followed the position,
 * not the transport.
 *
 * ~/.decibel is left alone — projects.json and config.yaml describe the
 * sandbox rather than living in it.
 */
function resetStore(): void {
  for (const [name, snapshot] of Object.entries(fixtures)) {
    const root = path.join(process.env.HOME!, name);
    const store = path.join(root, '.decibel');

    if (snapshot.storeUnreadable && fs.existsSync(store)) fs.chmodSync(store, 0o755);
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(store, { recursive: true });

    for (const [rel, body] of Object.entries(snapshot.files)) {
      const file = path.join(root, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, body);
    }
    // Last, for the reason makeS2Sandbox does it last: nothing can be written
    // into an unreadable directory afterwards.
    if (snapshot.storeUnreadable) fs.chmodSync(store, 0o000);
  }
}

interface Snapshot {
  files: Record<string, string>;
  storeUnreadable: boolean;
}

/**
 * Every project directory as it stands BEFORE the first pass, so each later
 * pass can be put back to it.
 *
 * Read off disk rather than duplicated from makeS2Sandbox: two copies of a
 * fixture set is two things to keep in step, and a sweep that restored the
 * wrong one would still be green.
 */
const fixtures: Record<string, Snapshot> = (() => {
  const home = process.env.HOME!;
  const out: Record<string, Snapshot> = {};

  for (const entry of fs.readdirSync(home, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === '.decibel') continue;
    const root = path.join(home, entry.name);
    const store = path.join(root, '.decibel');
    if (!fs.existsSync(store)) continue;

    const storeUnreadable = (fs.statSync(store).mode & 0o777) === 0;
    if (storeUnreadable) fs.chmodSync(store, 0o755);

    const files: Record<string, string> = {};
    const walk = (dir: string, prefix: string) => {
      for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, f.name);
        const rel = prefix ? path.join(prefix, f.name) : f.name;
        if (f.isDirectory()) walk(abs, rel);
        else files[rel] = fs.readFileSync(abs, 'utf-8');
      }
    };
    walk(root, '');

    if (storeUnreadable) fs.chmodSync(store, 0o000);
    out[entry.name] = { files, storeUnreadable };
  }
  return out;
})();

const calls = callList();

// ============================================================================
// One pass per transport, each against a runtime that has never served another
// ============================================================================
// The first version shared one daemon across the three HTTP-family passes and
// reset only the store between them. Twenty calls still diverged, and every
// one of them was a shared-runtime artefact rather than a transport
// difference:
//
//   - the CIRCUIT BREAKER is per-runtime and keyed on the facade, so the thin
//     pass's argument-less `coordinator.lock` opened a circuit that then
//     failed the `coordinator.status` and `coordinator.log` of every later
//     pass. (Real behaviour, and worth knowing — asserted on purpose below
//     rather than left to contaminate the comparison.)
//   - `sentinel.audit_policies` and `auditor.health_history` answered from
//     runtime state that outlived the store reset.
//
// A fresh daemon per pass costs about a second and removes the whole class.
// What is left after it is attributable to the transport, which is the only
// thing S4 is entitled to claim.

interface Pass {
  name: TransportName;
  make(port: number): Promise<Driver> | Driver;
}

const PASSES: Pass[] = [
  { name: 'stdio', make: () => mcpDriver('stdio', []) },
  { name: 'thin', make: p => mcpDriver('thin', ['--thin', `http://127.0.0.1:${p}`]) },
  { name: 'http-call', make: p => httpCallDriver(p, () => httpTools(p)) },
  { name: 'http-batch', make: p => httpBatchDriver(p, () => httpTools(p)) },
];

async function httpTools(port: number): Promise<string[]> {
  const res = await fetch(`http://127.0.0.1:${port}/mcp/tools?tier=full`);
  const body = (await res.json()) as { tools?: Array<{ name: string }> };
  return (body.tools ?? []).map(t => t.name).sort();
}

async function startDaemon(port: number): Promise<{ proc: ChildProcess; health: Record<string, unknown> }> {
  const proc = spawn(TSX, [SERVER, '--daemon', '--port', String(port)], {
    env: process.env,
    stdio: ['ignore', 'ignore', 'ignore'],
    cwd: process.cwd(),
  });
  const health = await waitForHealth(port, 120_000);
  return { proc, health };
}

async function stopDaemon(proc: ChildProcess): Promise<void> {
  proc.kill('SIGTERM');
  for (let i = 0; i < 40 && proc.exitCode === null && proc.signalCode === null; i++) {
    await new Promise(r => setTimeout(r, 100));
  }
  if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGKILL');
}

const byTransport = new Map<TransportName, Map<string, TransportAnswer>>();
const tools: Array<readonly [TransportName, string[]]> = [];
let health: Record<string, unknown> = {};
let lastPort = 0;
let batchContract: BatchContract | undefined;

for (const pass of PASSES) {
  resetStore();

  const port = await freePort();
  lastPort = port;
  let daemon: ChildProcess | undefined;
  let driver: Driver | undefined;

  try {
    // A DAEMON FOR EVERY PASS, INCLUDING THE ONE THAT DOES NOT USE IT.
    //
    // The stdio pass ran without one at first, and `guardian.scan_config`
    // duly reported two checks where the other three reported four: it adds
    // pid_perms and log_dir when a daemon is running. The tool was right and
    // the harness was comparing two different machines. An idle daemon costs
    // a second and makes the four passes describe the same one.
    const started = await startDaemon(port);
    daemon = started.proc;
    health = started.health;

    driver = await pass.make(port);
    tools.push([pass.name, await driver.listTools()]);
    byTransport.set(pass.name, await driver.run(calls));

    // Probed on the batch pass's own daemon, after its sweep, so it observes
    // the runtime in the state the sweep left it rather than a pristine one.
    if (pass.name === 'http-batch') batchContract = await probeBatchContract(port);
  } finally {
    if (driver) await driver.stop().catch(() => { /* shutting down */ });
    if (daemon) await stopDaemon(daemon);
  }
}

const rows: EquivalenceRow[] = calls.map(c => ({
  id: c.id,
  facade: c.facade,
  answers: Object.fromEntries(
    [...byTransport].map(([name, m]) => [name, m.get(c.id) ?? failed('transport produced no answer')])
  ) as Record<TransportName, TransportAnswer>,
}));

const report: S4Report = {
  sweep: sweep === 'S2' ? 'S2' : 'S1',
  port: lastPort,
  health,
  tools: Object.fromEntries(tools) as Record<TransportName, string[]>,
  batchContract: batchContract!,
  rows,
};

console.log('{SWEEP}' + JSON.stringify(report));
