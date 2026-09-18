// Guards the core/pro/private boundary — both the tier declarations and the
// packaging rule that depends on them.
//
// The bug that motivated this: `decibel` and `conductor` were declared
// tier:'core' but lived in the appFacades array, and the kernel loads that
// array only when DECIBEL_APPS=1. So two core facades were unreachable for
// every public user — including `decibel`, whose entire purpose is public
// discovery of what Decibel builds. Array membership and tier had drifted apart
// with nothing checking they agreed.
//
// EPIC-0038 Phase 7 removed the appFacades array entirely: private facades now
// declare themselves inside the excluded module, as a DecibelExtension. The
// checks below moved with them and are read from source text rather than by
// importing, because importing src/tools/senken.ts pulls in a Postgres driver
// to assert a packaging fact.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  coreFacades,
  proFacades,
  allFacadeDefinitions,
} from '../../src/facades/definitions.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const buildConfig = readFileSync(path.join(REPO_ROOT, 'tsconfig.build.json'), 'utf-8');

/** The private modules, taken from the one place that decides what ships. */
const PRIVATE_MODULES = [...buildConfig.matchAll(/"(src\/tools\/[^"]+)"/g)].map(m => m[1]);

describe('facade tier declarations', () => {
  it.each([
    ['core', coreFacades, 'core'],
    ['pro', proFacades, 'pro'],
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
  it('has at least one private module, so the checks below are not vacuous', () => {
    expect(PRIVATE_MODULES.length).toBeGreaterThan(0);
  });

  // The whole point of Phase 7. A facade spec in definitions.ts ships to npm
  // even when its implementation does not — which is how a public install came
  // to carry a paragraph describing a live trading Postgres and a tool that
  // spends from a wallet. If an apps-tier spec reappears here, it leaked.
  it('declares no apps-tier facade in the public definitions file', () => {
    const definitions = readFileSync(path.join(REPO_ROOT, 'src/facades/definitions.ts'), 'utf-8');
    const specs = [...definitions.matchAll(/^\s*tier: '(\w+)',/gm)].map(m => m[1]);
    expect(specs.filter(t => t !== 'core' && t !== 'pro')).toEqual([]);
  });

  it.each(PRIVATE_MODULES)('%s carries its own extension manifest', (modulePath) => {
    const source = readFileSync(path.join(REPO_ROOT, modulePath), 'utf-8');
    expect(source).toContain('export const extension: DecibelExtension');
    // A private module that declared itself core or pro would be asking to be
    // registered by a build that does not contain it.
    expect(source).toMatch(/tier: 'apps'/);
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
