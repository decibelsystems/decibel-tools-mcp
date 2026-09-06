// ============================================================================
// S2 — Absence is loud (the negative sweep)
// ============================================================================
// The sharpest sweep, aimed straight at this project's worst bug class.
//
// Every failure this project has actually shipped returned ok: true. The voice
// inbox was dead for 5½ hours and the session digest said `voice 0`. A
// regenerated plist dropped four facades and /health said `status: ok`. In both
// cases "I found nothing" was indistinguishable from "I could not look".
//
// For every read action, four situations must produce four DISTINGUISHABLE
// answers. The core assertion is a DIFFERENCE, not a value:
//
//     read(empty_store) !== read(broken_store)
//
// Gate for 3.0: HARD — 100% of read actions.
// ============================================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createKernel } from '../../src/kernel.js';
import {
  buildSurface,
  loadWaivers,
  isWaived,
  makeS2Sandbox,
  scrubbedEnv,
  runSweep,
  type CallOutcome,
  type Surface,
} from './harness.js';

let sandbox: ReturnType<typeof makeS2Sandbox>;
let surface: Surface;
let results: CallOutcome[];

/** outcomes keyed action id -> situation -> outcome */
let grid: Map<string, Map<string, CallOutcome>>;
/** the subset of read actions this sweep can actually judge — see beforeAll */
let judged: string[];

const SITUATIONS = ['empty', 'unreadable', 'unparseable', 'unresolvable'] as const;

/**
 * The observable answer, reduced to what a caller can actually branch on.
 * Two situations are "distinguishable" if a programmatic consumer could tell
 * them apart from this alone — not if a human could tell from the prose.
 */
function signature(o: CallOutcome | undefined): string {
  if (!o) return 'ABSENT';
  if (!o.answered) return `UNANSWERED:${o.failure}`;
  if (!o.parsed) return 'UNPARSEABLE';
  return JSON.stringify({ isError: o.isError, digest: o.digest });
}

beforeAll(async () => {
  surface = buildSurface(await createKernel());
  sandbox = makeS2Sandbox();
  results = runSweep('S2', scrubbedEnv(sandbox.home, {}, { pinProjectRoot: false }), { timeoutMs: 15_000 });

  grid = new Map();
  for (const r of results) {
    const [id, situation] = r.id.split('::');
    if (!grid.has(id)) grid.set(id, new Map());
    grid.get(id)!.set(situation, r);
  }

  const waivers = loadWaivers();

  // Judge only the reads this sweep can actually speak to.
  //
  // TWO exclusions, both necessary, and both narrowing what S2 CLAIMS rather
  // than what it checks:
  //
  // 1. WAIVED — a read backed by a remote store (deck's Supabase, terminal's
  //    wallet API, the Zoom API). The four situations are project-store
  //    situations; none of them changes what these reads see, so identical
  //    answers are correct behaviour, not a bug. Waiving is a statement that
  //    the sweep cannot tell, not that the tool handles absence well.
  //
  // 2. NEVER REACHED THE STORE — called with only a project_id, an action
  //    needing more arguments fails on validation in all four situations, and
  //    those four identical failures say nothing about absence handling. Before
  //    this filter the sweep reported 135 of 135 read actions "confused", a
  //    number that is technically true and analytically worthless.
  judged = [...grid.keys()].filter(id => {
    if (isWaived(waivers, id, 'S2')) return false;
    const empty = grid.get(id)!.get('empty');
    return !!empty?.answered && !empty.isError;
  });
}, 1_800_000);

afterAll(() => sandbox?.cleanup());

describe('S2 — absence is loud', () => {
  it('reaches every read action in the surface', () => {
    const waivers = loadWaivers();
    const expected = surface.actions
      .filter(a => a.readOnly && !isWaived(waivers, a.id, 'S2'))
      .map(a => a.id);

    const missing = expected.filter(id => !grid.has(id));
    expect(
      missing,
      `sweep did not reach ${missing.length}/${expected.length} read actions`
    ).toEqual([]);
  });

  it('answers every situation for every read action', () => {
    const unanswered: string[] = [];
    for (const [id, situations] of grid) {
      for (const s of SITUATIONS) {
        const o = situations.get(s);
        if (!o?.answered) unanswered.push(`${id}::${s}: ${o?.failure ?? 'no result'}`);
      }
    }
    expect(unanswered).toEqual([]);
  });

  it('does not confuse an EMPTY store with an UNREADABLE one', () => {
    // chmod 000. The read cannot see the data. Returning the same shape as a
    // genuinely empty store tells the caller "nothing to report" when the truth
    // is "I could not look."
    const confused: string[] = [];
    for (const id of judged) {
      const s = grid.get(id)!;
      if (signature(s.get('empty')) === signature(s.get('unreadable'))) {
        confused.push(`${id} — both answer: ${signature(s.get('empty')).slice(0, 150)}`);
      }
    }
    expect(confused, `${confused.length} read actions cannot distinguish empty from unreadable`).toEqual([]);
  });

  it('does not confuse an EMPTY store with one holding UNPARSEABLE records', () => {
    // Records are present; they cannot be parsed. Silently skipping them and
    // reporting the survivors is data loss reported as success — this is the
    // writer/reader drift family, three confirmed bugs, one merged eight days
    // before the spec was written.
    const confused: string[] = [];
    for (const id of judged) {
      const s = grid.get(id)!;
      if (signature(s.get('empty')) === signature(s.get('unparseable'))) {
        confused.push(`${id} — both answer: ${signature(s.get('empty')).slice(0, 150)}`);
      }
    }
    expect(confused, `${confused.length} read actions cannot distinguish empty from unparseable`).toEqual([]);
  });

  it('does not confuse an EMPTY store with a project that does not resolve', () => {
    // A project id that names nothing must not read as an empty project. This
    // is how a typo becomes "you have no issues."
    const confused: string[] = [];
    for (const id of judged) {
      const s = grid.get(id)!;
      if (signature(s.get('empty')) === signature(s.get('unresolvable'))) {
        confused.push(`${id} — both answer: ${signature(s.get('empty')).slice(0, 150)}`);
      }
    }
    expect(confused, `${confused.length} read actions cannot distinguish empty from unresolvable`).toEqual([]);
  });

  it('reports what it swept, judged, and excluded', () => {
    const waivers = loadWaivers();
    const waived = [...grid.keys()].filter(id => isWaived(waivers, id, 'S2')).length;
    const unreached = grid.size - judged.length - waived;
    const clean = judged.filter(id => {
      const s = grid.get(id)!;
      return SITUATIONS.every(x => new Set(SITUATIONS.map(y => signature(s.get(y)))).size === 4 || true) &&
        !['unreadable', 'unparseable', 'unresolvable'].some(o => signature(s.get('empty')) === signature(s.get(o)));
    });

    console.log(
      `S2: ${grid.size} read actions x 4 situations = ${results.length} calls.\n` +
      `    judged: ${judged.length}  (waived as remote-backed: ${waived}, never reached the store: ${unreached})\n` +
      `    of the judged, ${clean.length} distinguish every broken state from empty; ` +
      `${judged.length - clean.length} do not.`
    );

    // The sweep must judge a real share of the surface, or its silence is not
    // evidence of anything.
    expect(judged.length).toBeGreaterThan(30);
  });
});
