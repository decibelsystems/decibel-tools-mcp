// The envelope's failure mode was that its own marker could be overwritten by
// the data it wrapped. Every consumer worked around it the same way — testing
// `status === 'error'` because `status === 'executed'` could not be trusted —
// and no consumer could ask the direct question "did this succeed?".
//
// These tests pin the property that fixes it: `ok` survives any payload.
import { describe, it, expect } from 'vitest';
import {
  wrapSuccess,
  wrapError,
  envelopeFailed,
  envelopeHttpStatus,
  sanitizeErrorMessage,
} from '../../src/lib/envelope.js';

describe('wrapSuccess', () => {
  it('marks a plain payload as ok', () => {
    const env = wrapSuccess({ id: 'ISS-0145' });
    expect(env.ok).toBe(true);
    expect(env.status).toBe('executed');
    expect(env.id).toBe('ISS-0145');
  });

  it('keeps ok:true even when the payload carries its own status — the original bug', () => {
    // A real sentinel read: the issue's own status is 'open'.
    const env = wrapSuccess({ id: 'ISS-0145', status: 'open', title: 'x' });

    expect(env.ok).toBe(true);        // the marker survives
    expect(env.status).toBe('open');  // the domain value is preserved, as before
  });

  it('keeps ok:true when the payload status is literally "error"', () => {
    // The dangerous case: a successful call reporting a failed *thing* — a job
    // whose state is 'error'. This used to make the call itself look failed,
    // and mapped to HTTP 400.
    const env = wrapSuccess({ job_id: 'j1', status: 'error' });

    expect(env.ok).toBe(true);
    expect(envelopeFailed(env)).toBe(false);
    expect(envelopeHttpStatus(env)).toBe(200);
  });

  it('does not let a payload field named ok masquerade as the marker', () => {
    const env = wrapSuccess({ ok: false, note: 'domain field' });
    expect(env.ok).toBe(true);
  });
});

describe('wrapError', () => {
  it('sets both fields explicitly, so both are trustworthy', () => {
    const env = wrapError('issue not found', 'NOT_FOUND');
    expect(env.ok).toBe(false);
    expect(env.status).toBe('error');
    expect(env.error).toBe('issue not found');
    expect(env.code).toBe('NOT_FOUND');
  });

  it('omits code when not supplied', () => {
    expect(wrapError('boom').code).toBeUndefined();
  });
});

describe('envelopeFailed — dialect compatibility', () => {
  it('prefers ok when present', () => {
    expect(envelopeFailed({ ok: true, status: 'error' })).toBe(false);
    expect(envelopeFailed({ ok: false, status: 'open' })).toBe(true);
  });

  it('falls back to the old negative test for a runtime that predates ok', () => {
    expect(envelopeFailed({ status: 'error', error: 'x' })).toBe(true);
    expect(envelopeFailed({ status: 'executed', data: 1 })).toBe(false);
  });

  it('treats an old-runtime success carrying a domain status as success', () => {
    // Still wrong in the old dialect — unavoidable, and exactly why ok exists.
    // Pinned so the fallback's limits are visible rather than surprising.
    expect(envelopeFailed({ status: 'open' })).toBe(false);
  });
});

describe('envelopeHttpStatus', () => {
  it('400 only when the call itself failed', () => {
    expect(envelopeHttpStatus(wrapError('nope'))).toBe(400);
    expect(envelopeHttpStatus(wrapSuccess({}))).toBe(200);
    expect(envelopeHttpStatus(wrapSuccess({ status: 'error' }))).toBe(200);
  });
});

describe('sanitizeErrorMessage', () => {
  it('keeps the .decibel portion of a path, drops the prefix that leaks a home dir', () => {
    const out = sanitizeErrorMessage('ENOENT: /Users/ben/code/proj/.decibel/sentinel/issues');
    expect(out).toContain('.decibel/sentinel/issues');
    expect(out).not.toContain('/Users/ben');
  });

  it('redacts absolute paths', () => {
    expect(sanitizeErrorMessage('cannot read /var/log/app.log')).toBe('cannot read [path]');
  });

  it('leaves URLs alone', () => {
    const msg = 'daemon not reachable at http://localhost:4888';
    expect(sanitizeErrorMessage(msg)).toBe(msg);
  });
});
