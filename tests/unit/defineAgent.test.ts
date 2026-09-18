import { describe, it, expect } from 'vitest';
import { toMs } from '../../src/hq/defineAgent.js';

describe('defineAgent: toMs duration parser', () => {
  it('returns the fallback for undefined', () => {
    expect(toMs(undefined, 30_000)).toBe(30_000);
  });

  it('passes a raw number through unchanged (already ms)', () => {
    expect(toMs(5000, 30_000)).toBe(5000);
    expect(toMs(0, 30_000)).toBe(0);
  });

  it('parses seconds', () => {
    expect(toMs('30s', 1)).toBe(30_000);
    expect(toMs('1s', 1)).toBe(1000);
  });

  it('parses minutes', () => {
    expect(toMs('1m', 1)).toBe(60_000);
    expect(toMs('2m', 1)).toBe(120_000);
  });

  it('parses explicit ms', () => {
    expect(toMs('500ms', 1)).toBe(500);
  });

  it('treats a bare number string as seconds', () => {
    expect(toMs('30', 1)).toBe(30_000);
  });

  it('tolerates surrounding whitespace', () => {
    expect(toMs('  10s  ', 1)).toBe(10_000);
  });

  it('falls back on garbage input', () => {
    expect(toMs('soon', 999)).toBe(999);
    expect(toMs('5h', 999)).toBe(999); // hours unit not supported → fallback
    expect(toMs('', 999)).toBe(999);
  });
});
