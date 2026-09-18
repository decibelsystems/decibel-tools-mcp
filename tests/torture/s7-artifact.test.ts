// ============================================================================
// S7 — The packed artifact, not the source
// ============================================================================
// Three releases shipped a hollow .mcpb bundle while every source test passed.
// Source tests cannot see tsconfig.build.json excludes, `files:` in
// package.json, a missing export map, or a dependency that was
// transitive-and-undeclared.
//
// This packs the real tarball through the real `prepack` path, installs it into
// a clean directory, and drives it with a scrubbed environment: no DECIBEL_*,
// no SUPABASE_*, HOME pointed at an empty dir.
//
// Gate for 3.0: HARD — the spec calls this "the one that has actually bitten us".
//
// It also guards a promise made to the public mirror: through 2.1.4 the
// published package carried compiled JS AND source maps for four private
// facades that no public user could enable. Both currently published versions
// still do. The exclusion landed 2026-08-29, nine days after the beta was
// published, so it has never actually shipped — which is precisely the gap
// between "true of the repo" and "true of the thing users install".
// ============================================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { REPO_ROOT, scrubbedEnv, makeSandbox, type SandboxPaths } from './harness.js';

/** The four private modules. Their absence from the tarball is the release gate. */
const PRIVATE_MODULES = ['senken', 'deck', 'mother', 'terminal'];

let workdir: string;
let installed: string;
let sandbox: SandboxPaths;
let tarballEntries: string[];
let packFailed: string | undefined;

beforeAll(() => {
  workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'torture-s7-'));
  // No extension allowlist: a public install has no config.yaml pointing at
  // private modules on a developer's disk.
  sandbox = makeSandbox('s7-home', { extensions: false });

  try {
    // Pack from a COPY of the repo, not the repo itself.
    //
    // `npm pack` runs prepack, which runs `rm -rf dist && tsc -p
    // tsconfig.build.json` — so packing in place replaces the working dist with
    // the PUBLIC build, deleting the four apps modules. The other torture
    // suites load those as extensions, and running the directory together made
    // their surface silently collapse from 273 actions to 233 mid-run. That is
    // the same class of silent under-coverage S1's coverage assertion exists to
    // catch, arriving this time from a test's own side effect.
    //
    // node_modules is symlinked rather than copied: it is the expensive part
    // and nothing in the pack path writes to it.
    const packRoot = path.join(workdir, 'repo');
    fs.mkdirSync(packRoot, { recursive: true });
    for (const entry of ['src', 'templates', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json', 'README.md', 'LICENSE']) {
      const from = path.join(REPO_ROOT, entry);
      if (fs.existsSync(from)) fs.cpSync(from, path.join(packRoot, entry), { recursive: true });
    }
    fs.symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(packRoot, 'node_modules'), 'dir');

    // The REAL publish path: prepack -> build:dist -> tsconfig.build.json.
    // Packing any other way would test a tarball nobody ships.
    execFileSync('npm', ['pack', '--pack-destination', workdir], {
      cwd: packRoot,
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 600_000,
    });

    const tgz = fs.readdirSync(workdir).find(f => f.endsWith('.tgz'))!;
    const tarball = path.join(workdir, tgz);

    tarballEntries = execFileSync('tar', ['tzf', tarball], { encoding: 'utf-8' })
      .split('\n')
      .filter(Boolean);

    installed = path.join(workdir, 'install');
    fs.mkdirSync(installed, { recursive: true });
    fs.writeFileSync(path.join(installed, 'package.json'), JSON.stringify({ name: 's7-probe', private: true }));
    execFileSync('npm', ['install', '--no-audit', '--no-fund', tarball], {
      cwd: installed,
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 900_000,
    });
  } catch (err) {
    packFailed = err instanceof Error ? err.message : String(err);
  }
}, 1_800_000);

afterAll(() => {
  sandbox?.cleanup();
  if (workdir) fs.rmSync(workdir, { recursive: true, force: true });
});

/** Drive the packed server over stdio with a scrubbed environment. */
function speakToPackedServer(requests: object[]): Record<string, unknown>[] {
  const entry = path.join(installed, 'node_modules', '@decibelsystems', 'tools', 'dist', 'server.js');
  const input = requests.map(r => JSON.stringify(r)).join('\n') + '\n';

  const proc = spawnSync('node', [entry], {
    input,
    encoding: 'utf-8',
    // A core install with no license and no network: the environment a public
    // user actually has.
    env: { PATH: process.env.PATH, HOME: sandbox.home, NODE_ENV: 'production' },
    timeout: 120_000,
    maxBuffer: 64 * 1024 * 1024,
  });

  return proc.stdout
    .split('\n')
    .filter(l => l.trim().startsWith('{'))
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter((v): v is Record<string, unknown> => v !== null);
}

/**
 * The leak predicate, extracted so the calibration below can exercise the exact
 * same function the gate uses. A calibration that re-implements the check
 * proves the copy works, not the gate.
 */
export function findLeaks(entries: string[]): string[] {
  return entries.filter(e =>
    PRIVATE_MODULES.some(m =>
      e.includes(`/tools/${m}.js`) ||
      e.includes(`/tools/${m}.d.ts`) ||
      e.includes(`/tools/${m}.js.map`) ||
      e.includes(`/tools/${m}.d.ts.map`)
    )
  );
}

describe('S7 calibration — the leak gate can see a leak', () => {
  // S7 passed on its first run, and the spec's standing instruction is to
  // distrust a green sweep until it has been shown to fail on a known-bad
  // input. These are the real entry lists from the two currently published
  // versions, both of which DO leak — verified against the published tarballs.
  it('FLAGS an entry list that carries the private modules', () => {
    const leaky = [
      'package/dist/server.js',
      'package/dist/tools/deck.js',
      'package/dist/tools/senken.js',
      'package/dist/tools/mother.js',
      'package/dist/tools/terminal.js',
      'package/dist/tools/deck.js.map',
    ];
    expect(findLeaks(leaky).sort()).toEqual([
      'package/dist/tools/deck.js',
      'package/dist/tools/deck.js.map',
      'package/dist/tools/mother.js',
      'package/dist/tools/senken.js',
      'package/dist/tools/terminal.js',
    ]);
  });

  it('CLEARS an entry list that does not — it is not flagging on the name alone', () => {
    // `deck.ts` appearing inside an unrelated path, and the facade names
    // appearing in a bundled definitions file, must not read as a leak.
    const clean = [
      'package/dist/server.js',
      'package/dist/facades/definitions.js',
      'package/dist/tools/sentinel/index.js',
      'package/templates/deck-notes.md',
    ];
    expect(findLeaks(clean)).toEqual([]);
  });
});

describe('S7 — the packed artifact', () => {
  it('packs and installs cleanly', () => {
    expect(packFailed, `npm pack/install failed: ${packFailed}`).toBeUndefined();
    expect(tarballEntries.length).toBeGreaterThan(100);
  });

  it('ships no private facade implementation', () => {
    // Phase 7's promise to the public mirror, as a release gate rather than an
    // intention. Source maps count: they carry recoverable source.
    const leaked = findLeaks(tarballEntries);
    expect(leaked, `private modules present in the tarball: ${leaked.join(', ')}`).toEqual([]);
  });

  it('ships no FacadeSpec describing a private facade', () => {
    // Excluding the implementation but shipping the description still tells a
    // public user about facades they cannot enable — the visible symptom that
    // made this a problem in the first place.
    const defs = path.join(installed, 'node_modules', '@decibelsystems', 'tools', 'dist', 'facades', 'definitions.js');
    expect(fs.existsSync(defs)).toBe(true);
    const body = fs.readFileSync(defs, 'utf-8');
    const described = PRIVATE_MODULES.filter(m => new RegExp(`name:\\s*['"]${m}['"]`).test(body));
    expect(described, `facade definitions still describe: ${described.join(', ')}`).toEqual([]);
  });

  it('declares every runtime dependency it actually imports', () => {
    // zod was transitive-and-undeclared until three commits before the spec.
    const ls = spawnSync('npm', ['ls', '--omit=dev', '--json'], {
      cwd: installed, encoding: 'utf-8', timeout: 300_000,
    });
    const tree = JSON.parse(ls.stdout || '{}') as { problems?: string[] };
    const problems = (tree.problems ?? []).filter(p => !p.includes('extraneous'));
    expect(problems, `npm ls reported: ${problems.join('; ')}`).toEqual([]);
  });

  it('boots from the packed entry point with an empty environment', () => {
    // dist/server.js, not dist/index.js — the plugin cache entry point.
    const replies = speakToPackedServer([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 's7', version: '1' } } },
    ]);
    const init = replies.find(r => r.id === 1);
    expect(init, 'packed server did not answer initialize').toBeDefined();
    expect(init).toHaveProperty('result');
  });

  it('serves core facades to an install with no license and no network', () => {
    const replies = speakToPackedServer([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 's7', version: '1' } } },
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    ]);

    const list = replies.find(r => r.id === 2) as { result?: { tools?: Array<{ name: string }> } } | undefined;
    const names = list?.result?.tools?.map(t => t.name) ?? [];

    expect(names.length, 'packed server served no tools').toBeGreaterThan(15);
    expect(names, 'sentinel is core and must be present in a bare install').toContain('sentinel');
  });

  it('does not offer a private facade to a public install', () => {
    const replies = speakToPackedServer([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 's7', version: '1' } } },
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    ]);
    const list = replies.find(r => r.id === 2) as { result?: { tools?: Array<{ name: string }> } } | undefined;
    const names = list?.result?.tools?.map(t => t.name) ?? [];

    for (const m of PRIVATE_MODULES) {
      expect(names, `${m} must not be offered to a public install`).not.toContain(m);
    }
  });

  it('answers legibly, in JSON, from the packed build', () => {
    // S1's core assertion, against the artifact rather than the source.
    const replies = speakToPackedServer([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 's7', version: '1' } } },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'sentinel', arguments: { action: 'list_issues' } } },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'no_such_facade', arguments: { action: 'x' } } },
    ]);

    for (const id of [2, 3]) {
      const reply = replies.find(r => r.id === id) as
        | { result?: { content?: Array<{ text?: string }> } }
        | undefined;
      expect(reply, `packed server did not answer call ${id}`).toBeDefined();
      const text = reply?.result?.content?.[0]?.text ?? '';
      expect(text, `call ${id} returned no content`).not.toBe('');
      expect(() => JSON.parse(text), `call ${id} returned non-JSON: ${text.slice(0, 160)}`).not.toThrow();
    }
  });
});
