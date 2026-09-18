/**
 * Per-facade circuit breaker.
 *
 * The failure this exists for: one facade's dependency wedges — Mother's
 * Postgres stops accepting connections, Supabase hangs, a disk mount goes
 * away — and every call into that facade sits on a socket until it times out.
 * With six clients sharing one runtime that is enough to make the whole
 * runtime feel dead, even though twenty other facades are fine. The breaker
 * turns a slow, repeated failure into a fast, local one.
 *
 * WHAT COUNTS AS A FAULT is the whole design, because Decibel's tools rarely
 * throw. `senken_trade_summary` catches its own Postgres error and returns
 * `{isError: true}` (src/tools/senken.ts:117), so a breaker that only counted
 * exceptions would never trip on the exact case it was built for. But counting
 * every `isError` is worse: `create_issue` missing a title is an `isError`
 * too, and five bad calls in a row from one confused agent must not take the
 * sentinel facade offline for everyone.
 *
 * So the signal is *unresponsiveness*, not *unhappiness*:
 *
 *   - a thrown exception is always a fault (the handler didn't handle it)
 *   - an `isError` result that took longer than `slowFailureMs` is a fault
 *     (a dependency that times out is slow; a rejected argument is not)
 *   - an `isError` result that came back fast is neither fault nor proof of
 *     health — it leaves the counters exactly where they were
 *   - a success closes the circuit and clears the count
 *
 * State machine: closed → (threshold consecutive faults) → open → (cooldown
 * elapses) → half-open → success closes it, fault re-opens it. Half-open
 * admits exactly one probe; concurrent callers are rejected until it lands, so
 * a recovering database gets one connection attempt rather than six.
 *
 * The breaker never converts a working call into a failure — it only refuses
 * calls it has good reason to believe would fail slowly.
 */

export type CircuitState = 'closed' | 'open' | 'half_open';

export interface CircuitBreakerOptions {
  /** Consecutive faults before the circuit opens. Default 5. */
  failureThreshold?: number;
  /** How long the circuit stays open before admitting a probe. Default 30s. */
  cooldownMs?: number;
  /** An `isError` result slower than this counts as a fault. Default 2s. */
  slowFailureMs?: number;
  /** Injectable clock — tests drive this instead of sleeping. */
  now?: () => number;
}

export interface CircuitSnapshot {
  state: CircuitState;
  consecutive_faults: number;
  opened_at?: string;
  retry_after_ms?: number;
  last_error?: string;
}

/** What the caller learns when it asks permission to run. */
export type CircuitDecision =
  | { allowed: true }
  | { allowed: false; retryAfterMs: number; lastError?: string; openedAt?: string };

interface CircuitEntry {
  state: CircuitState;
  faults: number;
  openedAt: number;
  probeInFlight: boolean;
  lastError?: string;
}

const DEFAULTS = {
  failureThreshold: 5,
  cooldownMs: 30_000,
  slowFailureMs: 2_000,
};

export class CircuitBreakerRegistry {
  private readonly circuits = new Map<string, CircuitEntry>();
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  readonly slowFailureMs: number;
  private readonly now: () => number;

  constructor(opts: CircuitBreakerOptions = {}) {
    this.failureThreshold = opts.failureThreshold ?? DEFAULTS.failureThreshold;
    this.cooldownMs = opts.cooldownMs ?? DEFAULTS.cooldownMs;
    this.slowFailureMs = opts.slowFailureMs ?? DEFAULTS.slowFailureMs;
    this.now = opts.now ?? Date.now;
  }

  /**
   * Ask whether a call to `key` may proceed. Transitions open → half_open when
   * the cooldown has elapsed, and reserves the half-open probe for the caller
   * it says yes to.
   */
  beforeCall(key: string): CircuitDecision {
    const c = this.circuits.get(key);
    if (!c || c.state === 'closed') return { allowed: true };

    if (c.state === 'open') {
      const elapsed = this.now() - c.openedAt;
      if (elapsed < this.cooldownMs) {
        return {
          allowed: false,
          retryAfterMs: this.cooldownMs - elapsed,
          lastError: c.lastError,
          openedAt: new Date(c.openedAt).toISOString(),
        };
      }
      // Cooldown elapsed — this caller becomes the probe.
      c.state = 'half_open';
      c.probeInFlight = true;
      return { allowed: true };
    }

    // half_open: one probe at a time.
    if (c.probeInFlight) {
      return {
        allowed: false,
        retryAfterMs: this.cooldownMs,
        lastError: c.lastError,
        openedAt: new Date(c.openedAt).toISOString(),
      };
    }
    c.probeInFlight = true;
    return { allowed: true };
  }

  /**
   * Report what happened. `threw` and `durationMs` decide whether this was a
   * fault; see the module comment for why `isError` alone is not enough and
   * not too much.
   */
  afterCall(key: string, outcome: { threw: boolean; isError: boolean; durationMs: number; error?: string }): void {
    const fault = outcome.threw || (outcome.isError && outcome.durationMs >= this.slowFailureMs);
    if (fault) {
      this.recordFault(key, outcome.error);
      return;
    }
    if (outcome.isError) {
      // Fast domain error: says nothing about the dependency's health. Release
      // the probe if we were half-open, but leave the fault count alone.
      const c = this.circuits.get(key);
      if (c?.state === 'half_open') this.close(key);
      else if (c) c.probeInFlight = false;
      return;
    }
    this.recordSuccess(key);
  }

  recordSuccess(key: string): void {
    const c = this.circuits.get(key);
    if (!c) return;
    this.close(key);
  }

  recordFault(key: string, error?: string): void {
    const c = this.circuits.get(key) ?? {
      state: 'closed' as CircuitState,
      faults: 0,
      openedAt: 0,
      probeInFlight: false,
    };
    c.lastError = error;
    c.probeInFlight = false;

    if (c.state === 'half_open') {
      // The probe failed — straight back to open, full cooldown.
      c.state = 'open';
      c.openedAt = this.now();
      this.circuits.set(key, c);
      return;
    }

    c.faults += 1;
    if (c.faults >= this.failureThreshold) {
      c.state = 'open';
      c.openedAt = this.now();
    }
    this.circuits.set(key, c);
  }

  state(key: string): CircuitState {
    return this.circuits.get(key)?.state ?? 'closed';
  }

  /** Open circuits only — a healthy runtime reports `{}`. */
  snapshot(): Record<string, CircuitSnapshot> {
    const out: Record<string, CircuitSnapshot> = {};
    for (const [key, c] of this.circuits) {
      if (c.state === 'closed' && c.faults === 0) continue;
      out[key] = {
        state: c.state,
        consecutive_faults: c.faults,
        ...(c.state === 'closed' ? {} : {
          opened_at: new Date(c.openedAt).toISOString(),
          retry_after_ms: Math.max(0, this.cooldownMs - (this.now() - c.openedAt)),
        }),
        ...(c.lastError ? { last_error: c.lastError } : {}),
      };
    }
    return out;
  }

  reset(key?: string): void {
    if (key === undefined) this.circuits.clear();
    else this.circuits.delete(key);
  }

  private close(key: string): void {
    const c = this.circuits.get(key);
    if (!c) return;
    c.state = 'closed';
    c.faults = 0;
    c.probeInFlight = false;
    c.openedAt = 0;
  }
}
