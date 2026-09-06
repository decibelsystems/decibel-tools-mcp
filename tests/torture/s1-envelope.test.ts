// ============================================================================
// S1 — Envelope conformance (every action)
// ============================================================================
// Calls every action with minimally valid params. SUCCESS IS NOT ASSERTED —
// many actions legitimately fail on missing required arguments, and several
// legitimately fail because the sandbox has no credentials. What is asserted is
// that the answer is LEGIBLE:
//
//   - content[0] parses as JSON, always, including on the failure path
//   - the failure marker is present iff the call failed
//   - no response is only human-readable text
//   - structural misses carry a machine-readable payload
//
// Gate for 3.0: HARD — 100% of actions.
// ============================================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createKernel } from '../../src/kernel.js';
import {
  buildSurface,
  loadWaivers,
  isWaived,
  makeSandbox,
  scrubbedEnv,
  runSweep,
  type CallOutcome,
  type Surface,
  type SandboxPaths,
} from './harness.js';

let sandbox: SandboxPaths;
let surface: Surface;
let results: CallOutcome[];
let byId: Map<string, CallOutcome>;

beforeAll(async () => {
  surface = buildSurface(await createKernel());
  sandbox = makeSandbox('s1');
  results = runSweep('S1', scrubbedEnv(sandbox.home), { timeoutMs: 15_000 });
  byId = new Map(results.map(r => [r.id, r]));
}, 900_000);

afterAll(() => sandbox?.cleanup());

describe('S1 — envelope conformance', () => {
  it('reaches every action in the surface', () => {
    // THE HARNESS'S OWN GUARD, and it has already earned its place: the first
    // run of this sweep covered 183 of 273 actions and reported a clean pass,
    // because the child process was launched without the capability flags and
    // silently built a smaller kernel. A sweep that cannot reach a tool and
    // says nothing is precisely the failure this suite exists to catch, so
    // coverage is asserted before any result is believed.
    const waivers = loadWaivers();
    const expected = surface.actions
      .filter(a => !isWaived(waivers, a.id, 'S1'))
      .map(a => a.id);

    const missing = expected.filter(id => !byId.has(id));

    expect(
      missing,
      `sweep did not reach ${missing.length}/${expected.length} actions — ` +
      `the sweep is under-covering, which invalidates every other assertion here`
    ).toEqual([]);
  });

  it('answers every call — nothing hangs and nothing rejects', () => {
    // dispatch() is documented never to reject and the kernel wraps each tool
    // in a circuit breaker, so an unanswered call is either a hang or a broken
    // promise contract. Both are release blockers.
    const unanswered = results.filter(r => !r.answered);
    expect(
      unanswered.map(r => `${r.id}: ${r.failure}`),
      'calls that never produced a legible answer'
    ).toEqual([]);
  });

  it('returns JSON in content[0] for every action, including failures', () => {
    // The bug this generalises: the feedback prompt was concatenated onto the
    // JSON string, so one call in fifteen was unparseable. Agents tolerated the
    // trailing prose; HTTP /call silently stuffed the whole payload into a
    // `message` string with no data keys, and HQ spent two diagnostic rounds on
    // wrong causes. toolResponseShape.test.ts asserts this for two helpers —
    // S1 makes it universal.
    const unparseable = results
      .filter(r => r.answered && !r.parsed)
      .map(r => `${r.id}: ${JSON.stringify(r.sample.slice(0, 120))}`);

    expect(unparseable, 'content[0] must be JSON on every path').toEqual([]);
  });

  it('never answers with prose alone', () => {
    const proseOnly = results
      .filter(r => r.answered && r.blocks > 0 && !r.parsed)
      .map(r => r.id);
    expect(proseOnly).toEqual([]);
  });

  it('marks failure iff the call failed — no error text smuggled into a success', () => {
    // A payload carrying an `error` field while isError is false is the shape
    // that reads as success to every programmatic consumer and as failure to a
    // human. It is the /batch family's exact failure mode.
    const smuggled = results
      .filter(r => r.answered && r.parsed && !r.isError && r.errorField)
      .map(r => `${r.id}: error=${JSON.stringify(r.errorField)} but isError=false`);

    expect(smuggled, 'error payload returned without the failure marker').toEqual([]);
  });

  it('gives structural misses a machine-readable payload and no result', () => {
    // Unknown facade, unknown action, and missing action are all caller errors
    // detected BEFORE dispatch. They must be distinguishable from a tool that
    // ran and failed.
    for (const id of ['__structural.unknown_facade', '__structural.unknown_action', '__structural.missing_action']) {
      const r = byId.get(id);
      expect(r, `${id} was not exercised`).toBeDefined();
      expect(r!.answered, `${id} did not answer`).toBe(true);
      expect(r!.parsed, `${id} returned unparseable content: ${r!.sample}`).toBe(true);
      expect(r!.isError, `${id} must carry the failure marker`).toBe(true);
      expect(r!.keys, `${id} must not carry a result key`).not.toContain('result');
      expect(
        (r!.keys ?? []).some(k => k === 'error' || k === 'code'),
        `${id} must carry a machine-readable error/code, got keys ${JSON.stringify(r!.keys)}`
      ).toBe(true);
    }
  });

  it('reports the shape of what it found', () => {
    const failed = results.filter(r => r.isError).length;
    const slow = results.filter(r => r.ms > 2000).map(r => `${r.id} (${r.ms}ms)`);
    console.log(
      `S1: ${results.length} calls, ${failed} returned the failure marker ` +
      `(expected — most actions were called without their required arguments).` +
      (slow.length ? `\n     slow calls: ${slow.join(', ')}` : '')
    );
    expect(results.length).toBeGreaterThan(200);
  });
});
