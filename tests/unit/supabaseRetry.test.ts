import { describe, it, expect } from 'vitest';
import { isTransientNetworkError, withRetry, withRetryResult } from '../../src/supabaseRetry.js';

describe('supabaseRetry', () => {
  describe('isTransientNetworkError', () => {
    it('flags fetch-failed / connection blips', () => {
      expect(isTransientNetworkError(new Error('TypeError: fetch failed'))).toBe(true);
      expect(isTransientNetworkError(new Error('ECONNRESET'))).toBe(true);
      expect(isTransientNetworkError(new Error('socket hang up'))).toBe(true);
      expect(isTransientNetworkError('ETIMEDOUT')).toBe(true);
    });
    it('does NOT flag application errors', () => {
      expect(isTransientNetworkError(new Error('duplicate key value'))).toBe(false);
      expect(isTransientNetworkError(new Error('permission denied'))).toBe(false);
      expect(isTransientNetworkError(null)).toBe(false);
      expect(isTransientNetworkError(undefined)).toBe(false);
    });
  });

  describe('withRetry', () => {
    it('returns on first success without retrying', async () => {
      let calls = 0;
      const r = await withRetry(async () => { calls++; return 'ok'; }, 'test', 1);
      expect(r).toBe('ok');
      expect(calls).toBe(1);
    });
    it('retries ONCE on a transient error then succeeds', async () => {
      let calls = 0;
      const r = await withRetry(async () => {
        calls++;
        if (calls === 1) throw new Error('fetch failed');
        return 'recovered';
      }, 'test', 1);
      expect(r).toBe('recovered');
      expect(calls).toBe(2);
    });
    it('throws non-transient errors immediately (no retry)', async () => {
      let calls = 0;
      await expect(withRetry(async () => { calls++; throw new Error('permission denied'); }, 'test', 1))
        .rejects.toThrow('permission denied');
      expect(calls).toBe(1);
    });
    it('gives up after one retry on persistent transient failure', async () => {
      let calls = 0;
      await expect(withRetry(async () => { calls++; throw new Error('fetch failed'); }, 'test', 1))
        .rejects.toThrow('fetch failed');
      expect(calls).toBe(2); // original + 1 retry
    });
  });

  describe('withRetryResult', () => {
    it('passes through a successful {data,error}', async () => {
      const r = await withRetryResult(async () => ({ data: [1, 2], error: null }), 'test', 1);
      expect(r).toEqual({ data: [1, 2], error: null });
    });
    it('retries once when the resolved error is transient', async () => {
      let calls = 0;
      const r = await withRetryResult(async () => {
        calls++;
        return calls === 1
          ? { data: null, error: { message: 'fetch failed' } }
          : { data: ['ok'], error: null };
      }, 'test', 1);
      expect(r.data).toEqual(['ok']);
      expect(calls).toBe(2);
    });
    it('does NOT retry a non-transient resolved error', async () => {
      let calls = 0;
      const r = await withRetryResult(async () => {
        calls++;
        return { data: null, error: { message: 'duplicate key' } };
      }, 'test', 1);
      expect(r.error?.message).toBe('duplicate key');
      expect(calls).toBe(1);
    });
  });
});
