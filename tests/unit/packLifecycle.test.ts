// ============================================================================
// The pack lifecycle must leave the working dist/ as it found it
// ============================================================================
// `prepack` runs `build:dist`, which is `rm -rf dist && tsc -p
// tsconfig.build.json` — the PUBLISH build, which deliberately excludes the
// four apps modules. But `dist/` is not only the thing that gets packed. It is
// also what every local client reads: Claude Desktop spawns `dist/server.js`
// directly, the daemon runs from it, and the extension allowlist in
// ~/.decibel/config.yaml names `dist/tools/*.js` by absolute path.
//
// So packing in the repo root silently downgrades every local client by four
// facades, and says so only in four stderr lines that nobody reads. It happened
// on 2026-09-06: `npm pack --dry-run`, run merely to INSPECT the tarball,
// broke Claude Desktop's tools.
//
// `postpack` restoring the dev build is what closes that. These assertions
// exist because the hook is invisible when it works, which is exactly the kind
// of thing that gets deleted during a cleanup.
//
// S7 already avoids this hazard a different way — it packs from a copy of the
// repo — so the full test suite is safe. The exposed path is a human, or an
// agent, packing or publishing in place.
// ============================================================================

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf-8')) as {
  scripts: Record<string, string>;
};

/** Expand `npm run x` chains so an assertion sees the commands that actually run. */
function resolveScript(name: string, seen = new Set<string>()): string {
  if (seen.has(name)) return '';
  seen.add(name);
  const body = pkg.scripts[name] ?? '';
  return body.replace(/npm run ([\w:]+)/g, (_m, ref: string) => resolveScript(ref, seen));
}

describe('pack lifecycle — packing must not break the local install', () => {
  it('prepack destroys dist, which is why a restore is needed', () => {
    // Not a complaint about prepack: rebuilding from the publish config is
    // correct, and removing the stale tree first is what keeps the apps modules
    // out of the tarball. This assertion pins the PREMISE of the test below, so
    // that if prepack ever stops clobbering, the reason for postpack is gone
    // and someone is told rather than left guessing.
    expect(resolveScript('prepack')).toMatch(/rm -rf dist/);
  });

  it('postpack restores the development build', () => {
    expect(
      pkg.scripts.postpack,
      'prepack replaces dist/ with the publish build; without postpack, packing ' +
        'leaves every local client (Claude Desktop, the daemon, Claude Code) ' +
        'missing the apps facades'
    ).toBeDefined();
    expect(resolveScript('postpack')).toMatch(/tsc/);
  });

  it('the restore uses the DEV config, not the publish one', () => {
    // The whole point. Restoring with tsconfig.build.json would rebuild exactly
    // what prepack already produced and fix nothing, while looking like a fix.
    const restore = resolveScript('postpack');
    expect(restore, 'postpack must not restore with the publish tsconfig').not.toMatch(
      /tsconfig\.build\.json/
    );
  });

  it('the two builds genuinely differ — the publish config excludes the apps modules', () => {
    // If this ever fails, the two builds have converged and the hazard is gone:
    // delete postpack rather than keeping a hook nobody can explain.
    const buildConfig = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, 'tsconfig.build.json'), 'utf-8').replace(/^\s*\/\/.*$/gm, '')
    ) as { exclude?: string[] };

    const excluded = buildConfig.exclude ?? [];
    for (const mod of ['senken', 'deck', 'mother', 'terminal']) {
      expect(
        excluded.some(e => e.includes(mod)),
        `tsconfig.build.json no longer excludes ${mod} — either it leaks into the ` +
          `public package now, or the exclusion moved and this test is stale`
      ).toBe(true);
    }
  });
});
