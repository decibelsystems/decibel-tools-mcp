// Extension loader — EPIC-0038 Phase 7.
//
// These tests are mostly about what the loader REFUSES. The allowlist is the
// only thing standing between "the owner named this file" and "anything that
// can write into node_modules chooses what runs in-process with the runtime's
// database credentials", so every way of getting past it is a test here.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import {
  checkAllowlistEntry,
  readAllowlist,
  loadExtensions,
} from '../../src/runtime/extensions.js';
import { RUNTIME_PROTOCOL_VERSION } from '../../src/runtime/protocol.js';

let home: string;
let originalHome: string | undefined;

/** Write ~/.decibel/config.yaml inside the fake home. */
function writeConfig(body: string): void {
  mkdirSync(path.join(home, '.decibel'), { recursive: true });
  writeFileSync(path.join(home, '.decibel', 'config.yaml'), body, 'utf-8');
}

/**
 * Write an extension module and return its absolute path. Plain .mjs so the
 * loader's dynamic import works without a build step.
 */
function writeExtension(name: string, source: string): string {
  const file = path.join(home, `${name}.mjs`);
  writeFileSync(file, source, 'utf-8');
  return file;
}

function validExtensionSource(name: string, opts: { tier?: string; protocolVersion?: string } = {}): string {
  const tier = opts.tier ?? 'apps';
  const protocolVersion = opts.protocolVersion ?? RUNTIME_PROTOCOL_VERSION;
  return `
export const extension = {
  manifest: { name: '${name}', version: '1.2.3', protocolVersion: '${protocolVersion}', tier: '${tier}' },
  facades: [{
    name: '${name}',
    description: 'test facade',
    compactDescription: 'test',
    microEligible: false,
    tier: '${tier}',
    actions: { ping: '${name}_ping' },
  }],
  tools: [{
    definition: { name: '${name}_ping', description: 'ping', inputSchema: { type: 'object', properties: {} } },
    handler: async () => ({ content: [{ type: 'text', text: 'pong' }] }),
  }],
};
`;
}

beforeEach(() => {
  originalHome = process.env.HOME;
  home = mkdtempSync(path.join(tmpdir(), 'decibel-ext-'));
  process.env.HOME = home;
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(home, { recursive: true, force: true });
});

describe('allowlist entry rules', () => {
  it('accepts an absolute normalized path', () => {
    expect(checkAllowlistEntry('/opt/decibel/senken.mjs')).toEqual({
      ok: true,
      path: '/opt/decibel/senken.mjs',
    });
  });

  // The one that matters. Node would resolve a bare specifier against
  // node_modules, so accepting it would mean the allowlist names a package
  // rather than a file — and whoever can install a package picks the code.
  it.each(['senken', '@decibel/senken', './senken.mjs', '../senken.mjs'])(
    'refuses the non-absolute entry %s',
    (entry) => {
      const result = checkAllowlistEntry(entry);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain('absolute');
    }
  );

  it('refuses an entry that traverses out of the path it appears to name', () => {
    const result = checkAllowlistEntry('/opt/decibel/../../usr/bin/evil.mjs');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('not normalized');
  });

  it('refuses an empty entry', () => {
    expect(checkAllowlistEntry('   ').ok).toBe(false);
  });
});

describe('readAllowlist', () => {
  it('is empty when no config file exists', () => {
    expect(readAllowlist()).toEqual([]);
  });

  it('is empty when the config has no extensions block', () => {
    writeConfig('daemon:\n  port: 4888\n');
    expect(readAllowlist()).toEqual([]);
  });

  it('reads the allow list', () => {
    writeConfig('extensions:\n  allow:\n    - /a/b.mjs\n    - /c/d.mjs\n');
    expect(readAllowlist()).toEqual(['/a/b.mjs', '/c/d.mjs']);
  });

  // The allowlist is config-only on purpose: an env var can be set by a plist,
  // a shell profile or a parent process, none of which are the owner deciding.
  it('ignores DECIBEL_EXTENSIONS in the environment', () => {
    process.env.DECIBEL_EXTENSIONS = '/tmp/evil.mjs';
    try {
      expect(readAllowlist()).toEqual([]);
    } finally {
      delete process.env.DECIBEL_EXTENSIONS;
    }
  });
});

describe('loadExtensions', () => {
  it('loads nothing when the allowlist is empty', async () => {
    const result = await loadExtensions();
    expect(result.extensions).toEqual([]);
    expect(result.rejected).toEqual([]);
  });

  it('loads a valid extension with its facades and tools', async () => {
    const file = writeExtension('senken', validExtensionSource('senken'));
    writeConfig(`extensions:\n  allow:\n    - ${file}\n`);

    const result = await loadExtensions();
    expect(result.rejected).toEqual([]);
    expect(result.extensions).toHaveLength(1);
    expect(result.extensions[0].manifest).toMatchObject({ name: 'senken', version: '1.2.3', tier: 'apps' });
    expect(result.facades.map(f => f.name)).toEqual(['senken']);
    expect(result.tools.map(t => t.definition.name)).toEqual(['senken_ping']);
  });

  it('reports a missing file rather than throwing', async () => {
    writeConfig(`extensions:\n  allow:\n    - ${path.join(home, 'nope.mjs')}\n`);
    const result = await loadExtensions();
    expect(result.extensions).toEqual([]);
    expect(result.rejected[0].reason).toContain('does not exist');
  });

  it('rejects a module that exports no extension', async () => {
    const file = writeExtension('empty', 'export const notAnExtension = 1;\n');
    writeConfig(`extensions:\n  allow:\n    - ${file}\n`);
    const result = await loadExtensions();
    expect(result.rejected[0].reason).toContain('does not export');
  });

  it('rejects an extension claiming core tier', async () => {
    const file = writeExtension('fake', validExtensionSource('fake', { tier: 'core' }));
    writeConfig(`extensions:\n  allow:\n    - ${file}\n`);
    const result = await loadExtensions();
    expect(result.rejected[0].reason).toContain('tier');
  });

  it('rejects an extension built against an incompatible protocol major', async () => {
    const file = writeExtension('stale', validExtensionSource('stale', { protocolVersion: '0.9' }));
    writeConfig(`extensions:\n  allow:\n    - ${file}\n`);
    const result = await loadExtensions();
    expect(result.rejected[0].reason).toContain('protocol mismatch');
  });

  // A private module silently replacing `sentinel` would be the worst possible
  // outcome of this feature.
  it('refuses to let an extension shadow an already-registered facade', async () => {
    const file = writeExtension('sentinel', validExtensionSource('sentinel'));
    writeConfig(`extensions:\n  allow:\n    - ${file}\n`);
    const result = await loadExtensions(new Set(['sentinel']));
    expect(result.extensions).toEqual([]);
    expect(result.rejected[0].reason).toContain('already registered');
  });

  it('refuses to let two extensions claim the same facade name', async () => {
    const first = writeExtension('dup-one', validExtensionSource('dup'));
    const second = writeExtension('dup-two', validExtensionSource('dup'));
    writeConfig(`extensions:\n  allow:\n    - ${first}\n    - ${second}\n`);
    const result = await loadExtensions();
    expect(result.extensions).toHaveLength(1);
    expect(result.rejected[0].reason).toContain('already registered');
  });

  // One broken private module must not stop the runtime booting core.
  it('loads the good extensions alongside a bad one', async () => {
    const good = writeExtension('good', validExtensionSource('good'));
    const bad = writeExtension('bad', 'throw new Error("boom");\n');
    writeConfig(`extensions:\n  allow:\n    - ${bad}\n    - ${good}\n`);

    const result = await loadExtensions();
    expect(result.extensions.map(e => e.manifest.name)).toEqual(['good']);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].reason).toContain('import failed');
  });

  it('rejects a facade whose tier disagrees with its manifest', async () => {
    const file = writeExtension('mismatch', `
export const extension = {
  manifest: { name: 'mismatch', version: '1.0.0', protocolVersion: '${RUNTIME_PROTOCOL_VERSION}', tier: 'apps' },
  facades: [{ name: 'mismatch', description: 'x', compactDescription: 'x', microEligible: false, tier: 'pro', actions: { ping: 'mismatch_ping' } }],
  tools: [{ definition: { name: 'mismatch_ping', description: 'p', inputSchema: { type: 'object', properties: {} } }, handler: async () => ({ content: [] }) }],
};
`);
    writeConfig(`extensions:\n  allow:\n    - ${file}\n`);
    const result = await loadExtensions();
    expect(result.rejected[0].reason).toContain('declares tier');
  });
});
