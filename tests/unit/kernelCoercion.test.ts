import { describe, it, expect } from 'vitest';
import { coerceStringifiedParams } from '../../src/kernel.js';

const schema = {
  type: 'object' as const,
  properties: {
    session_id: { type: 'string' },
    technique: { type: 'string' },
    input: { type: 'object', description: 'Technique-specific input.' },
    tags: { type: 'array', items: { type: 'string' } },
    flexible: { type: ['string', 'object'] },
    count: { type: 'number' },
  },
  required: ['session_id', 'technique', 'input'],
};

describe('coerceStringifiedParams (ISS-0112 / ISS-0116)', () => {
  it('parses a JSON-stringified object param declared as object', () => {
    const params = {
      session_id: 'LAT-1',
      technique: 'challenge',
      input: '{"assumption":"a","why_exists":"b","what_if_false":"c","alternative_framing":"d"}',
    };
    const out = coerceStringifiedParams(params, schema);
    expect(out.input).toEqual({
      assumption: 'a',
      why_exists: 'b',
      what_if_false: 'c',
      alternative_framing: 'd',
    });
  });

  it('parses a JSON-stringified array param declared as array', () => {
    const out = coerceStringifiedParams({ tags: '["ui","tokens"]' }, schema);
    expect(out.tags).toEqual(['ui', 'tokens']);
  });

  it('leaves object params that are already objects untouched', () => {
    const input = { assumption: 'a' };
    const out = coerceStringifiedParams({ input }, schema);
    expect(out.input).toBe(input);
  });

  it('leaves string params declared as string untouched', () => {
    const out = coerceStringifiedParams({ session_id: '{"sneaky":true}' }, schema);
    expect(out.session_id).toBe('{"sneaky":true}');
  });

  it('does not coerce when the schema also allows string', () => {
    const out = coerceStringifiedParams({ flexible: '{"a":1}' }, schema);
    expect(out.flexible).toBe('{"a":1}');
  });

  it('leaves invalid JSON untouched for the tool to reject', () => {
    const out = coerceStringifiedParams({ input: '{not valid json' }, schema);
    expect(out.input).toBe('{not valid json');
  });

  it('rejects type mismatches — array JSON into an object param stays a string', () => {
    const out = coerceStringifiedParams({ input: '["a","b"]' }, schema);
    expect(out.input).toBe('["a","b"]');
  });

  it('rejects JSON scalars — "null" and "123" stay strings', () => {
    const out = coerceStringifiedParams({ input: 'null', tags: '123' }, schema);
    expect(out.input).toBe('null');
    expect(out.tags).toBe('123');
  });

  it('ignores params not present in the schema', () => {
    const out = coerceStringifiedParams({ extra: '{"a":1}' }, schema);
    expect(out.extra).toBe('{"a":1}');
  });

  it('handles surrounding whitespace in stringified values', () => {
    const out = coerceStringifiedParams({ input: '  {"a":1}\n' }, schema);
    expect(out.input).toEqual({ a: 1 });
  });

  it('returns the same object reference when nothing needs coercion', () => {
    const params = { session_id: 'x', count: 3 };
    expect(coerceStringifiedParams(params, schema)).toBe(params);
  });

  it('does not mutate the input params object', () => {
    const params = { input: '{"a":1}' };
    const out = coerceStringifiedParams(params, schema);
    expect(params.input).toBe('{"a":1}');
    expect(out).not.toBe(params);
  });

  it('tolerates a schema with no properties', () => {
    const params = { input: '{"a":1}' };
    const bare = { type: 'object' as const, properties: undefined as never };
    expect(coerceStringifiedParams(params, bare)).toBe(params);
  });
});
