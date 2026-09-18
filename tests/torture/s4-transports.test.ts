// ============================================================================
// S4 — Transport equivalence
// ============================================================================
// The same call, four ways: stdio, the thin stdio client, HTTP /call and
// HTTP /batch. Payloads must be identical modulo a declared, asserted list of
// envelope differences.
//
// WHY THIS IS A SEPARATE SWEEP. S1 and S2 dispatch into the kernel, so they
// describe what the TOOLS do. Everything between a tool and a client — the MCP
// envelope, the wire envelope, the thin client's unwrapping, the batch result
// shape, the local-only gate — is invisible to them. "Both transports must stay
// in sync" is a stated project rule (CLAUDE.md, MCP Infrastructure) with no test
// behind it, and the failure it names — a tool that works in Claude Code and is
// missing in ChatGPT — is a shape only a cross-transport comparison can see.
//
// Each transport gets its own pass against its own freshly booted daemon and a
// project directory reset to byte-identical state. That discipline was not
// precaution: without it twenty calls diverged and every one was a shared-state
// artefact — an open circuit breaker, a compiled manifest, a health log. The
// runner's comments record each one and what proved it.
//
// Gate for 3.0: HARD — stdio and HTTP must agree.
// ============================================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  makeSandbox,
  makeS2Sandbox,
  scrubbedEnv,
  runTransportSweep,
  loadWaivers,
  isWaived,
  DECLARED_DIFFERENCES,
  TRANSPORTS,
  type S4Report,
  type SandboxPaths,
  type TransportName,
  type EquivalenceRow,
} from './harness.js';

/** The daemon throttles at 100 req/min by default. A sweep is not a DoS. */
const SWEEP_RPM = 100_000;

/** Every transport but stdio reaches the runtime over HTTP — including the
 *  thin client, which is a local process holding an HTTP connection. */
const OVER_HTTP: TransportName[] = ['thin', 'http-call', 'http-batch'];

let s1box: SandboxPaths;
let s2box: SandboxPaths;
let s1: S4Report;
let s2: S4Report;
let waivers: ReturnType<typeof loadWaivers>;

beforeAll(async () => {
  waivers = loadWaivers();

  s1box = makeSandbox('s4-s1', { rateLimitRpm: SWEEP_RPM });
  s1 = runTransportSweep('S1', scrubbedEnv(s1box.home));

  // S2 must not pin DECIBEL_PROJECT_ROOT, for the reason ScrubOptions
  // documents: with it set, an id naming nothing still resolves.
  s2box = makeS2Sandbox({ rateLimitRpm: SWEEP_RPM });
  s2 = runTransportSweep('S2', scrubbedEnv(s2box.home, {}, { pinProjectRoot: false }));
}, 1_800_000);

afterAll(() => {
  s1box?.cleanup();
  s2box?.cleanup();
});

// ============================================================================
// Helpers
// ============================================================================

/** zoom is local-only: it is SUPPOSED to differ, and is asserted separately. */
function isLocalOnly(row: EquivalenceRow): boolean {
  return OVER_HTTP.every(t => /is local-only and is not served over HTTP/.test(row.answers[t].sample));
}

function actionOf(row: EquivalenceRow): string {
  return row.id.split('::')[0];
}

function comparable(report: S4Report): EquivalenceRow[] {
  return report.rows.filter(r => !isLocalOnly(r));
}

function describeRow(row: EquivalenceRow, against: TransportName[]): string {
  return [`${row.id}:`, ...against.map(t => `    ${t.padEnd(11)} ${row.answers[t].digest || row.answers[t].failure}`)].join('\n');
}

// ============================================================================
// Coverage — believed before anything it reports
// ============================================================================

describe('S4 — the sweep reached every transport', () => {
  it('answers every call on every transport', () => {
    const unanswered: string[] = [];
    for (const report of [s1, s2]) {
      for (const row of report.rows) {
        for (const t of TRANSPORTS) {
          if (row.answers[t].failure) unanswered.push(`${report.sweep} ${row.id} via ${t}: ${row.answers[t].failure}`);
        }
      }
    }
    expect(unanswered, 'a transport that produced no answer invalidates every comparison below').toEqual([]);
  });

  it('covers the whole surface, four times over', () => {
    expect(s1.rows.length).toBeGreaterThan(200);
    expect(s2.rows.length).toBeGreaterThan(400);
    console.log(
      `S4: ${s1.rows.length} actions and ${s2.rows.length} situation-reads, each through ` +
      `${TRANSPORTS.length} transports — ${(s1.rows.length + s2.rows.length) * TRANSPORTS.length} calls.`
    );
  });
});

// ============================================================================
// The tool list — a tool missing in ChatGPT
// ============================================================================

describe('S4 — every transport advertises the same tools', () => {
  it('serves the same set over stdio, thin, and HTTP — modulo local-only', () => {
    // The spec's headline catch. stdio is the reference because it is the only
    // transport with no gate in front of it.
    const stdio = new Set(s1.tools.stdio);
    const localOnly = new Set(comparable(s1).length ? s1.rows.filter(isLocalOnly).map(r => r.facade) : []);
    const expected = [...stdio].filter(n => !localOnly.has(n)).sort();

    for (const t of OVER_HTTP) {
      const missing = expected.filter(n => !s1.tools[t].includes(n));
      const extra = s1.tools[t].filter(n => !expected.includes(n));
      expect(missing, `${t} does not serve ${missing.length} tool(s) stdio does`).toEqual([]);
      expect(extra, `${t} serves ${extra.length} tool(s) stdio does not`).toEqual([]);
    }
  });

  it('withholds local-only facades from every HTTP-backed transport', () => {
    // Absence from the listing AND refusal on call. The listing alone is not
    // the boundary — /call accepts any name a caller sends.
    const localOnly = [...new Set(s1.rows.filter(isLocalOnly).map(r => r.facade))];
    expect(localOnly.length, 'no local-only facade was exercised — the gate is untested').toBeGreaterThan(0);

    for (const facade of localOnly) {
      for (const t of OVER_HTTP) {
        expect(s1.tools[t], `${t} lists local-only facade "${facade}"`).not.toContain(facade);
      }
    }

    for (const row of s1.rows.filter(isLocalOnly)) {
      for (const t of OVER_HTTP) {
        expect(row.answers[t].isError, `${row.id} was not refused over ${t}`).toBe(true);
      }
      // And it must WORK on stdio, or the gate is just a broken tool.
      expect(
        row.answers.stdio.parsed,
        `${row.id} did not answer legibly over stdio — a local-only facade must be usable locally`
      ).toBe(true);
      expect(
        /is local-only/.test(row.answers.stdio.sample),
        `${row.id} was refused over stdio too — the gate is not transport-scoped`
      ).toBe(false);
    }
  });
});

// ============================================================================
// Payload equivalence
// ============================================================================

describe('S4 — the same call returns the same payload', () => {
  /**
   * stdio, thin and /call run the sweep the same way: one call at a time.
   * Anything they disagree about is the transport.
   */
  for (const [label, get] of [['S1 (every action)', () => s1], ['S2 (every read, four situations)', () => s2]] as const) {
    it(`agrees across stdio, thin and /call — ${label}`, () => {
      const sequential: TransportName[] = ['stdio', 'thin', 'http-call'];
      const diverged = comparable(get())
        .filter(r => new Set(sequential.map(t => r.answers[t].digest)).size > 1)
        .map(r => describeRow(r, sequential));

      expect(diverged.join('\n\n'), `${diverged.length} call(s) answered differently depending on transport`).toBe('');
    });

    it(`agrees between stdio and /batch — ${label}`, () => {
      // /batch runs a chunk in parallel, so a read whose answer depends on what
      // has already run legitimately differs. Those are waived by name in
      // waivers.yaml with the evidence; everything else must match.
      const diverged = comparable(get())
        .filter(r => !isWaived(waivers, actionOf(r), 'S4-batch'))
        .filter(r => r.answers.stdio.digest !== r.answers['http-batch'].digest)
        .map(r => describeRow(r, ['stdio', 'http-batch']));

      expect(diverged.join('\n\n'), `${diverged.length} call(s) answered differently through /batch`).toBe('');
    });
  }

  it('marks failure the same way on every transport', () => {
    // Weaker than payload equality and worth asserting separately: a caller
    // that only branches on the failure marker must reach the same conclusion
    // everywhere, even where the payloads legitimately differ.
    const disagreed: string[] = [];
    for (const report of [s1, s2]) {
      for (const row of comparable(report)) {
        if (isWaived(waivers, actionOf(row), 'S4-batch')) continue;
        const marks = new Set(TRANSPORTS.map(t => row.answers[t].isError));
        if (marks.size > 1) {
          disagreed.push(`${report.sweep} ${row.id}: ` + TRANSPORTS.map(t => `${t}=${row.answers[t].isError}`).join(' '));
        }
      }
    }
    expect(disagreed, 'the failure marker must not depend on the transport').toEqual([]);
  });

  it('returns JSON on every transport, including failures', () => {
    // S1 asserts this at the kernel. Here it must survive four envelopes.
    const unparseable: string[] = [];
    for (const report of [s1, s2]) {
      for (const row of report.rows) {
        for (const t of TRANSPORTS) {
          if (!row.answers[t].parsed) unparseable.push(`${report.sweep} ${row.id} via ${t}: ${JSON.stringify(row.answers[t].raw.slice(0, 120))}`);
        }
      }
    }
    expect(unparseable, 'content must be JSON after every envelope').toEqual([]);
  });
});

// ============================================================================
// S2's guarantee must survive the wire
// ============================================================================

describe('S4 — absence stays loud through every transport', () => {
  it('preserves how many of the four situations a read can tell apart', () => {
    // NOT an assertion that a read distinguishes them — that is S2's job, and
    // S2 currently fails for dozens of reads. This asserts something a
    // transport controls: whatever a read CAN tell apart at the kernel, a
    // client must still be able to tell apart after the envelope. A transport
    // that flattens two answers into one destroys S2's guarantee for every
    // HTTP consumer, and no kernel-level sweep can see it.
    const bySituation = new Map<string, Map<TransportName, Set<string>>>();

    for (const row of comparable(s2)) {
      const action = actionOf(row);
      if (!bySituation.has(action)) {
        bySituation.set(action, new Map(TRANSPORTS.map(t => [t, new Set<string>()])));
      }
      for (const t of TRANSPORTS) {
        bySituation.get(action)!.get(t)!.add(row.answers[t].digest);
      }
    }

    const lost: string[] = [];
    for (const [action, perTransport] of bySituation) {
      if (isWaived(waivers, action, 'S4-batch')) continue;
      const reference = perTransport.get('stdio')!.size;
      for (const t of TRANSPORTS) {
        const got = perTransport.get(t)!.size;
        if (got < reference) {
          lost.push(`${action}: stdio tells ${reference} of the four situations apart, ${t} only ${got}`);
        }
      }
    }

    expect(lost, 'a transport that collapses distinguishable answers hides a broken store from HTTP callers').toEqual([]);
  });
});

// ============================================================================
// The batch contract
// ============================================================================

describe('S4 — /batch keeps partial failure and structural miss apart', () => {
  it('leaves the outer ok TRUE when a call ran and failed', () => {
    const { partialFailure } = s1.batchContract;
    expect(partialFailure.innerIsError, 'the probe did not produce one success and one failure').toEqual([false, true]);
    expect(partialFailure.outerOk, 'a call that ran and failed is a normal batch outcome, not a structural miss').toBe(true);
    expect(partialFailure.httpStatus, 'a partial failure still carries real results for the other calls').toBe(200);
    expect(partialFailure.codes.filter(Boolean), 'a call that ran must not be given a structural code').toEqual([]);
  });

  it('turns the outer ok FALSE when a call names a facade this runtime does not have', () => {
    const { structuralMiss } = s1.batchContract;
    expect(structuralMiss.codes, 'the unknown facade must be identified by code').toEqual([null, 'UNKNOWN_FACADE']);
    expect(structuralMiss.hasResult, 'a call that never ran must not carry a result').toEqual([true, false]);
    expect(structuralMiss.outerOk, 'since Phase 7 the registered set is machine-dependent — a missing extension must not read as an empty answer').toBe(false);
    expect(structuralMiss.httpStatus, 'the body still carries real results for the other calls; a 4xx would throw them away').toBe(200);
  });
});

// ============================================================================
// The declared differences are exhaustive
// ============================================================================

describe('S4 — the list of legitimate differences is closed', () => {
  it('undoes only differences that are on the list', () => {
    const seen = new Set<string>();
    for (const report of [s1, s2]) {
      for (const row of report.rows) {
        for (const t of TRANSPORTS) {
          const u = row.answers[t].unwrapped;
          if (u) seen.add(u);
        }
      }
    }
    const undeclared = [...seen].filter(u => !(u in DECLARED_DIFFERENCES));
    expect(undeclared, 'an envelope difference was undone that nobody declared').toEqual([]);
    expect(seen.size, 'no declared difference was exercised — the unwrapping is not being tested').toBeGreaterThan(0);
  });

  it('reports which ones the run actually exercised', () => {
    const counts = new Map<string, number>();
    for (const report of [s1, s2]) {
      for (const row of report.rows) {
        for (const t of TRANSPORTS) {
          const u = row.answers[t].unwrapped;
          if (u) counts.set(u, (counts.get(u) ?? 0) + 1);
        }
      }
    }
    console.log('S4 declared differences exercised:\n' + [...counts].map(([k, n]) => `     ${k}: ${n}`).join('\n'));
    expect(counts.size).toBeGreaterThan(0);
  });
});

// ============================================================================
// Calibration — the comparison can see a difference
// ============================================================================
// The spec's standing instruction: distrust a green sweep until it has been
// shown to go red on a known-bad input. S4's comparison is a digest equality,
// and a digest that normalised everything away would agree with itself
// forever. These exercise the real predicate.

describe('S4 calibration — equivalence is not vacuous', () => {
  const distinct = (rows: EquivalenceRow[], t: TransportName) => new Set(rows.map(r => r.answers[t].digest)).size;

  it('produces many different digests across the surface — it is not collapsing everything', () => {
    for (const t of TRANSPORTS) {
      expect(distinct(s1.rows, t), `${t} produced too few distinct digests to be discriminating`).toBeGreaterThan(100);
    }
  });

  it('SEES a difference the transports really do have', () => {
    // zoom is served on stdio and refused everywhere else. If the comparison
    // could not see that, it could not see anything — and the local-only test
    // above would be passing for the wrong reason.
    const local = s1.rows.filter(isLocalOnly);
    expect(local.length, 'no local-only facade in the surface — calibration cannot run').toBeGreaterThan(0);
    for (const row of local) {
      expect(
        row.answers.stdio.digest,
        `${row.id} digests identically on stdio and over HTTP, though one ran and the other was refused`
      ).not.toBe(row.answers['http-call'].digest);
    }
  });
});
