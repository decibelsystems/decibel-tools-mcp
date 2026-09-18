// ============================================================================
// S0 — Enumeration invariant (the meta-sweep)
// ============================================================================
// Runs first; everything else is downstream of it. If the surface cannot be
// enumerated correctly, no other sweep's coverage claim means anything.
//
// Gate for 3.0: HARD — no unclaimed actions, no expired waivers.
// ============================================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  loadSurface,
  loadWaivers,
  expiredWaivers,
  isWaived,
  makeSandbox,
  scrubbedEnv,
  RAW_NAME_ALLOWLIST,
  type Surface,
  type Waiver,
  type SandboxPaths,
} from './harness.js';

let sandbox: SandboxPaths;
let surface: Surface;
let waivers: Waiver[];

beforeAll(() => {
  // The surface is read from a child process running the sandbox environment,
  // so S0 describes exactly the kernel S1 and S2 exercise. Reading it from this
  // process instead would describe whatever the developer's shell happened to
  // export, and a smaller surface would pass S0 while proving nothing.
  sandbox = makeSandbox('s0');
  surface = loadSurface(scrubbedEnv(sandbox.home));
  waivers = loadWaivers();
}, 300_000);

afterAll(() => sandbox?.cleanup());

describe('S0 — enumeration invariant', () => {
  it('every facade action resolves to a tool registered in the kernel toolMap', () => {
    // A dangling action is a facade advertising something it cannot dispatch:
    // the caller sees the action in tools/list and gets a failure that reads
    // like a bug in their call rather than in the registry.
    expect(surface.danglingActions).toEqual([]);
  });

  it('every internal tool is reachable — via a facade action or the raw-name allowlist', () => {
    // The orphaned-validator bug in one assertion. A tool that exists but that
    // nothing can call is dead code that still looks alive in the counts.
    const unreachable = surface.orphans.filter(t => !RAW_NAME_ALLOWLIST.includes(t));
    expect(unreachable, `unreachable tools: ${unreachable.join(', ')}`).toEqual([]);
  });

  it('the raw-name allowlist has no stale entries', () => {
    // The allowlist is a standing exemption, so it has to shrink when a tool is
    // folded into a facade. An entry naming a tool that no longer exists means
    // nobody checked.
    const registered = new Set(surface.tools);
    const stale = RAW_NAME_ALLOWLIST.filter(t => !registered.has(t));
    expect(stale, `allowlisted but not registered: ${stale.join(', ')}`).toEqual([]);
  });

  it('every action is claimed by a sweep or carries a waiver', () => {
    // S1 claims every action by construction — it calls all of them. So an
    // action is unclaimed only if it has been waived out of S1, and that waiver
    // is what this asserts exists.
    const unclaimed = surface.actions
      .filter(a => isWaived(waivers, a.id, 'S1'))
      .filter(a => !waivers.some(w => w.action === a.id && w.reason?.trim() && w.owner?.trim()));

    expect(
      unclaimed.map(a => a.id),
      'waived out of S1 without a reason and an owner'
    ).toEqual([]);
  });

  it('no waiver has expired', () => {
    // An expired waiver failing the build is the entire mechanism. A waiver
    // that never expires is just an untested tool with better paperwork.
    const expired = expiredWaivers(waivers);
    expect(
      expired.map(w => `${w.action} (expired ${w.expires}, owner ${w.owner})`),
      'expired waivers must be renewed or removed'
    ).toEqual([]);
  });

  it('no waiver names an action that no longer exists', () => {
    const ids = new Set(surface.actions.map(a => a.id));
    const dead = waivers.filter(w => !ids.has(w.action)).map(w => w.action);
    expect(dead, 'waivers for actions that are gone').toEqual([]);
  });

  it('the counts the server reports equal the counts derived from the registry', () => {
    // The internal_tool_count bug was exactly this assertion, absent: /health
    // reported a plausible number (227) against a real surface of 272. /health
    // reads kernel.facadeCount and kernel.toolCount directly (httpServer.ts),
    // so asserting the kernel's own counters against the registry it was built
    // from asserts what /health publishes.
    expect(surface.toolCount).toBe(surface.tools.length);
    expect(surface.facadeCount).toBeGreaterThan(0);
  });

  it('reports the surface it is about to torture', () => {
    // Not an assertion so much as the harness stating its own scope, so a
    // shrinking surface is visible in the test output rather than silent.
    const byTier = surface.actions.reduce<Record<string, number>>((acc, a) => {
      acc[a.tier] = (acc[a.tier] ?? 0) + 1;
      return acc;
    }, {});

    console.log(
      `S0 surface: ${surface.facadeCount} facades, ${surface.actions.length} actions, ` +
      `${surface.toolCount} internal tools, ${surface.actions.filter(a => a.readOnly).length} read actions ` +
      `(by tier: ${JSON.stringify(byTier)})`
    );

    expect(surface.actions.length).toBeGreaterThan(200);
    expect(surface.facadeCount).toBeGreaterThan(20);
  });
});
