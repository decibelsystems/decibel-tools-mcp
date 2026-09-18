// ============================================================================
// Project resolution tracking — EPIC-0038 Phase 4
// ============================================================================
// Project resolution is forgiving by design. `resolveProject` has seven
// strategies, and the last two do not match the caller's request at all —
// they substitute a project discovered from the environment or the working
// directory so that an interactive agent's typo doesn't hard-fail:
//
//     // Strategy 7: If we discovered a project from cwd but ID didn't match,
//     // use it anyway. This prevents hard failures when Claude sends a
//     // slightly wrong project ID.
//
// That is a reasonable trade for one agent guessing at a name. It is the
// wrong trade for a programmatic caller sweeping a list of known-good ids:
// HQ fans out across 34 projects and five facades, and an id that fails to
// resolve does not come back empty — it comes back carrying ANOTHER project's
// issues, actions and friction, wearing the requested project's name in the
// UI. Absence is visible. Misattribution is not.
//
// Strategy 6 is subtler still: it returns the REQUESTED id with a substituted
// path, so comparing the id you asked for against the id you got cannot
// detect it. Only the resolver knows, and until now it dropped that knowledge
// on the floor — it logs a line locally and returns a value indistinguishable
// from a real match.
//
// This module keeps the resolver's own account of what happened for the
// duration of one dispatch, so the runtime can tell the caller when the
// project it served is not the project that was asked for. It changes no
// resolution behaviour; whether strategy 6 and 7 should exist at all for a
// programmatic caller is a separate and larger question.
// ============================================================================

import { AsyncLocalStorage } from 'async_hooks';

/**
 * Which strategy answered. The `matched` flag is the part callers care about:
 * strategies 1-5 and an explicit default all identify the project the caller
 * meant; 6 and 7 substitute a different one.
 */
export type ResolutionStrategy =
  | 'exact_id'
  | 'alias'
  | 'env_root_exact'
  | 'absolute_path'
  | 'cwd_exact'
  | 'env_root_fallback'
  | 'cwd_fallback'
  | 'default_project';

const SUBSTITUTING: ReadonlySet<ResolutionStrategy> = new Set<ResolutionStrategy>([
  'env_root_fallback',
  'cwd_fallback',
]);

export interface ResolutionRecord {
  /** What the caller asked for. Undefined when the call omitted a project id. */
  requested?: string;
  /** The id of the project actually served. */
  resolvedId: string;
  /** The path actually served — the field strategy 6 substitutes silently. */
  resolvedPath: string;
  strategy: ResolutionStrategy;
  /** False when the resolver substituted a project the caller did not ask for. */
  matched: boolean;
}

interface Slot {
  record?: ResolutionRecord;
}

const storage = new AsyncLocalStorage<Slot>();

/**
 * Run `fn` with resolution tracking active. Nested calls share the outermost
 * slot, so a tool that resolves several projects reports the last one — good
 * enough for the single-project calls this exists to protect, and honest about
 * it rather than silently reporting the first.
 */
export function withResolutionTracking<T>(fn: () => Promise<T>): Promise<T> {
  const existing = storage.getStore();
  if (existing) return fn();
  return storage.run({}, fn);
}

/** Called by the resolver at each of its exits. A no-op outside a tracked scope. */
export function recordResolution(
  requested: string | undefined,
  resolvedId: string,
  resolvedPath: string,
  strategy: ResolutionStrategy,
): void {
  const slot = storage.getStore();
  if (!slot) return;
  slot.record = {
    requested,
    resolvedId,
    resolvedPath,
    strategy,
    matched: !SUBSTITUTING.has(strategy),
  };
}

/** The resolution that happened during this dispatch, if any. */
export function currentResolution(): ResolutionRecord | undefined {
  return storage.getStore()?.record;
}
