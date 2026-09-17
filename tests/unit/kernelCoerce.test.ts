import { describe, it, expect } from 'vitest';
import { coerceParams } from '../../src/kernel.js';

const schema = {
  properties: {
    tags: { type: 'array', items: { type: 'string' } },
    meta: { type: 'object' },
    title: { type: 'string' },
    maybe: { type: ['array', 'null'] },
  },
};

describe('coerceParams', () => {
  it('parses JSON-encoded arrays and objects for array/object params', () => {
    const out = coerceParams({ tags: '["a","b"]', meta: '{"k":1}', maybe: '[1]' }, schema);
    expect(out.tags).toEqual(['a', 'b']);
    expect(out.meta).toEqual({ k: 1 });
    expect(out.maybe).toEqual([1]);
  });

  it('leaves real arrays, string params, and non-JSON strings untouched', () => {
    const out = coerceParams({ tags: ['x'], title: '["not","coerced"]', meta: 'plain' }, schema);
    expect(out.tags).toEqual(['x']);
    expect(out.title).toBe('["not","coerced"]');
    expect(out.meta).toBe('plain');
  });

  it('leaves malformed JSON alone for handler validation', () => {
    expect(coerceParams({ tags: '["a",' }, schema).tags).toBe('["a",');
  });

  it('no-ops without a schema', () => {
    expect(coerceParams({ tags: '["a"]' }, undefined).tags).toBe('["a"]');
  });
});
