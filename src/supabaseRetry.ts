// ============================================================================
// Transient-retry wrapper for Supabase calls (presence / dispatcher / inbox)
// ============================================================================
// The daemon's Supabase calls intermittently fail with a transient
// "TypeError: fetch failed" — a one-off connection/DNS blip from the host, not a
// real outage (the next attempt succeeds). These cluster into whole-tick failures
// and add log noise + a brief board-staleness window. (Issue 2026-06-13.)
//
// withRetry runs an async fn and retries ONCE on a transient network error after a
// short delay, before giving up. Deliberately minimal: one retry keeps the 30s/5s
// loop cadence intact while smoothing single blips. A genuine outage still fails
// fast (one retry, then the caller's normal error path).
// ============================================================================

import { log } from './config.js';

/** Heuristic: is this error a transient network/connection blip worth one retry? */
export function isTransientNetworkError(err: unknown): boolean {
  if (!err) return false;
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes('fetch failed') ||
    msg.includes('econnreset') ||
    msg.includes('econnrefused') ||
    msg.includes('etimedout') ||
    msg.includes('socket hang up') ||
    msg.includes('network') ||
    msg.includes('and retry') // PostgREST-fronted transient
  );
}

/**
 * Run `fn`; on a transient network error, wait `delayMs` and try once more.
 * `label` is used only for debug logging. Non-transient errors throw immediately.
 */
export async function withRetry<T>(fn: () => Promise<T>, label = 'supabase', delayMs = 500): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isTransientNetworkError(err)) throw err;
    log(`Retry: ${label} transient error (${err instanceof Error ? err.message : String(err)}); retrying once in ${delayMs}ms`);
    await new Promise((r) => setTimeout(r, delayMs));
    return await fn();
  }
}

/**
 * Variant for Supabase query builders that RESOLVE with `{ data, error }` rather
 * than throwing. Retries once when the resolved `error` looks transient OR the
 * call itself throws transiently. Returns the final `{ data, error }`.
 */
type Resulted<T> = { data: T; error: { message: string } | null };

export async function withRetryResult<T>(
  // Accepts a thenable (Supabase's PostgrestFilterBuilder is await-able but not a
  // real Promise), so callers can pass the query builder directly.
  fn: () => PromiseLike<Resulted<T>>,
  label = 'supabase',
  delayMs = 500,
): Promise<Resulted<T>> {
  let res: Resulted<T>;
  try {
    res = await fn();
  } catch (err) {
    if (!isTransientNetworkError(err)) throw err;
    res = { data: undefined as T, error: { message: err instanceof Error ? err.message : String(err) } };
  }
  if (res.error && isTransientNetworkError(res.error.message)) {
    log(`Retry: ${label} transient (${res.error.message}); retrying once in ${delayMs}ms`);
    await new Promise((r) => setTimeout(r, delayMs));
    try {
      return await fn();
    } catch (err) {
      if (!isTransientNetworkError(err)) throw err;
      return { data: undefined as T, error: { message: err instanceof Error ? err.message : String(err) } };
    }
  }
  return res;
}
