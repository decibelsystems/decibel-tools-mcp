// ============================================================================
// Which facades can reach the network — declared here, checked against source
// ============================================================================
// WHY THIS EXISTS. "Your project data stays on your machine" is a claim the
// product makes, and until now it was a claim nobody could check. It was
// established by grepping src/tools/<facade>.ts by hand, which is wrong twice:
// it goes stale the moment a facade gains an import, and it cannot see reach
// that arrives through a helper. A facade whose own file mentions no client at
// all still reaches a hosted Supabase if something it imports does.
//
// So the walk below is TRANSITIVE. It starts at each facade's entry module and
// follows every relative import inside src/, and a hit anywhere in that closure
// counts. agentic reaches 115 modules; its network reach comes entirely from
// three of them, none of which is agentic's own file.
//
// WHY IT IS NOT "core facades never touch the network". That test was the
// obvious one to write and it fails on main: four CORE facades reach out —
// designer, swarm, guardian and peers. Tier is a licensing boundary, not a
// network boundary, and asserting otherwise would either fail forever or force
// a false allowlist. What IS checkable, and what the claim actually needs, is
// that the set cannot change without someone saying so here.
//
// TO CHANGE THIS FILE: adding a facade to NETWORK_REACH is a decision about the
// product's central promise, not a test fix. Say what it talks to and why.
// ============================================================================

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { allFacadeDefinitions } from '../../src/facades/definitions.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = path.join(REPO_ROOT, 'src');

/**
 * Every facade that can reach off the machine, and what it talks to.
 *
 * A facade absent from this map must be unable to reach the network through
 * anything it imports, however deep. That is the property the data-ownership
 * claim rests on.
 */
const NETWORK_REACH: Record<string, string> = {
  // --- core tier -----------------------------------------------------------
  designer: 'Fetches design references and runs visual evals against a remote model.',
  swarm: 'Hosted Supabase — the shared agent roster is the point of the facade.',
  guardian: 'scan_headers makes a live HTTP request to the audited origin (ISS-0161).',
  peers: 'localhost:7899 only — the local peer bus, which never leaves the machine.',

  // --- pro tier ------------------------------------------------------------
  voice: 'Hosted Supabase — the voice inbox is filled from an iOS client.',
  agentic: 'Inherits reach from peers, swarm and guardian; the queue itself is Supabase.',
  studio: 'Together and Kling generation APIs, plus hosted Supabase.',
  postoffice: 'AgentHQ over remote MCP — agent-to-agent messaging (EPIC-0037).',
  zoom: 'Zoom API — meeting summaries are pulled from it (EPIC-0036).',

  // --- apps tier (private; excluded from the published package) -------------
  senken: 'Postgres via pg — live trade data.',
  deck: 'Hosted Supabase — card and price data.',
  mother: 'Postgres via pg — the trading system.',
  terminal: 'HTTP to the terminal host.',
};

/** Import specifiers and call shapes that mean "this module can leave the box". */
const NETWORK_MARKERS: Array<[RegExp, string]> = [
  [/@supabase\/supabase-js/, 'supabase-js'],
  [/from\s+['"]pg['"]/, 'pg'],
  [/node-fetch|['"]axios['"]|['"]undici['"]/, 'http client package'],
  [/from\s+['"](node:)?(http|https)['"]/, 'node http'],
  [/(^|[^.\w])fetch\s*\(/m, 'fetch()'],
];

/** src-relative entry module for a facade, or null when it has no own module. */
function entryFor(facade: string): string | null {
  return [
    path.join(SRC, 'tools', `${facade}.ts`),
    path.join(SRC, 'tools', facade, 'index.ts'),
  ].find(existsSync) ?? null;
}

/** Resolve a relative import to a .ts file inside src/, or null if it leaves. */
function resolveLocal(spec: string, fromFile: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), spec.replace(/\.js$/, ''));
  return [`${base}.ts`, path.join(base, 'index.ts')].find(existsSync) ?? null;
}

/** Every network marker reachable from an entry module, with where it came from. */
function reachFrom(entry: string): Array<{ file: string; marker: string }> {
  const seen = new Set<string>();
  const found: Array<{ file: string; marker: string }> = [];
  const stack = [entry];

  while (stack.length) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);

    const src = readFileSync(file, 'utf-8');
    for (const [re, marker] of NETWORK_MARKERS) {
      if (re.test(src)) found.push({ file: path.relative(SRC, file), marker });
    }
    // Every way a module can pull in another. The first version of this matched
    // only `from '...'`, which silently skipped side-effect imports — and a
    // side-effect import is precisely how a module acquires a client without
    // naming one. It made the whole sweep a false green; proven by injecting
    // `import '../lib/supabase.js'` into a clean facade and watching it pass.
    const SPECIFIERS = [
      /\bfrom\s+['"]([^'"]+)['"]/g,       // import x from 'y' / export * from 'y'
      /\bimport\s+['"]([^'"]+)['"]/g,     // import 'y'  (side effect)
      /\bimport\s*\(\s*['"]([^'"]+)['"]/g, // await import('y')
      /\brequire\s*\(\s*['"]([^'"]+)['"]/g,
    ];
    for (const re of SPECIFIERS) {
      for (const m of src.matchAll(re)) {
        const next = resolveLocal(m[1], file);
        if (next) stack.push(next);
      }
    }
  }
  return found;
}

const facades = allFacadeDefinitions
  .map(f => ({ name: f.name, tier: f.tier, entry: entryFor(f.name) }))
  .filter((f): f is { name: string; tier: string; entry: string } => f.entry !== null);

describe('facade network reach', () => {
  it('finds an entry module for every declared facade', () => {
    const missing = allFacadeDefinitions
      .map(f => f.name)
      .filter(n => entryFor(n) === null);
    // A facade with no module of its own cannot be audited, so it must not
    // exist silently — either it is composed elsewhere, or the map is stale.
    expect(missing).toEqual([]);
  });

  it.each(facades.filter(f => !(f.name in NETWORK_REACH)))(
    '$name ($tier) reaches nothing off the machine',
    ({ entry }) => {
      const hits = reachFrom(entry);
      // If this fails, a facade gained network reach through an import —
      // possibly one it does not name itself. Declare it in NETWORK_REACH with
      // a reason, or remove the dependency.
      expect(hits.map(h => `${h.file} (${h.marker})`)).toEqual([]);
    }
  );

  it.each(facades.filter(f => f.name in NETWORK_REACH))(
    '$name ($tier) still reaches the network it declares',
    ({ entry, name }) => {
      const hits = reachFrom(entry);
      // A stale entry is as misleading as a missing one: it makes the audited
      // surface look larger than it is, and hides the day a facade went local.
      expect(hits.length, `${name} declares network reach but imports none`).toBeGreaterThan(0);
    }
  );

  it('states the reach of every core facade, in or out', () => {
    // The core tier is what a public, unlicensed install runs. Its reach is the
    // number the data-ownership claim is really about, so it gets named rather
    // than inferred: four of these talk to something, the rest do not.
    const core = facades.filter(f => f.tier === 'core');
    const reaching = core.filter(f => f.name in NETWORK_REACH).map(f => f.name).sort();

    expect(reaching).toEqual(['designer', 'guardian', 'peers', 'swarm']);
    expect(core.length).toBeGreaterThan(15);
  });
});
