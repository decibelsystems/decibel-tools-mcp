// The breaker's whole value is in WHICH failures it counts. Decibel tools
// mostly catch their own errors and return {isError: true} — senken returns
// that both when Postgres is unreachable and when you pass a bad strategy
// name. A breaker that treated those the same would either never trip (count
// only throws) or take a healthy facade offline because one agent sent five
// malformed calls (count every isError). These tests pin the distinction.
import { describe, it, expect } from 'vitest';
import { CircuitBreakerRegistry } from '../../src/runtime/circuitBreaker.js';

/** A clock the test drives, so cooldowns don't cost wall-clock seconds. */
function fakeClock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

function registry(clock = fakeClock(), opts = {}) {
  return {
    clock,
    breaker: new CircuitBreakerRegistry({
      failureThreshold: 3,
      cooldownMs: 30_000,
      slowFailureMs: 2_000,
      now: clock.now,
      ...opts,
    }),
  };
}

const slowFail = { threw: false, isError: true, durationMs: 5_000, error: 'ECONNREFUSED' };
const fastFail = { threw: false, isError: true, durationMs: 3, error: 'title is required' };
const thrown = { threw: true, isError: true, durationMs: 12, error: 'boom' };
const ok = { threw: false, isError: false, durationMs: 8 };

describe('CircuitBreakerRegistry — what counts as a fault', () => {
  it('opens after the threshold of slow isError results (the wedged-pool case)', () => {
    const { breaker } = registry();
    for (let i = 0; i < 3; i++) breaker.afterCall('senken', slowFail);
    expect(breaker.state('senken')).toBe('open');
    expect(breaker.beforeCall('senken').allowed).toBe(false);
  });

  it('opens after the threshold of thrown exceptions', () => {
    const { breaker } = registry();
    for (let i = 0; i < 3; i++) breaker.afterCall('deck', thrown);
    expect(breaker.state('deck')).toBe('open');
  });

  it('never opens on fast isError results — a rejected argument is not an outage', () => {
    const { breaker } = registry();
    for (let i = 0; i < 50; i++) breaker.afterCall('sentinel', fastFail);
    expect(breaker.state('sentinel')).toBe('closed');
    expect(breaker.beforeCall('sentinel').allowed).toBe(true);
  });

  it('requires the faults to be consecutive — a success clears the count', () => {
    const { breaker } = registry();
    breaker.afterCall('senken', slowFail);
    breaker.afterCall('senken', slowFail);
    breaker.afterCall('senken', ok);
    breaker.afterCall('senken', slowFail);
    breaker.afterCall('senken', slowFail);
    expect(breaker.state('senken')).toBe('closed');
  });

  it('isolates facades from each other', () => {
    const { breaker } = registry();
    for (let i = 0; i < 3; i++) breaker.afterCall('senken', slowFail);
    expect(breaker.beforeCall('senken').allowed).toBe(false);
    expect(breaker.beforeCall('sentinel').allowed).toBe(true);
    expect(breaker.beforeCall('oracle').allowed).toBe(true);
  });
});

describe('CircuitBreakerRegistry — recovery', () => {
  it('refuses calls for the cooldown, then admits a probe', () => {
    const { breaker, clock } = registry();
    for (let i = 0; i < 3; i++) breaker.afterCall('senken', slowFail);

    const refused = breaker.beforeCall('senken');
    expect(refused.allowed).toBe(false);
    if (!refused.allowed) {
      expect(refused.retryAfterMs).toBeLessThanOrEqual(30_000);
      expect(refused.lastError).toBe('ECONNREFUSED');
    }

    clock.advance(29_999);
    expect(breaker.beforeCall('senken').allowed).toBe(false);

    clock.advance(2);
    expect(breaker.beforeCall('senken').allowed).toBe(true);
    expect(breaker.state('senken')).toBe('half_open');
  });

  it('admits exactly one probe — a recovering database gets one connection, not six', () => {
    const { breaker, clock } = registry();
    for (let i = 0; i < 3; i++) breaker.afterCall('senken', slowFail);
    clock.advance(30_001);

    expect(breaker.beforeCall('senken').allowed).toBe(true);
    expect(breaker.beforeCall('senken').allowed).toBe(false);
    expect(breaker.beforeCall('senken').allowed).toBe(false);
  });

  it('closes when the probe succeeds', () => {
    const { breaker, clock } = registry();
    for (let i = 0; i < 3; i++) breaker.afterCall('senken', slowFail);
    clock.advance(30_001);
    breaker.beforeCall('senken');
    breaker.afterCall('senken', ok);

    expect(breaker.state('senken')).toBe('closed');
    expect(breaker.beforeCall('senken').allowed).toBe(true);
  });

  it('closes when the probe returns a fast domain error — the facade answered', () => {
    const { breaker, clock } = registry();
    for (let i = 0; i < 3; i++) breaker.afterCall('senken', slowFail);
    clock.advance(30_001);
    breaker.beforeCall('senken');
    breaker.afterCall('senken', fastFail);

    expect(breaker.state('senken')).toBe('closed');
  });

  it('re-opens for a full cooldown when the probe fails, without waiting for the threshold again', () => {
    const { breaker, clock } = registry();
    for (let i = 0; i < 3; i++) breaker.afterCall('senken', slowFail);
    clock.advance(30_001);
    breaker.beforeCall('senken');
    breaker.afterCall('senken', slowFail);

    expect(breaker.state('senken')).toBe('open');
    expect(breaker.beforeCall('senken').allowed).toBe(false);
    clock.advance(30_001);
    expect(breaker.beforeCall('senken').allowed).toBe(true);
  });
});

describe('CircuitBreakerRegistry — reporting', () => {
  it('reports nothing while every facade is healthy', () => {
    const { breaker } = registry();
    breaker.afterCall('sentinel', ok);
    breaker.afterCall('oracle', fastFail);
    expect(breaker.snapshot()).toEqual({});
  });

  it('reports the open circuit with its reason and retry window', () => {
    const { breaker } = registry();
    for (let i = 0; i < 3; i++) breaker.afterCall('senken', slowFail);
    const snap = breaker.snapshot();
    expect(snap.senken.state).toBe('open');
    expect(snap.senken.consecutive_faults).toBe(3);
    expect(snap.senken.last_error).toBe('ECONNREFUSED');
    expect(snap.senken.retry_after_ms).toBe(30_000);
    expect(snap.senken.opened_at).toBeTruthy();
  });

  it('reset forces a circuit closed', () => {
    const { breaker } = registry();
    for (let i = 0; i < 3; i++) breaker.afterCall('senken', slowFail);
    breaker.reset('senken');
    expect(breaker.state('senken')).toBe('closed');
    expect(breaker.beforeCall('senken').allowed).toBe(true);
  });
});
