// ============================================================================
// Tool torture harness — release gate for 3.0
// ============================================================================
// Spec: .decibel/specs/2026-09-02-tool-torture-test.md
//
// STRUCTURAL RULE: the surface under test is GENERATED from the kernel's own
// registries at runtime, never enumerated by hand. A hand-maintained list
// drifts out of sync silently, which is the same class of bug this suite
// exists to catch — the orphaned zod validator sat unenforced for 7.7 months
// and 98k events because nothing asserted it was reachable.
//
// Consequence: adding a tool without giving it torture coverage turns the
// build red. Every action must be CLAIMED by a sweep or WAIVED in
// waivers.yaml with a reason, an owner, and an expiry. A waiver is a visible,
// reviewable decision; an untested tool is not.
// ============================================================================

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync, execFile } from 'child_process';
import YAML from 'yaml';
import type { ToolKernel } from '../../src/kernel.js';

export const TORTURE_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(TORTURE_DIR, '..', '..');

// ============================================================================
// The surface
// ============================================================================

export interface ActionRef {
  /** "sentinel.create_issue" */
  id: string;
  facade: string;
  action: string;
  /** Internal tool the action dispatches to */
  tool: string;
  tier: 'core' | 'pro' | 'apps';
  localOnly: boolean;
  /** From the tool's own annotations. Drives which sweeps claim it. */
  readOnly: boolean;
  destructive: boolean;
}

export interface Surface {
  actions: ActionRef[];
  /** Internal tool names present in the kernel's toolMap */
  tools: string[];
  /** Tools no facade action points at */
  orphans: string[];
  /** Facade actions pointing at a tool that does not exist */
  danglingActions: string[];
  facadeCount: number;
  toolCount: number;
}

/**
 * Tools deliberately reachable by raw name only. Named in the spec: they
 * predate the facade layer and external callers still use these names.
 * An orphan NOT on this list is a tool nothing can call.
 */
export const RAW_NAME_ALLOWLIST = [
  'sentinel_listIssues',
  'sentinel_createIssue',
  'codereview_ingest',
];

export function buildSurface(kernel: ToolKernel): Surface {
  const actions: ActionRef[] = [];
  const danglingActions: string[] = [];

  for (const facade of kernel.facades) {
    for (const [action, tool] of Object.entries(facade.actions)) {
      const spec = kernel.toolMap.get(tool);
      if (!spec) {
        danglingActions.push(`${facade.name}.${action} -> ${tool} (not in toolMap)`);
        continue;
      }
      const ann = (spec.definition.annotations ?? {}) as Record<string, unknown>;
      actions.push({
        id: `${facade.name}.${action}`,
        facade: facade.name,
        action,
        tool,
        tier: facade.tier,
        localOnly: !!facade.localOnly,
        readOnly: ann.readOnlyHint === true,
        destructive: ann.destructiveHint === true,
      });
    }
  }

  const claimed = new Set(kernel.facades.flatMap(f => Object.values(f.actions)));
  const orphans = [...kernel.toolMap.keys()].filter(t => !claimed.has(t));

  return {
    actions,
    tools: [...kernel.toolMap.keys()],
    orphans,
    danglingActions,
    facadeCount: kernel.facadeCount,
    toolCount: kernel.toolCount,
  };
}

// ============================================================================
// Waivers
// ============================================================================

export interface Waiver {
  action: string;
  sweeps?: string[];
  waived: string[];
  reason: string;
  owner: string;
  expires: string;
}

export function loadWaivers(): Waiver[] {
  const file = path.join(TORTURE_DIR, 'waivers.yaml');
  if (!fs.existsSync(file)) return [];
  return (YAML.parse(fs.readFileSync(file, 'utf-8')) as Waiver[]) ?? [];
}

/** An expired waiver fails the build — that is the whole point of the expiry. */
export function expiredWaivers(waivers: Waiver[], now = new Date()): Waiver[] {
  return waivers.filter(w => {
    const when = Date.parse(w.expires);
    return Number.isNaN(when) || when < now.getTime();
  });
}

export function isWaived(waivers: Waiver[], actionId: string, sweep: string): boolean {
  return waivers.some(w => w.action === actionId && w.waived.includes(sweep));
}

// ============================================================================
// Sandbox
// ============================================================================

/**
 * A scrubbed environment. Every DECIBEL_*, SUPABASE_*, and provider credential
 * is removed and HOME is redirected, so a networked tool cannot reach a real
 * service and a writing tool cannot reach the real store.
 *
 * This is not only about safety. A credential-less networked tool MUST fail
 * legibly rather than returning a zero-shaped success — that is precisely what
 * S1 and S2 assert, and it cannot be asserted while ambient credentials are
 * making the calls succeed.
 */
export interface ScrubOptions {
  /**
   * Pin DECIBEL_PROJECT_ROOT. ON by default so a stray write lands in the
   * sandbox — but S2 must turn it OFF, because project resolution treats it as
   * a catch-all fallback (strategy 6: "any ID treated as label"), so with it
   * set an id that names nothing still resolves to the default project. The
   * "project does not resolve" situation cannot exist while it is set.
   *
   * That fallback is documented behaviour rather than a bug, but it is worth
   * knowing that in a daemon started with DECIBEL_PROJECT_ROOT, a typo'd
   * project id reads as the default project rather than as an error.
   */
  pinProjectRoot?: boolean;
}

export function scrubbedEnv(
  home: string,
  extra: Record<string, string> = {},
  opts: ScrubOptions = {}
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  const KEEP = new Set(['PATH', 'SHELL', 'LANG', 'LC_ALL', 'TMPDIR', 'TERM', 'USER']);

  for (const [k, v] of Object.entries(process.env)) {
    if (KEEP.has(k)) env[k] = v;
  }

  env.HOME = home;
  env.NODE_ENV = 'test';
  // Point project resolution at the sandbox so a write cannot reach the real
  // .decibel store.
  if (opts.pinProjectRoot !== false) {
    env.DECIBEL_PROJECT_ROOT = path.join(home, 'project');
  }
  env.DECIBEL_REGISTRY_PATH = path.join(home, '.decibel', 'projects.json');

  // CAPABILITY flags are NOT credentials and must stay on.
  //
  // The first version of this function scrubbed these too, which felt more
  // rigorous and was in fact the harness's own first bug: without them the
  // child kernel loaded 183 of 273 actions and the sweep reported a clean pass
  // over a surface two-thirds its real size. A sweep that cannot reach a tool
  // and says nothing is the exact failure this suite exists to catch, so the
  // distinction is now explicit — scrub SECRETS, keep CAPABILITIES, and let
  // the coverage assertion in each sweep enforce it.
  env.DECIBEL_PRO = '1';
  env.DECIBEL_ZOOM = '1';

  return { ...env, ...extra };
}

/**
 * The apps-tier extension modules, as absolute paths into the local build.
 * Present only in a full `npm run build`; the published build excludes them by
 * design (tsconfig.build.json), which is what S7 asserts.
 */
export const APPS_EXTENSIONS = ['senken', 'deck', 'mother', 'terminal'].map(n =>
  path.join(REPO_ROOT, 'dist', 'tools', `${n}.js`)
);

export interface SandboxPaths {
  home: string;
  project: string;
  cleanup: () => void;
}

/**
 * A HOME and a project with a real .decibel/ the sweeps can write into.
 *
 * `extensions` defaults to true so S1/S2 see the whole surface. S7 must pass
 * FALSE: it is simulating a public install, and a public user has no config.yaml
 * naming absolute paths into a developer's build tree. Leaving it on made S7's
 * "does not offer a private facade" assertion pass or fail depending on whether
 * some earlier test had happened to overwrite dist/ — a green result that was
 * an artefact of test ordering rather than a property of the artifact.
 */
export function makeSandbox(
  label: string,
  opts: { extensions?: boolean; rateLimitRpm?: number } = {}
): SandboxPaths {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `torture-${label}-`));
  const project = path.join(home, 'project');

  fs.mkdirSync(path.join(home, '.decibel'), { recursive: true });
  fs.mkdirSync(path.join(project, '.decibel'), { recursive: true });
  fs.writeFileSync(
    path.join(home, '.decibel', 'projects.json'),
    JSON.stringify({ projects: [{ id: 'torture', path: project, default: true }] }, null, 2)
  );

  // Apps-tier facades are extensions loaded by absolute path from an allowlist
  // in config.yaml — there is no environment variable that enables them, which
  // is Phase 7's whole point. The sandbox therefore needs its own allowlist, or
  // 45 apps actions silently drop out of every sweep.
  // The daemon's rate limiter defaults to 100 requests a minute, which is a
  // sane production default and far below what a sweep does. S4 raises it,
  // because a throttled sweep reports RATE_LIMITED as though it were the
  // tool's answer and every comparison downstream becomes meaningless. Nothing
  // else needs it — no other sweep speaks HTTP.
  const blocks: string[] = [];
  if (opts.extensions !== false) {
    const extensions = APPS_EXTENSIONS.filter(f => fs.existsSync(f));
    blocks.push(`extensions:\n  allow:\n${extensions.map(f => `    - ${f}`).join('\n')}`);
  }
  if (opts.rateLimitRpm !== undefined) {
    blocks.push(`daemon:\n  rate_limit_rpm: ${opts.rateLimitRpm}`);
  }
  if (blocks.length) {
    fs.writeFileSync(path.join(home, '.decibel', 'config.yaml'), blocks.join('\n') + '\n');
  }

  return {
    home,
    project,
    cleanup: () => {
      // chmod back first: an unreadable directory cannot be removed.
      for (const d of fs.existsSync(home) ? fs.readdirSync(home) : []) {
        const store = path.join(home, d, '.decibel');
        if (fs.existsSync(store)) { try { fs.chmodSync(store, 0o755); } catch { /* best effort */ } }
      }
      fs.rmSync(home, { recursive: true, force: true });
    },
  };
}

/**
 * The four S2 situations, as four real projects on disk.
 *
 * They must be four PROJECTS rather than one project mutated between passes,
 * because a read that caches its store would otherwise answer for the previous
 * situation and the difference assertion would pass for the wrong reason.
 */
export function makeS2Sandbox(
  opts: { rateLimitRpm?: number } = {}
): SandboxPaths & { situations: Record<string, string> } {
  const box = makeSandbox('s2', opts);

  const situations: Record<string, string> = {
    empty: 'torture-empty',
    unreadable: 'torture-unreadable',
    unparseable: 'torture-unparseable',
    unresolvable: 'no-such-project-exists-anywhere-at-all',
  };

  const projects: Array<{ id: string; path: string; default?: boolean }> = [];

  for (const id of ['torture-empty', 'torture-unreadable', 'torture-unparseable']) {
    const root = path.join(box.home, id);
    const store = path.join(root, '.decibel');
    fs.mkdirSync(store, { recursive: true });
    projects.push({ id, path: root });
  }

  // Records present but unparseable.
  //
  // THE FILENAME IS THE FIXTURE. A corrupt record only tests anything if the
  // reader actually globs it: every one of these paths is the shape a real
  // WRITER in this repo produces, down to the extension the matching read
  // filters on. Two of the originals did not clear that bar —
  // `friction/friction.yaml` sat in a directory whose reader takes only `.md`,
  // and no reader anywhere opens it — so friction.list answered a store with a
  // corrupt record exactly as it answers an empty one, and it answered
  // CORRECTLY. That is a hole in the sweep, not a bug in the tool, and while
  // it was open S2 could not tell the two apart.
  //
  // Adding a store here is therefore two steps: find the writer, copy its
  // filename, and only then corrupt the bytes.
  const bad = path.join(box.home, 'torture-unparseable', '.decibel');
  for (const [rel, body] of [
    // sentinel — issues and epics are markdown with YAML frontmatter;
    // test specs are whole-file YAML (testSpec.ts writes `${id}-${slug}.yaml`).
    ['sentinel/issues/ISS-0001-broken.md', '---\nthis: [is: not: valid: yaml\n  - ]]]\n---\n'],
    ['sentinel/epics/EPIC-0001-broken.md', '\x00\x01\x02 not text at all\n'],
    ['sentinel/test_specs/TS-0001-broken.yaml', 'id: [unclosed\n'],

    // architect — ADRs accept .yml/.yaml/.md; policies are .yaml only.
    ['architect/adrs/ADR-0001-broken.yml', 'id: [unclosed\n'],
    ['architect/policies/POL-0001-broken.yaml', 'id: [unclosed\n'],

    // agentic golden eval: a case is a DIRECTORY holding payload.json plus at
    // least one expected-*.txt, and a case missing either is skipped before it
    // is ever parsed — so the fixture needs both files for the corrupt payload
    // to be reached at all.
    ['architect/agentic/golden/case-broken/payload.json', '{ not json'],
    ['architect/agentic/golden/case-broken/expected-markdown.txt', 'expected output\n'],

    // designer — principles and evals are per-record .yaml; crits are appended
    // to one markdown journal.
    ['designer/principles/PRIN-0001-broken.yaml', 'id: [unclosed\n'],
    ['designer/evals/EVAL-0001-broken.yaml', 'id: [unclosed\n'],
    ['designer/crits/crits.md', '\x00\x01\x02 not the crit journal format\n'],

    // dojo — wishes and proposals are .yaml; an experiment is a directory with
    // a manifest.yaml.
    ['dojo/wishes/WISH-0001.yaml', '\t- a\n  - b\n\tmixed indent'],
    ['dojo/proposals/PROP-0001-broken.yaml', 'id: [unclosed\n'],
    ['dojo/experiments/EXP-0001-broken/manifest.yaml', 'id: [unclosed\n'],

    // friction — one markdown file per entry, frontmatter parsed on read.
    ['friction/20260101-000000-broken.md', '---\nthis: [is: not: valid: yaml\n  - ]]]\n---\n'],

    ['provenance/events/PROV-broken.yml', ': : :\n'],

    // vector — a run is runs/RUN-*/ with prompt.json and events.jsonl.
    ['runs/RUN-0001-broken/prompt.json', '{ not json'],
    ['runs/RUN-0001-broken/events.jsonl', 'not json\nnot json either\n'],

    // context — two whole-file JSON stores.
    ['context/facts/facts.json', '{ not json'],
    ['context/events/events.json', '{ not json'],

    // coordinator — locks and agents are YAML documents, the log is JSONL.
    ['coordinator/locks.yaml', 'locks: [unclosed\n'],
    ['coordinator/agents.yaml', 'agents: [unclosed\n'],
    ['coordinator/events.jsonl', 'not json\nnot json either\n'],

    // learnings — one markdown journal, entries delimited by `### [` headers.
    ['oracle/learnings/learnings.md', '\x00\x01\x02 not the learnings journal format\n'],
  ] as const) {
    const file = path.join(bad, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
  }

  fs.writeFileSync(
    path.join(box.home, '.decibel', 'projects.json'),
    JSON.stringify({ projects: [...projects, { id: 'torture', path: box.project, default: true }] }, null, 2)
  );

  // Store unreadable. Done LAST — anything written after this would fail.
  fs.chmodSync(path.join(box.home, 'torture-unreadable', '.decibel'), 0o000);

  return { ...box, situations };
}

// ============================================================================
// Payload digest — shared by every sweep
// ============================================================================
// Lives here rather than in one runner because S4 compares payloads ACROSS
// processes: the stdio child, the thin child and the daemon each produce an
// answer, and a digest computed by two slightly different functions would
// report a transport difference that is really a harness difference.
// ============================================================================

/**
 * Reduce a payload to what a CALLER COULD BRANCH ON, with anything that varies
 * run to run replaced by a type token.
 *
 * Keys alone are too coarse — {status:"empty"} and {status:"ok"} share a shape
 * while telling the caller opposite things. Raw values are too fine: absolute
 * paths, timestamps and durations differ between two runs of the same
 * situation and would make every answer look distinguishable from itself.
 */
export function normalise(value: unknown, depth: number): unknown {
  if (value === null) return null;
  if (Array.isArray(value)) return { __array: value.length };
  // ZERO IS NOT THE SAME AS SOME.
  //
  // Collapsing every number to one token was this harness's third bug, and it
  // condemned the CORRECT implementations: the good pattern here signals a
  // degraded read through a count (`unreadable_count: 6` vs `0`), which is
  // precisely what a single <num> token erases. provenance.list, which the spec
  // cites as the model to copy, was reported as failing because of it.
  //
  // Exact values are still dropped, because durations and elapsed-ms fields
  // vary run to run and would make every answer look different from itself.
  if (typeof value === 'number') return value === 0 ? 0 : '<nonzero>';
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (/^\/|^[A-Za-z]:\\/.test(value)) return '<path>';
    if (/\d{4}-\d{2}-\d{2}T/.test(value)) return '<timestamp>';
    // Compact form: pack-20260905T164305-c2ffe56e. Same volatility, different
    // spelling — S4 found it comparing two runs of agentic.compile_pack that
    // agreed on every field including the content hash.
    if (/\d{8}T\d{6}/.test(value)) return '<timestamp>';
    if (/[0-9a-f]{8}-[0-9a-f]{4}/i.test(value)) return '<uuid>';
    // Long prose differs by embedded paths and counts; short scalars are the
    // discriminators worth keeping (status codes, enum values, error codes).
    return value.length > 60 ? '<text>' : value;
  }
  if (typeof value === 'object') {
    if (depth >= 3) return '<object>';
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as object).sort()) {
      out[k] = normalise((value as Record<string, unknown>)[k], depth + 1);
    }
    return out;
  }
  return typeof value;
}

// ============================================================================
// Sweep runner
// ============================================================================

export interface CallOutcome {
  id: string;
  /** Did the process get an answer at all (vs timeout/crash)? */
  answered: boolean;
  /** content[0].text parsed as JSON */
  parsed: boolean;
  /** MCP-level failure marker */
  isError: boolean;
  /** Content block count */
  blocks: number;
  /** First content block, truncated — for diagnosis when an assertion fails */
  sample: string;
  /** Keys of the parsed payload, when it parsed */
  keys?: string[];
  /**
   * A normalised digest of the payload — keys AND scalar values, with volatile
   * bits (paths, timestamps, ids, durations) replaced by type tokens.
   *
   * Comparing keys alone was this harness's second bug: a read answering
   * `{status: "empty"}` and the same read answering `{status: "ok"}` have
   * identical keys, so the sweep called two genuinely distinguishable answers
   * confused. It was caught by the calibration probe rather than by review,
   * which is the argument for having the probe.
   */
  digest?: string;
  /** Set when the payload carried an error field */
  errorField?: string;
  /** Milliseconds */
  ms: number;
  failure?: string;
}

/**
 * Run a sweep in a CHILD PROCESS with a scrubbed environment.
 *
 * In-process would be simpler and would prove less: module-level state reads
 * the environment once, and this suite's entire purpose is to test what a real
 * install does with a real (empty) environment. It is also the only way to
 * survive a tool that hangs or calls process.exit.
 */
/** The surface as the SWEEPS see it — built in a child process with the sandbox
 *  environment, so S0 describes the same kernel S1 and S2 actually exercise. */
export function loadSurface(env: NodeJS.ProcessEnv): Surface {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'torture-cwd-'));
  const out = execFileSync(
    path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx'),
    [path.join(TORTURE_DIR, 'runner.mts'), 'surface'],
    { cwd, encoding: 'utf-8', env, timeout: 300_000, maxBuffer: 64 * 1024 * 1024 }
  );
  const line = out.split('\n').filter(l => l.startsWith('{SWEEP}')).pop();
  if (!line) throw new Error(`surface probe produced no result:\n${out.slice(-2000)}`);
  return JSON.parse(line.slice('{SWEEP}'.length)) as Surface;
}

export function runSweep(
  sweep: 'S1' | 'S2',
  env: NodeJS.ProcessEnv,
  opts: { only?: string[]; timeoutMs?: number; cwd?: string } = {}
): CallOutcome[] {
  const runner = path.join(TORTURE_DIR, 'runner.mts');
  const args = [runner, sweep];
  if (opts.only?.length) args.push('--only', opts.only.join(','));
  if (opts.timeoutMs) args.push('--timeout', String(opts.timeoutMs));

  // NEUTRAL CWD, and the local tsx binary by absolute path so it still resolves.
  //
  // Project resolution's last two strategies walk up from the working
  // directory and will "use the discovered project even if the ID doesn't
  // match". Run from the repo, an id naming nothing therefore resolves to
  // decibel-tools-mcp's own .decibel store — so the sweep was reading the real
  // project, and the "project does not resolve" situation could not occur at
  // all. Caught by the calibration probe, which is the second time it has paid
  // for itself.
  const cwd = opts.cwd ?? fs.mkdtempSync(path.join(os.tmpdir(), 'torture-cwd-'));
  const tsx = path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx');

  const out = execFileSync(tsx, args, {
    cwd,
    encoding: 'utf-8',
    env,
    timeout: 900_000,
    maxBuffer: 64 * 1024 * 1024,
  });

  const line = out.split('\n').filter(l => l.startsWith('{SWEEP}')).pop();
  if (!line) throw new Error(`sweep ${sweep} produced no result line:\n${out.slice(-4000)}`);
  return JSON.parse(line.slice('{SWEEP}'.length)) as CallOutcome[];
}

// ============================================================================
// Declared envelope differences
// ============================================================================
// The legitimate ways one transport's answer differs from another's. Each is
// undone before payloads are compared, and the S4 test asserts the list is
// EXHAUSTIVE: a difference not on it is a finding, and adding one is a
// decision someone made rather than a shape that drifted in.

export const DECLARED_DIFFERENCES = {
  'envelope:status+ok':
    '/call wraps the payload as {status, ...payload, ok}. `status` is dropped only ' +
    'when it is the literal marker "executed" — a payload with its own `status` ' +
    'overwrites the marker, which is the whole reason `ok` exists.',
  'envelope:error-restringify':
    'On failure /call carries the tool payload as a JSON STRING in `error` with ' +
    'code TOOL_ERROR. The thin client inherits it. Un-nested before comparison.',
  'envelope:duration_ms':
    '/batch annotates each entry with duration_ms and echoes facade/action.',
  'sanitize:paths':
    '/call redacts absolute paths out of error text; stdio does not. Applied to ' +
    'every transport before digesting, and asserted separately on the raw text.',
} as const;

export type DeclaredDifference = keyof typeof DECLARED_DIFFERENCES;

/**
 * What /batch answered for the two contract probes.
 *
 * The distinction between a partial failure and a structural miss is
 * load-bearing — httpServer.ts carries a paragraph explaining why `ok` stays
 * true when a call ran and failed — and it is exactly the kind of thing a
 * later simplification collapses. Asserting it takes two batches.
 */
export interface BatchContract {
  partialFailure: { outerOk?: boolean; httpStatus: number; innerIsError: boolean[]; codes: Array<string | null> };
  structuralMiss: { outerOk?: boolean; httpStatus: number; codes: Array<string | null>; hasResult: boolean[] };
}

// ============================================================================
// S4 — transport equivalence
// ============================================================================

export type TransportName = 'stdio' | 'thin' | 'http-call' | 'http-batch';

export interface TransportAnswer {
  /** The failure marker, however this transport expresses one. */
  isError: boolean;
  /** Did the payload parse as JSON. */
  parsed: boolean;
  /** normalise() over the sanitised payload — the comparison unit. */
  digest: string;
  /** First 300 chars of the payload, for diagnosis. */
  sample: string;
  /** As it came off the wire, before any declared difference was undone. */
  raw: string;
  /** Which declared difference was undone to produce `digest`, if any. */
  unwrapped?: string;
  /** /call only. */
  httpStatus?: number;
  /** /batch only: the outer `ok` of the chunk this call travelled in. */
  batchOuterOk?: boolean;
  /** /batch only: the entry carried no `result` — a structural miss. */
  batchStructuralMiss?: boolean;
  /** Set when the transport produced no answer at all. */
  failure?: string;
}

export interface EquivalenceRow {
  id: string;
  facade: string;
  answers: Record<TransportName, TransportAnswer>;
}

export interface S4Report {
  sweep: 'S1' | 'S2';
  port: number;
  health: Record<string, unknown>;
  /** The tool list each transport advertises. */
  tools: Record<TransportName, string[]>;
  /** /batch's ok/isError contract, probed directly. */
  batchContract: BatchContract;
  rows: EquivalenceRow[];
}

/**
 * Run one sweep through all four transports.
 *
 * Spawns a daemon, an stdio server and a thin client inside a single child
 * process, so the four processes live and die together and a crashed sweep
 * cannot leave a daemon bound to a port. The parent gets one JSON line.
 */
export function runTransportSweep(
  sweep: 'S1' | 'S2',
  env: NodeJS.ProcessEnv,
  opts: { only?: string[]; timeoutMs?: number } = {}
): S4Report {
  const args = [path.join(TORTURE_DIR, 'transports.mts'), sweep];
  if (opts.only?.length) args.push('--only', opts.only.join(','));
  if (opts.timeoutMs) args.push('--timeout', String(opts.timeoutMs));

  // Neutral cwd, for the reason runSweep documents: project resolution walks up
  // from the working directory and would otherwise reach the real store.
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'torture-s4-'));

  const out = execFileSync(path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx'), args, {
    cwd,
    encoding: 'utf-8',
    env,
    timeout: 1_800_000,
    maxBuffer: 256 * 1024 * 1024,
  });

  const line = out.split('\n').filter(l => l.startsWith('{SWEEP}')).pop();
  if (!line) throw new Error(`S4 ${sweep} produced no result line:\n${out.slice(-4000)}`);
  return JSON.parse(line.slice('{SWEEP}'.length)) as S4Report;
}

export const TRANSPORTS: TransportName[] = ['stdio', 'thin', 'http-call', 'http-batch'];

/**
 * Run arbitrary code against a freshly booted kernel in a child process with the
 * sandbox environment, and return whatever it prints after a {RESULT} marker.
 *
 * The generic form of what S6 and the calibration probes need. In-process would
 * be simpler and would describe the wrong kernel: tier flags, the extension
 * allowlist and the registry path are all read once at import.
 */
export function runInKernel<T>(home: string, body: string, extraEnv: Record<string, string> = {}): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'torture-run-'));
  const file = path.join(dir, 'probe.mts');
  fs.writeFileSync(file, `
    import { createKernel } from '${REPO_ROOT}/src/kernel.js';
    const kernel = await createKernel();
    const call = async (name: string, args: Record<string, unknown>) => {
      const r = await kernel.dispatch(name, args, { transport: 'stdio', tier: 'pro' });
      const text = r.content?.[0]?.text ?? '';
      let parsed: unknown = undefined;
      try { parsed = JSON.parse(text); } catch { /* left undefined */ }
      return { isError: !!r.isError, text, parsed };
    };
    ${body}
  `);
  try {
    const out = execFileSync(path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx'), [file], {
      cwd: dir,
      encoding: 'utf-8',
      env: { ...scrubbedEnv(home), ...extraEnv },
      timeout: 900_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    const line = out.split('\n').filter(l => l.startsWith('{RESULT}')).pop();
    if (!line) throw new Error(`probe produced no result:\n${out.slice(-3000)}`);
    return JSON.parse(line.slice('{RESULT}'.length)) as T;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ============================================================================
// S5 — concurrent racers
// ============================================================================

export interface RacerResult<T> {
  racer: number;
  /** What the racer's body returned, when it did not throw. */
  value?: T;
  /** Stack of whatever the body threw. A throw is data here, not a test error. */
  error?: string;
  /** Epoch ms at which the racer passed the barrier and began contending. */
  startedAt: number;
  finishedAt: number;
}

/**
 * Run the same body in N child processes that all start contending at the same
 * instant, and return every racer's result.
 *
 * WHY A BARRIER, and why it is not optional. Booting a kernel under tsx costs
 * seconds, and the cost varies per process. Spawn ten children and let them run
 * as they load and they finish staggered — the last one starts after the first
 * has long since returned, so nothing contends and the sweep reports a clean
 * pass over a race it never ran. That is the harness lying in the same shape
 * S2's fixture paths did, so the barrier is paired with an assertion in the
 * test that the racers actually overlapped. Do not remove one without the other.
 *
 * The barrier is a rendezvous rather than a fixed delay: each child writes a
 * ready file after its kernel is up, the parent waits for all of them, then
 * creates a single `go` file that releases every child within one poll interval.
 * A fixed lead would have to be long enough for the slowest boot on the slowest
 * machine, which is both slower and less reliable.
 */
export async function raceInKernel<T>(
  home: string,
  body: string,
  opts: {
    racers: number;
    extraEnv?: Record<string, string>;
    /** Per-child wall clock, including kernel boot and the barrier wait. */
    timeoutMs?: number;
  }
): Promise<RacerResult<T>[]> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'torture-race-'));
  const readyDir = path.join(dir, 'ready');
  const goFile = path.join(dir, 'go');
  fs.mkdirSync(readyDir, { recursive: true });

  const file = path.join(dir, 'racer.mts');
  fs.writeFileSync(file, `
    import fs from 'fs';
    import { createKernel } from '${REPO_ROOT}/src/kernel.js';

    const racer = Number(process.env.TORTURE_RACER);
    const kernel = await createKernel();

    const call = async (name: string, args: Record<string, unknown>) => {
      const r = await kernel.dispatch(name, args, { transport: 'stdio', tier: 'pro' });
      const text = r.content?.[0]?.text ?? '';
      let parsed: unknown = undefined;
      try { parsed = JSON.parse(text); } catch { /* left undefined */ }
      return { isError: !!r.isError, text, parsed };
    };

    const work = async () => { ${body} };

    // Rendezvous: announce readiness, then spin until the parent says go.
    fs.writeFileSync(${JSON.stringify(readyDir)} + '/' + racer, '');
    while (!fs.existsSync(${JSON.stringify(goFile)})) {
      await new Promise(r => setTimeout(r, 2));
    }

    const startedAt = Date.now();
    let value: unknown;
    let error: string | undefined;
    try { value = await work(); } catch (e) { error = String((e as Error)?.stack ?? e); }
    const finishedAt = Date.now();

    console.log('{RESULT}' + JSON.stringify({ racer, value, error, startedAt, finishedAt }));
  `);

  const tsx = path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx');
  const timeout = opts.timeoutMs ?? 900_000;

  const children = Array.from({ length: opts.racers }, (_, racer) =>
    new Promise<RacerResult<T>>((resolve, reject) => {
      execFile(
        tsx,
        [file],
        {
          cwd: dir,
          encoding: 'utf-8',
          env: { ...scrubbedEnv(home), ...opts.extraEnv, TORTURE_RACER: String(racer) },
          timeout,
          maxBuffer: 64 * 1024 * 1024,
        },
        (err, stdout) => {
          const line = String(stdout).split('\n').filter(l => l.startsWith('{RESULT}')).pop();
          if (!line) {
            reject(new Error(
              `racer ${racer} produced no result${err ? ` (${err.message})` : ''}:\n` +
              String(stdout).slice(-3000)
            ));
            return;
          }
          resolve(JSON.parse(line.slice('{RESULT}'.length)) as RacerResult<T>);
        }
      );
    })
  );

  // Release them once every child has a kernel up. If one never reports ready
  // the go file is written anyway on timeout, so a boot failure surfaces as
  // that racer's own error rather than as a hang here.
  const deadline = Date.now() + timeout;
  while (fs.readdirSync(readyDir).length < opts.racers && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 20));
  }
  fs.writeFileSync(goFile, '');

  try {
    return await Promise.all(children);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** True when every racer's [startedAt, finishedAt] overlaps every other's. */
export function racersOverlapped(results: Array<{ startedAt: number; finishedAt: number }>): boolean {
  const latestStart = Math.max(...results.map(r => r.startedAt));
  const earliestFinish = Math.min(...results.map(r => r.finishedAt));
  return latestStart <= earliestFinish;
}
