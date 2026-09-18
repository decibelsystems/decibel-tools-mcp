// ============================================================================
// Harness calibration — verify non-circularly
// ============================================================================
// From the spec:
//
//   "Verify non-circularly: assert the harness can see a deliberately broken
//    tool before believing it about the healthy ones."
//
// This runs the real sweeps against four synthetic tools whose behaviour is
// known by construction — two broken in exactly the ways S1 and S2 hunt for,
// two correct. It has to catch the broken pair AND clear the correct pair.
//
// Catching everything is not evidence of a healthy harness; it is evidence of a
// broken one. That direction matters here specifically: S2's first real run
// flagged 135 of 135 read actions, and this file is what distinguishes "the
// codebase really is that uniform" from "the sweep flags anything it touches".
// ============================================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  makeS2Sandbox,
  makeSandbox,
  scrubbedEnv,
  runSweep,
  type CallOutcome,
  type SandboxPaths,
} from './harness.js';

const INJECT = { TORTURE_INJECT: '1' };

function sig(o: CallOutcome | undefined): string {
  if (!o) return 'ABSENT';
  if (!o.answered) return 'UNANSWERED';
  if (!o.parsed) return 'UNPARSEABLE';
  return JSON.stringify({ isError: o.isError, digest: o.digest });
}

describe('harness calibration — S1 can tell a broken envelope from a sound one', () => {
  let box: SandboxPaths;
  let byId: Map<string, CallOutcome>;

  beforeAll(() => {
    box = makeSandbox('selfcheck-s1');
    const results = runSweep('S1', scrubbedEnv(box.home, INJECT), {
      only: ['__probe.good_read', '__probe.bad_read', '__probe.unparseable', '__probe.smuggled'],
      timeoutMs: 10_000,
    });
    byId = new Map(results.map(r => [r.id, r]));
  }, 300_000);

  afterAll(() => box?.cleanup());

  it('reaches the injected probes at all', () => {
    // If injection silently failed, every assertion below would pass vacuously.
    for (const id of ['__probe.good_read', '__probe.bad_read', '__probe.unparseable', '__probe.smuggled']) {
      expect(byId.has(id), `probe ${id} was not reached — injection is not working`).toBe(true);
    }
  });

  it('FLAGS a tool that answers with prose instead of JSON', () => {
    const probe = byId.get('__probe.unparseable')!;
    expect(probe.answered).toBe(true);
    expect(probe.parsed, 'harness failed to notice unparseable content').toBe(false);
  });

  it('FLAGS a tool that returns an error payload without the failure marker', () => {
    const probe = byId.get('__probe.smuggled')!;
    expect(probe.parsed).toBe(true);
    expect(probe.isError, 'probe deliberately omits the failure marker').toBe(false);
    expect(probe.errorField, 'harness failed to see the smuggled error field').toBe('SOMETHING_FAILED');
  });

  it('CLEARS the sound probes — it is not simply flagging everything', () => {
    for (const id of ['__probe.good_read', '__probe.bad_read']) {
      const probe = byId.get(id)!;
      expect(probe.parsed, `${id} returns valid JSON and must not be flagged`).toBe(true);
      expect(probe.errorField, `${id} carries no error field`).toBeUndefined();
    }
  });
});

describe('harness calibration — S2 can tell a loud absence from a silent one', () => {
  let box: ReturnType<typeof makeS2Sandbox>;
  let grid: Map<string, Map<string, CallOutcome>>;

  beforeAll(() => {
    box = makeS2Sandbox();
    const results = runSweep('S2', scrubbedEnv(box.home, INJECT, { pinProjectRoot: false }), {
      only: ['__probe.good_read', '__probe.bad_read', '__probe.count_read'],
      timeoutMs: 10_000,
    });
    grid = new Map();
    for (const r of results) {
      const [id, situation] = r.id.split('::');
      if (!grid.has(id)) grid.set(id, new Map());
      grid.get(id)!.set(situation, r);
    }
  }, 300_000);

  afterAll(() => box?.cleanup());

  it('exercises every probe across all four situations', () => {
    for (const id of ['__probe.good_read', '__probe.bad_read', '__probe.count_read']) {
      expect(grid.get(id)?.size, `${id} was not swept across four situations`).toBe(4);
    }
  });

  it('the four situations are genuinely different on disk', () => {
    // Proves the SANDBOX, not the tools. If chmod 000 were ineffective, or the
    // unparseable project held readable files, every "confusion" this suite
    // reports would be an artefact of the fixture rather than a property of the
    // code under test.
    const good = grid.get('__probe.good_read')!;
    const statuses = ['empty', 'unreadable', 'unparseable', 'unresolvable'].map(s => {
      // From the digest, not the truncated sample: an unresolved-project error
      // carries a long detail string that JSON.parse cannot read at 300 chars.
      const o = good.get(s)!;
      return (JSON.parse(o.digest!) as { status: string }).status;
    });
    expect(statuses).toEqual(['empty', 'store_unreadable', 'partial', 'project_unresolved']);
  });

  it('FLAGS the read that collapses every situation into an empty success', () => {
    const bad = grid.get('__probe.bad_read')!;
    const confusions = ['unreadable', 'unparseable', 'unresolvable']
      .filter(s => sig(bad.get('empty')) === sig(bad.get(s)));
    expect(confusions, 'harness failed to catch the deliberately silent read').toEqual([
      'unreadable', 'unparseable', 'unresolvable',
    ]);
  });

  it('CLEARS a read that discriminates ONLY through a count', () => {
    // provenance.list's shape: same keys, same status, only unreadable_count
    // moves. The harness must see that, or it condemns the one pattern the spec
    // holds up as correct — which it did, until the digest stopped collapsing
    // every number into a single token.
    const counted = grid.get('__probe.count_read')!;
    const confusions = ['unreadable', 'unparseable', 'unresolvable']
      .filter(s => sig(counted.get('empty')) === sig(counted.get(s)));
    expect(confusions, 'harness cannot see a count-only discriminator').toEqual([]);
  });

  it('CLEARS the read that reports each situation distinctly', () => {
    // The load-bearing half. A sweep that flags the honest implementation too
    // is measuring nothing, and its 70 real findings would be worthless.
    const good = grid.get('__probe.good_read')!;
    const confusions = ['unreadable', 'unparseable', 'unresolvable']
      .filter(s => sig(good.get('empty')) === sig(good.get(s)));
    expect(confusions, 'harness flagged a correct implementation — it is not discriminating').toEqual([]);
  });
});
