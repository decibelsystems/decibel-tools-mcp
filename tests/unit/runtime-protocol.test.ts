import { describe, it, expect } from 'vitest';
import {
  RUNTIME_PROTOCOL_VERSION,
  parseProtocolVersion,
  isProtocolCompatible,
} from '../../src/runtime/protocol.js';

describe('parseProtocolVersion', () => {
  it('parses MAJOR.MINOR', () => {
    expect(parseProtocolVersion('1.0')).toEqual({ major: 1, minor: 0 });
    expect(parseProtocolVersion('12.34')).toEqual({ major: 12, minor: 34 });
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseProtocolVersion('  2.1  ')).toEqual({ major: 2, minor: 1 });
  });

  it('rejects anything that is not MAJOR.MINOR', () => {
    for (const bad of ['1', '1.0.0', 'v1.0', '1.x', '', 'abc', '1.']) {
      expect(parseProtocolVersion(bad), bad).toBeNull();
    }
  });
});

describe('isProtocolCompatible', () => {
  it('accepts an exact match', () => {
    expect(isProtocolCompatible('1.0', '1.0')).toEqual({ compatible: true });
  });

  it('accepts a newer minor on the server (minor bumps are additive)', () => {
    expect(isProtocolCompatible('1.5', '1.0')).toEqual({ compatible: true });
  });

  it('rejects an older minor on the server', () => {
    const result = isProtocolCompatible('1.0', '1.3');
    expect(result.compatible).toBe(false);
    expect(result.compatible === false && result.reason).toContain('runtime is older');
  });

  it('rejects a major mismatch in both directions', () => {
    const older = isProtocolCompatible('1.0', '2.0');
    const newer = isProtocolCompatible('2.0', '1.0');
    expect(older.compatible).toBe(false);
    expect(newer.compatible).toBe(false);
    expect(older.compatible === false && older.reason).toContain('major version mismatch');
    expect(newer.compatible === false && newer.reason).toContain('major version mismatch');
  });

  it('rejects a runtime that reports no protocol_version', () => {
    // A daemon predating protocol negotiation. We refuse rather than assume
    // the contract matches — that assumption is the whole failure mode.
    const result = isProtocolCompatible(undefined, '1.0');
    expect(result.compatible).toBe(false);
    expect(result.compatible === false && result.reason).toContain('did not report');
  });

  it('rejects an unparseable server version rather than guessing', () => {
    const result = isProtocolCompatible('garbage', '1.0');
    expect(result.compatible).toBe(false);
    expect(result.compatible === false && result.reason).toContain('unparseable');
  });

  it('defaults the client version to the compiled-in protocol', () => {
    expect(isProtocolCompatible(RUNTIME_PROTOCOL_VERSION)).toEqual({ compatible: true });
  });

  it('exports a well-formed protocol version', () => {
    expect(parseProtocolVersion(RUNTIME_PROTOCOL_VERSION)).not.toBeNull();
  });
});
