// ============================================================================
// Zoom facade gating — ISS-0123
// ============================================================================
// The zoom facade reaches an account-wide admin Zoom credential:
// meeting_summary:read:admin reads EVERY meeting in the account, personal as
// well as client. senken.pro runs this repo as a submodule and serves /call,
// /batch and /tools unauthenticated, so "who can reach this facade" is not a
// question tier gating answers — ISS-0101, the DECIBEL_PRO bypass, is still
// open, and pro tier is not currently a trustworthy boundary.
//
// Three gates, tested here in order of how much weight each actually carries:
//
//   1. DECIBEL_ZOOM=1 — fail closed by ABSENCE. This is the one that holds.
//   2. localOnly       — rejected over the HTTP transport.
//   3. pro tier        — the facade's declared tier.
//
// Gate 2 is defence in depth rather than a boundary on its own: a deployment
// that fronts this process with a local reverse proxy (senken.pro runs gunicorn
// in front of it) makes a remote request arrive wearing a loopback address.
// That is precisely why gate 1 exists and why it is not merely a convenience
// switch.
//
// The env var is read at module load, so each case runs in its own child
// process with a fresh module registry — flipping process.env inside one
// process would test nothing, since the modules have already read it.
// ============================================================================

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Run a snippet against a freshly built kernel in a child process with a given
 * environment.
 *
 * Written to a real file rather than passed to `tsx -e`: eval mode compiles to
 * CJS, where top-level await is a build error and a `.js` specifier pointing at
 * a `.ts` source does not resolve.
 */
function inProcess(code: string, env: Record<string, string>): Record<string, unknown> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoom-gate-'));
  // .mts, not .ts: the temp dir sits outside the project, so there is no
  // package.json "type": "module" to inherit and a .ts file is compiled as CJS,
  // where the top-level await below is a build error.
  const file = path.join(dir, 'probe.mts');
  fs.writeFileSync(file, `
    import { createKernel } from '${ROOT}/src/kernel.js';
    const kernel = await createKernel();
    const textOf = (r: any) => JSON.parse(r.content.find((c: any) => c.type === 'text')?.text ?? '{}');
    ${code}
  `);

  try {
    const out = execFileSync('npx', ['tsx', file], {
      cwd: ROOT,
      encoding: 'utf-8',
      env: { ...process.env, DECIBEL_PRO: '1', NODE_ENV: 'test', ...env },
      timeout: 60_000,
    });
    // The kernel logs to stdout; the assertion payload is the tagged line.
    const line = out.trim().split('\n').filter(l => l.startsWith('{RESULT}')).pop();
    if (!line) throw new Error(`no result line in output:\n${out}`);
    return JSON.parse(line.slice('{RESULT}'.length)) as Record<string, unknown>;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('zoom facade gating (ISS-0123)', () => {
  it('is not registered at all without DECIBEL_ZOOM=1', () => {
    // Fail closed by absence. Dispatch answers "unknown facade" — the same
    // shape an unallowlisted extension gets. An unregistered facade returning
    // something zero-shaped instead would be indistinguishable from a real
    // empty answer, which is how a broken voice inbox once read as "0 messages".
    const res = inProcess(`
      const listed = kernel.getMcpToolDefinitions('full').map(d => d.name);
      const r = await kernel.dispatch('zoom', { action: 'routes' }, {});
      console.log('{RESULT}' + JSON.stringify({
        listed: listed.includes('zoom'),
        isError: !!r.isError,
        error: textOf(r).error,
      }));
    `, { DECIBEL_ZOOM: '' });

    expect(res.listed).toBe(false);
    expect(res.isError).toBe(true);
    expect(String(res.error)).toMatch(/unknown|not found|unrecognized/i);
  });

  it('is registered and dispatchable over stdio with DECIBEL_ZOOM=1', () => {
    // zoom_routes reads the project registry only — no Zoom API call and no
    // credentials — so this exercises real dispatch without touching the
    // account-wide credential.
    const res = inProcess(`
      const listed = kernel.getMcpToolDefinitions('full').map(d => d.name);
      const r = await kernel.dispatch('zoom', { action: 'routes' }, { transport: 'stdio' });
      console.log('{RESULT}' + JSON.stringify({
        listed: listed.includes('zoom'),
        isError: !!r.isError,
        body: textOf(r),
      }));
    `, { DECIBEL_ZOOM: '1' });

    expect(res.listed).toBe(true);
    expect(res.isError).toBe(false);
    expect(res.body).toHaveProperty('routes');
  });

  it('refuses the facade over the HTTP transport even when licensed pro', () => {
    // The case tier gating would wave straight through: a fully licensed pro
    // caller arriving over a network bind.
    const res = inProcess(`
      const r = await kernel.dispatch('zoom', { action: 'routes' }, { transport: 'http', tier: 'pro' });
      console.log('{RESULT}' + JSON.stringify({ isError: !!r.isError, error: textOf(r).error }));
    `, { DECIBEL_ZOOM: '1' });

    expect(res.isError).toBe(true);
    expect(String(res.error)).toMatch(/local-only/i);
  });

  it('refuses a DIRECT internal tool call over HTTP, not just the facade name', () => {
    // The bypass that matters: calling zoom_sync directly sidesteps a guard
    // that only looks at facade names. The reverse map is exact rather than a
    // name-prefix guess, for the same reason the tier guard is.
    const res = inProcess(`
      const r = await kernel.dispatch('zoom_sync', { days: 1 }, { transport: 'http', tier: 'pro' });
      console.log('{RESULT}' + JSON.stringify({ isError: !!r.isError, error: textOf(r).error }));
    `, { DECIBEL_ZOOM: '1' });

    expect(res.isError).toBe(true);
    expect(String(res.error)).toMatch(/local-only/i);
  });

  it('hides the facade from an HTTP tools listing it would then refuse', () => {
    // Advertising a tool and rejecting every call to it is a worse failure than
    // not advertising it: the caller reads the rejection as a bug in the server.
    const res = inProcess(`
      const overHttp = kernel.getMcpToolDefinitions('full', { transport: 'http' }).map(d => d.name);
      const overStdio = kernel.getMcpToolDefinitions('full', { transport: 'stdio' }).map(d => d.name);
      console.log('{RESULT}' + JSON.stringify({
        http: overHttp.includes('zoom'),
        stdio: overStdio.includes('zoom'),
        othersStillListed: overHttp.includes('sentinel'),
      }));
    `, { DECIBEL_ZOOM: '1' });

    expect(res.http).toBe(false);
    expect(res.stdio).toBe(true);
    // The filter must remove the local-only facade and nothing else.
    expect(res.othersStillListed).toBe(true);
  });

  it('still refuses a core-tier caller on the ordinary pro-tier gate', () => {
    const res = inProcess(`
      const r = await kernel.dispatch('zoom', { action: 'routes' }, { tier: 'core' });
      console.log('{RESULT}' + JSON.stringify({ isError: !!r.isError, error: textOf(r).error }));
    `, { DECIBEL_ZOOM: '1' });

    expect(res.isError).toBe(true);
    expect(String(res.error)).toMatch(/pro license/i);
  });
});
