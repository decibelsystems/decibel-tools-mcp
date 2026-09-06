// ============================================================================
// Torture sweep runner — executes inside a scrubbed child process
// ============================================================================
// Prints one `{SWEEP}<json>` line. Everything else on stdout is kernel logging
// and is ignored by the harness.
//
// Runs in a child process on purpose: module-level state reads the environment
// once at import, and the whole point of these sweeps is to observe what a real
// install does with a real (empty) environment. It is also the only way to
// survive a tool that hangs or calls process.exit.
// ============================================================================

import { createKernel } from '../../src/kernel.js';
import { buildSurface, normalise, type CallOutcome } from './harness.js';

const [, , sweep, ...rest] = process.argv;

function flag(name: string): string | undefined {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
}

const only = flag('only')?.split(',').filter(Boolean);
const timeoutMs = Number(flag('timeout') ?? 15_000);

const kernel = await createKernel();

// ============================================================================
// Fault injection — non-circular verification
// ============================================================================
// The spec's standing warning: if the sweeps come back green, distrust the
// harness, because the likeliest explanation is that it is not reaching the
// tools. The inverse is equally true — a sweep that flags EVERYTHING is not
// measuring anything either.
//
// So the harness is calibrated against four synthetic tools with known
// behaviour: two that are broken in the exact ways S1 and S2 hunt for, and two
// that are correct. A harness that cannot tell these four apart is not
// evidence about the other 273.
if (process.env.TORTURE_INJECT === '1') {
  const { readFileSync, readdirSync } = await import('fs');
  const { join } = await import('path');
  const { resolveProjectPaths } = await import('../../src/projectRegistry.js');

  const text = (v: unknown, isError = false) => ({
    content: [{ type: 'text' as const, text: typeof v === 'string' ? v : JSON.stringify(v) }],
    ...(isError ? { isError: true } : {}),
  });

  const define = (name: string, handler: () => Promise<unknown>) => ({
    definition: {
      name,
      description: `torture probe ${name}`,
      annotations: { title: name, readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      inputSchema: { type: 'object' as const, properties: {} },
    },
    handler,
  });

  /** Reads the store honestly: empty, unreadable, unparseable and unresolvable
   *  each produce a different answer. This is what "correct" looks like. */
  const YAMLmod = await import('yaml');
  const goodRead = async (args: Record<string, unknown>) => {
    let dir: string;
    try {
      dir = resolveProjectPaths(String(args.project_id ?? '')).subPath('sentinel', 'issues');
    } catch (err) {
      return text({ status: 'project_unresolved', detail: String(err) }, true);
    }
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return text({ status: 'empty', items: [], unreadable: 0, unparseable: 0 });
      return text({ status: 'store_unreadable', code }, true);
    }
    let unparseable = 0;
    const items: string[] = [];
    for (const n of names) {
      try {
        const body = readFileSync(join(dir, n), 'utf-8');
        // Genuinely parse it. String-matching for "looks broken" was the
        // probe's own first bug: the fixture was invalid YAML that happened not
        // to contain the sentinel substring, so the probe called it fine and
        // the calibration failed for a reason that had nothing to do with the
        // harness.
        YAMLmod.parse(body);
        items.push(n);
      } catch { unparseable++; }
    }
    return text({ status: unparseable ? 'partial' : 'ok', items, unreadable: 0, unparseable });
  };

  /** The bug: every situation collapses into the same empty success. */
  const badRead = async () => text({ items: [], count: 0 });

  /**
   * Correct, but discriminating ONLY through a count — the shape provenance.list
   * uses and the spec names as the model. Its answer keys never change and its
   * status string never changes; the only thing that moves is
   * `unreadable_count`. A harness that cannot see that difference would call the
   * best implementation in the codebase broken.
   */
  const countRead = async (args: Record<string, unknown>) => {
    let dir: string;
    try {
      dir = resolveProjectPaths(String(args.project_id ?? '')).subPath('sentinel', 'issues');
    } catch {
      return text({ items: [], total_count: 0, unreadable_count: 0, resolved: false });
    }
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return text({ items: [], total_count: 0, unreadable_count: 0, resolved: true });
      }
      return text({ items: [], total_count: 0, unreadable_count: 1, resolved: true });
    }
    let unreadable = 0;
    const items: string[] = [];
    for (const n of names) {
      try { YAMLmod.parse(readFileSync(join(dir, n), 'utf-8')); items.push(n); }
      catch { unreadable++; }
    }
    return text({ items, total_count: items.length, unreadable_count: unreadable, resolved: true });
  };

  const probes = {
    __probe_good_read: goodRead,
    __probe_bad_read: badRead,
    __probe_count_read: countRead,
    __probe_unparseable: async () => text('this is prose, not JSON'),
    __probe_smuggled: async () => text({ error: 'SOMETHING_FAILED', items: [] }),
  } as const;

  for (const [name, handler] of Object.entries(probes)) {
    kernel.toolMap.set(name, define(name, handler as never) as never);
  }

  const probeFacade = {
    name: '__probe',
    description: 'torture harness calibration probes',
    compactDescription: 'torture probes',
    microEligible: false,
    tier: 'core' as const,
    actions: {
      good_read: '__probe_good_read',
      bad_read: '__probe_bad_read',
      count_read: '__probe_count_read',
      unparseable: '__probe_unparseable',
      smuggled: '__probe_smuggled',
    },
  };
  kernel.facades.push(probeFacade);
  kernel.facadeMap.set('__probe', probeFacade);
}

const surface = buildSurface(kernel);

/**
 * Dispatch with a wall-clock bound. A tool that never settles is a finding, not
 * a reason to hang the suite — and it must be reported as unanswered rather
 * than silently dropped, since "no answer" is exactly the shape this suite
 * exists to make visible.
 */
async function callWithTimeout(
  name: string,
  args: Record<string, unknown>
): Promise<{ result?: Awaited<ReturnType<typeof kernel.dispatch>>; timedOut: boolean; threw?: string }> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<'timeout'>(resolve => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });

  try {
    const race = await Promise.race([
      kernel.dispatch(name, args, { transport: 'stdio', tier: 'pro' }).then(r => ({ r })),
      timeout,
    ]);
    if (race === 'timeout') return { timedOut: true };
    return { result: race.r, timedOut: false };
  } catch (err) {
    // dispatch() is documented never to reject. If it does, that is itself the
    // finding — record it rather than letting it abort the sweep.
    return { timedOut: false, threw: err instanceof Error ? err.message : String(err) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function inspect(
  id: string,
  ms: number,
  outcome: Awaited<ReturnType<typeof callWithTimeout>>
): CallOutcome {
  if (outcome.timedOut) {
    return { id, answered: false, parsed: false, isError: false, blocks: 0, sample: '', ms, failure: `no answer within ${timeoutMs}ms` };
  }
  if (outcome.threw !== undefined) {
    return { id, answered: false, parsed: false, isError: false, blocks: 0, sample: outcome.threw.slice(0, 300), ms, failure: `dispatch rejected: ${outcome.threw}` };
  }

  const result = outcome.result!;
  const blocks = result.content?.length ?? 0;
  const text = result.content?.[0]?.text ?? '';

  let parsed = false;
  let keys: string[] | undefined;
  let errorField: string | undefined;
  let digest: string | undefined;
  try {
    const value = JSON.parse(text);
    parsed = true;
    digest = JSON.stringify(normalise(value, 0));
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      keys = Object.keys(value);
      const e = (value as Record<string, unknown>).error;
      if (typeof e === 'string') errorField = e.slice(0, 200);
    }
  } catch {
    parsed = false;
  }

  return {
    id,
    answered: true,
    parsed,
    isError: !!result.isError,
    blocks,
    sample: text.slice(0, 300),
    keys,
    errorField,
    digest,
    ms,
  };
}

// ============================================================================
// S1 — envelope conformance
// ============================================================================
// Minimally valid params means the action name and nothing else. Many actions
// will legitimately fail on missing required arguments; success is NOT the
// assertion. Legibility is.

async function sweepS1(): Promise<CallOutcome[]> {
  const targets = surface.actions.filter(a => !only || only.includes(a.id));
  const results: CallOutcome[] = [];

  for (const a of targets) {
    const started = Date.now();
    const outcome = await callWithTimeout(a.facade, { action: a.action });
    results.push(inspect(a.id, Date.now() - started, outcome));
  }

  // Structural misses: an unknown facade and a known facade with an unknown
  // action must both answer with a machine-readable payload and no result key.
  for (const [id, name, args] of [
    ['__structural.unknown_facade', 'no_such_facade_at_all', { action: 'x' }],
    ['__structural.unknown_action', 'sentinel', { action: 'no_such_action_at_all' }],
    ['__structural.missing_action', 'sentinel', {}],
  ] as const) {
    const started = Date.now();
    const outcome = await callWithTimeout(name, args as Record<string, unknown>);
    results.push(inspect(id, Date.now() - started, outcome));
  }

  return results;
}

// ============================================================================
// S2 — absence is loud
// ============================================================================
// Four situations, four DISTINGUISHABLE answers. The assertion the test makes
// is a difference, not a value: read(empty) !== read(broken).

const SITUATIONS = {
  empty: 'torture-empty',
  unreadable: 'torture-unreadable',
  unparseable: 'torture-unparseable',
  unresolvable: 'no-such-project-exists-anywhere-at-all',
} as const;

async function sweepS2(): Promise<CallOutcome[]> {
  const reads = surface.actions.filter(a => a.readOnly && (!only || only.includes(a.id)));
  const results: CallOutcome[] = [];

  for (const a of reads) {
    for (const [situation, projectId] of Object.entries(SITUATIONS)) {
      const started = Date.now();
      const outcome = await callWithTimeout(a.facade, { action: a.action, project_id: projectId });
      const inspected = inspect(`${a.id}::${situation}`, Date.now() - started, outcome);
      results.push(inspected);
    }
  }

  return results;
}

if (sweep === 'surface') {
  // S0 needs the SAME surface the sweeps run against. Building it from the
  // parent process's ambient environment would describe a different kernel —
  // which is the drift S0 exists to detect, so it must not be the thing S0
  // measures itself with.
  console.log('{SWEEP}' + JSON.stringify(surface));
} else {
  const results = sweep === 'S1' ? await sweepS1() : await sweepS2();
  console.log('{SWEEP}' + JSON.stringify(results));
}
