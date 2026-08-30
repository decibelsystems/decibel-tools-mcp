// The first content block of a tool result is the DATA block, and it must be
// parseable on every single call — not on fourteen calls out of fifteen.
//
// The bug this pins: the periodic feedback prompt was concatenated onto the
// JSON string, so every fifteenth response (and the first after thirty idle
// minutes) was not valid JSON. Agents tolerate trailing prose, so it looked
// harmless. Machines did not: HTTP /call fell back to stuffing the whole
// payload into a `message` string with no data keys at all, and FacadeClient's
// stdio transport would throw outright. HQ hit it in production and spent two
// diagnostic rounds on wrong causes before the shape was captured.
import { describe, it, expect } from 'vitest';
import { toolSuccess, toolError, trackToolUse } from '../../src/tools/shared/index.js';

/** The prompt fires on a counter; 30 calls guarantees we cross it at least once. */
const ENOUGH_CALLS_TO_TRIGGER_THE_PROMPT = 30;

describe('toolSuccess — the data block is always data', () => {
  it('returns parseable JSON in content[0] on every call, including the prompt call', () => {
    trackToolUse('provenance_list');

    const results = Array.from({ length: ENOUGH_CALLS_TO_TRIGGER_THE_PROMPT }, (_, i) =>
      toolSuccess({ events: [], total_count: i })
    );

    results.forEach((result, i) => {
      const text = result.content[0].text!;
      expect(() => JSON.parse(text), `call ${i} produced unparseable JSON: ${text.slice(-80)}`).not.toThrow();
      expect(JSON.parse(text).total_count).toBe(i);
    });
  });

  it('puts the feedback prompt in its own block rather than in the data', () => {
    trackToolUse('provenance_list');

    const results = Array.from({ length: ENOUGH_CALLS_TO_TRIGGER_THE_PROMPT }, () =>
      toolSuccess({ ok: 1 })
    );

    // The prompt fired at least once across 30 calls...
    const withPrompt = results.filter((r) => r.content.length > 1);
    expect(withPrompt.length).toBeGreaterThan(0);

    // ...and where it did, it is a separate block and the data block is clean.
    for (const result of withPrompt) {
      expect(result.content[1].text).toContain('Was this helpful?');
      expect(result.content[0].text).not.toContain('Was this helpful?');
      expect(JSON.parse(result.content[0].text!)).toEqual({ ok: 1 });
    }
  });

  it('never emits the separator that made the payload invalid', () => {
    trackToolUse('sentinel_list_issues');

    for (let i = 0; i < ENOUGH_CALLS_TO_TRIGGER_THE_PROMPT; i++) {
      expect(toolSuccess({ issues: [] }).content[0].text).not.toContain('\n---\n');
    }
  });
});

describe('toolError — same guarantee', () => {
  it('returns parseable JSON and marks the result as an error', () => {
    const result = toolError('issue not found', 'check the id');

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text!)).toEqual({
      success: false,
      error: 'issue not found',
      hint: 'check the id',
    });
  });
});
