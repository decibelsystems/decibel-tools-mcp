// The canonical payload is validated at the tool boundary.
//
// EPIC-0020's stated invariant is "the canonical payload is the truth,
// renderers are only views." That invariant was unenforced: a correct zod
// schema existed but lived inside registerAgenticTools(), an McpServer
// registration function that stopped being called when server.ts was split into
// modules (ISS-0029). It typechecked and imported cleanly and validated
// nothing. For ~7.7 months and 98k dispatch events, a payload with role
// "NotARealRole", load "PURPLE" and confidence 47 rendered successfully behind
// an ok:true envelope.
//
// These tests exist so that cannot recur silently: they assert against the LIVE
// handler, not against the schema in isolation. A schema with no caller is
// exactly the bug being fixed, so testing it directly would reproduce it.
import { describe, it, expect } from 'vitest';
import { modularTools } from '../../src/tools/index.js';
import { validateCanonicalPayload } from '../../src/agentic/types.js';

// Deliberately reached through the aggregator rather than by importing
// src/tools/agentic/index.js directly. agentQueue.ts statically imports
// createKernel, so tools/agentic -> kernel -> tools/index -> tools/agentic is a
// cycle; production never trips it because tools/index.ts is always the entry
// point, but a test that imports the submodule first gets a half-initialised
// module and "agenticTools is not iterable".
const renderTool = modularTools.find(t => t.definition.name === 'agentic_render')!;
const lintTool = modularTools.find(t => t.definition.name === 'agentic_lint')!;

/** A payload that satisfies every constraint. */
function validPayload() {
  return {
    role: 'Sensor',
    status: 'OK',
    load: 'GREEN',
    summary: 'all clear',
    evidence: [{ source: 'probe', value: 1, confidence: 0.9 }],
    missing_data: [],
    metadata: { pack_id: 'p', pack_hash: 'h', created_at: '2026-09-01T00:00:00Z' },
  };
}

describe('validateCanonicalPayload', () => {
  it('accepts a well-formed payload', () => {
    expect(validateCanonicalPayload(validPayload())).toEqual([]);
  });

  it.each([
    ['role', { role: 'NotARealRole' }],
    ['status', { status: 'BANANA' }],
    ['load', { load: 'PURPLE' }],
  ])('rejects an out-of-vocabulary %s', (field, override) => {
    const errors = validateCanonicalPayload({ ...validPayload(), ...override });
    expect(errors.join(' ')).toContain(field);
  });

  it('rejects a confidence outside 0..1 rather than clamping it', () => {
    const errors = validateCanonicalPayload({
      ...validPayload(),
      evidence: [{ source: 's', value: 1, confidence: 47 }],
    });
    // Rejecting matters more than the message: silently clamping to 1 would
    // make the "canonical payload is the truth" invariant lossy in the one
    // place it is enforced.
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join(' ')).toContain('confidence');
  });

  it('rejects an invented missing_data severity', () => {
    const errors = validateCanonicalPayload({
      ...validPayload(),
      missing_data: [{ field: 'f', reason: 'r', severity: 'totally-bogus' }],
    });
    expect(errors.join(' ')).toContain('severity');
  });

  it('names the failing path so the caller can find it', () => {
    const errors = validateCanonicalPayload({
      ...validPayload(),
      evidence: [{ source: 's', value: 1, confidence: 47 }],
    });
    expect(errors[0]).toMatch(/^evidence\.0\.confidence:/);
  });
});

describe('agentic_render rejects malformed payloads at the tool boundary', () => {
  it('refuses the payload that used to render successfully', async () => {
    const result = await renderTool.handler({
      renderer_id: 'default',
      payload: {
        role: 'NotARealRole',
        status: 'BANANA',
        load: 'PURPLE',
        summary: 'x',
        evidence: [{ source: 's', value: 1, confidence: 47 }],
        missing_data: [{ field: 'f', reason: 'r', severity: 'totally-bogus' }],
        metadata: { pack_id: 'p', pack_hash: 'h', created_at: 'now' },
      },
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Invalid canonical payload');
  });

  it('still refuses a missing payload, as it always did', async () => {
    const result = await renderTool.handler({ renderer_id: 'default' });
    expect(result.isError).toBe(true);
  });
});

describe('agentic_lint validates payload only when one is supplied', () => {
  // payload is documented as optional on this tool — it is used for consistency
  // checks. Validating an absent payload would break that contract, so absence
  // and malformedness must be treated differently.
  it('does not reject a call that omits the optional payload', async () => {
    const result = await lintTool.handler({ rendered: 'some text', renderer_id: 'default' });
    const text = result.content[0].text;
    expect(text).not.toContain('Invalid canonical payload');
  });

  it('rejects a supplied payload that is malformed', async () => {
    const result = await lintTool.handler({
      rendered: 'some text',
      renderer_id: 'default',
      payload: { ...validPayload(), status: 'BANANA' },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Invalid canonical payload');
  });
});
