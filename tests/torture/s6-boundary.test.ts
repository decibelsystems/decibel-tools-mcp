// ============================================================================
// S6 — Tier and extension boundary
// ============================================================================
// Phase 7 moved the private facades out of the package entirely: they are no
// longer env-gated, they are absent, and they come back only as extensions
// named by ABSOLUTE PATH in an allowlist under ~/.decibel/config.yaml.
//
// "Fail closed by absence" is a stronger guarantee than a runtime tier check —
// one missed branch defeats a tier check, while an absent module cannot be
// called at all. This sweep exists so that guarantee cannot quietly erode back
// into an environment variable.
//
// Gate for 3.0: HARD.
// ============================================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { REPO_ROOT, makeSandbox, scrubbedEnv, APPS_EXTENSIONS, type SandboxPaths } from './harness.js';

let box: SandboxPaths;

beforeAll(() => { box = makeSandbox('s6'); });
afterAll(() => box?.cleanup());

/**
 * Boot a kernel in a child process with a given HOME and environment, and
 * report what it registered plus how it answered a probe dispatch.
 *
 * A child process is not optional here: tier flags and the extension allowlist
 * are read once at import, so anything asserted in-process would describe the
 * kernel this test file happened to boot with rather than the one the scenario
 * describes.
 */
function boot(
  home: string,
  env: Record<string, string>,
  probe?: { name: string; args?: Record<string, unknown>; tier?: 'core' | 'pro' | 'apps' }
): { facades: string[]; rejected: Array<{ entry: string; reason: string }>; probe?: { isError: boolean; text: string } } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 's6-probe-'));
  const file = path.join(dir, 'probe.mts');
  fs.writeFileSync(file, `
    import { createKernel, getExtensionDiagnostics } from '${REPO_ROOT}/src/kernel.js';
    const kernel = await createKernel();
    const diag = getExtensionDiagnostics();
    let probe: unknown = undefined;
    ${probe ? `
    {
      const r = await kernel.dispatch(${JSON.stringify(probe.name)}, ${JSON.stringify(probe.args ?? {})}, ${JSON.stringify({ transport: 'stdio', tier: probe.tier ?? 'pro' })});
      probe = { isError: !!r.isError, text: (r.content?.[0]?.text ?? '').slice(0, 400) };
    }` : ''}
    console.log('{S6}' + JSON.stringify({
      facades: kernel.facades.map(f => f.name),
      rejected: diag.rejected ?? [],
      probe,
    }));
  `);

  try {
    const out = execFileSync(path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx'), [file], {
      cwd: dir,
      encoding: 'utf-8',
      env: { ...scrubbedEnv(home), ...env },
      timeout: 300_000,
      maxBuffer: 32 * 1024 * 1024,
    });
    const line = out.split('\n').filter(l => l.startsWith('{S6}')).pop();
    if (!line) throw new Error(`no result:\n${out.slice(-2000)}`);
    return JSON.parse(line.slice('{S6}'.length));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** A HOME whose config.yaml carries the given extension allowlist entries. */
function homeWithAllowlist(label: string, entries: string[]): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `s6-${label}-`));
  fs.mkdirSync(path.join(home, '.decibel'), { recursive: true });
  fs.writeFileSync(
    path.join(home, '.decibel', 'projects.json'),
    JSON.stringify({ projects: [{ id: 'torture', path: home, default: true }] })
  );
  fs.writeFileSync(
    path.join(home, '.decibel', 'config.yaml'),
    `extensions:\n  allow:\n${entries.map(e => `    - ${e}`).join('\n')}\n`
  );
  return home;
}

const APPS = ['senken', 'deck', 'mother', 'terminal'];

describe('S6 — tier and extension boundary', () => {
  it('refuses a pro facade to a core-tier caller, before dispatch', () => {
    const r = boot(box.home, {}, { name: 'voice', args: { action: 'inbox_list' }, tier: 'core' });
    expect(r.probe?.isError).toBe(true);
    expect(r.probe?.text).toMatch(/pro license|requires a pro/i);
  });

  it('refuses an apps facade to a core-tier caller, before dispatch', () => {
    const r = boot(box.home, {}, { name: 'deck', args: { action: 'list' }, tier: 'core' });
    expect(r.probe?.isError).toBe(true);
  });

  it('DECIBEL_APPS=1 is inert — it cannot re-enable an apps facade', () => {
    // The regression this exists to prevent. Phase 7's guarantee is absence,
    // not a gate: if setting an environment variable brings deck back, the
    // private facades are one exported variable away from a public install.
    const home = homeWithAllowlist('no-allowlist', []);
    try {
      const r = boot(home, { DECIBEL_APPS: '1' });
      for (const m of APPS) expect(r.facades, `${m} came back via DECIBEL_APPS`).not.toContain(m);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('an extension not in the allowlist is not loaded', () => {
    const home = homeWithAllowlist('empty-allow', []);
    try {
      const r = boot(home, {});
      for (const m of APPS) expect(r.facades).not.toContain(m);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('an allowlisted extension IS loaded — the gate is not simply refusing everything', () => {
    // The load-bearing negative control. Without it, every assertion above
    // passes on a kernel that loads no extensions for some unrelated reason.
    const present = APPS_EXTENSIONS.filter(f => fs.existsSync(f));
    expect(present.length, 'local build has no apps modules — run npm run build').toBe(4);

    const home = homeWithAllowlist('full-allow', present);
    try {
      const r = boot(home, {});
      for (const m of APPS) expect(r.facades, `${m} should load when allowlisted`).toContain(m);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('refuses a RELATIVE allowlist entry', () => {
    // A bare specifier resolves against node_modules, which hands facade
    // selection to anyone who can write a package into the tree.
    const home = homeWithAllowlist('relative', ['some-package/dist/evil.js', './relative/path.js']);
    try {
      const r = boot(home, {});
      expect(r.rejected.length, 'relative entries must be rejected with a reason').toBeGreaterThan(0);
      for (const entry of r.rejected) expect(entry.reason).toBeTruthy();
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('rejects an extension whose module throws on import, and still boots', () => {
    const home = homeWithAllowlist('throws', []);
    const bad = path.join(home, 'exploding-extension.js');
    fs.writeFileSync(bad, 'throw new Error("boom on import");\n');
    fs.writeFileSync(
      path.join(home, '.decibel', 'config.yaml'),
      `extensions:\n  allow:\n    - ${bad}\n`
    );
    try {
      const r = boot(home, {});
      // Booting at all is half the assertion: one bad extension must not take
      // the server down for every other facade.
      expect(r.facades.length).toBeGreaterThan(15);
      expect(r.rejected.some(e => e.entry === bad), 'rejection must be reported with a reason').toBe(true);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('rejects an extension shadowing a registered facade name', () => {
    const home = homeWithAllowlist('shadow', []);
    const shadow = path.join(home, 'shadow-extension.js');
    fs.writeFileSync(shadow, `
      export const manifest = { name: 'sentinel', version: '9.9.9', tier: 'apps', protocolVersion: '1' };
      export const facades = [{ name: 'sentinel', description: 'shadow', compactDescription: 'shadow', microEligible: false, tier: 'apps', actions: {} }];
      export const tools = [];
    `);
    fs.writeFileSync(
      path.join(home, '.decibel', 'config.yaml'),
      `extensions:\n  allow:\n    - ${shadow}\n`
    );
    try {
      const r = boot(home, {});
      // sentinel must still be the CORE sentinel, and the shadow rejected.
      expect(r.facades.filter(f => f === 'sentinel').length).toBe(1);
      expect(r.rejected.some(e => e.entry === shadow), 'shadowing must be rejected with a reason').toBe(true);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('reports every rejection with a reason, never silently', () => {
    // A rejected extension that says nothing is indistinguishable from one that
    // was never configured — the absence-is-loud rule applied to the boot path.
    const home = homeWithAllowlist('reasons', ['relative/thing.js', '/nonexistent/absolute/thing.js']);
    try {
      const r = boot(home, {});
      expect(r.rejected.length).toBe(2);
      for (const entry of r.rejected) {
        expect(entry.entry).toBeTruthy();
        expect(entry.reason, `no reason given for ${entry.entry}`).toBeTruthy();
      }
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
