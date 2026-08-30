// Guards the core/pro/apps boundary — both the tier declarations and the
// packaging rule that depends on them.
//
// The bug that motivated this: `decibel` and `conductor` were declared
// tier:'core' but lived in the appFacades array, and the kernel loads that
// array only when DECIBEL_APPS=1. So two core facades were unreachable for
// every public user — including `decibel`, whose entire purpose is public
// discovery of what Decibel builds. Array membership and tier had drifted apart
// with nothing checking they agreed.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  coreFacades,
  proFacades,
  appFacades,
  allFacadeDefinitions,
} from '../../src/facades/definitions.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('facade tier declarations', () => {
  it.each([
    ['core', coreFacades, 'core'],
    ['pro', proFacades, 'pro'],
    ['apps', appFacades, 'apps'],
  ])('every facade in %s declares tier %s', (_label, facades, tier) => {
    const wrong = facades.filter((f) => f.tier !== tier).map((f) => `${f.name}(${f.tier})`);
    expect(wrong).toEqual([]);
  });

  it('has no facade in more than one tier array', () => {
    const names = allFacadeDefinitions.map((f) => f.name);
    expect(names.length).toBe(new Set(names).size);
  });

  it('keeps the public discovery facade in core, where a public user can reach it', () => {
    expect(coreFacades.map((f) => f.name)).toContain('decibel');
  });
});

describe('published package excludes private facades', () => {
  const buildConfig = readFileSync(path.join(REPO_ROOT, 'tsconfig.build.json'), 'utf-8');

  // The rule that keeps the packaging honest as the private set changes. Add a
  // fifth apps facade without excluding its module and this fails, rather than
  // the leak being discovered in a published tarball.
  it('excludes the module backing every apps-tier facade', () => {
    const missing = appFacades
      .map((f) => `src/tools/${f.name}.ts`)
      .filter((modulePath) => !buildConfig.includes(modulePath));
    expect(missing).toEqual([]);
  });

  it('excludes nothing that is not an apps facade', () => {
    const excluded = [...buildConfig.matchAll(/"(src\/tools\/[^"]+)"/g)].map((m) => m[1]);
    const allowed = new Set(appFacades.map((f) => `src/tools/${f.name}.ts`));
    expect(excluded.filter((e) => !allowed.has(e))).toEqual([]);
  });

  // pg exists in this repo only for senken and mother. With those excluded from
  // the build, a public install was downloading a Postgres driver it could not
  // reach — so it belongs in devDependencies, where the owner's checkout still
  // gets it. If a private facade ever comes back into the public build this
  // will need revisiting, which is why it is asserted next to the exclusion.
  it('keeps pg out of the public dependency set, since only private facades use it', () => {
    const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf-8'));
    expect(Object.keys(pkg.dependencies)).not.toContain('pg');
    expect(Object.keys(pkg.devDependencies)).toContain('pg');
  });

  // prepack is what makes this automatic. Without it, `npm publish` would use
  // whatever happened to be in dist/ — which for the owner is the full build.
  it('wires the restricted build into prepack so publishing cannot use the full build', () => {
    const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf-8'));
    expect(pkg.scripts.prepack).toContain('build:dist');
    expect(pkg.scripts['build:dist']).toContain('tsconfig.build.json');
    // A stale dist/ from a full build would otherwise survive into the tarball.
    expect(pkg.scripts['build:dist']).toContain('rm -rf dist');
  });
});
