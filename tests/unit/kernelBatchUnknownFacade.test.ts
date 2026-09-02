// /batch must not report a facade that does not exist as a success.
//
// Found by the decibel-hq peer reviewing EPIC-0038 Phase 7. `/call` already
// failed loudly for an unknown tool, but `/batch` wrapped the same condition in
// {status: 'executed', ok: true} with the failure surviving only as
// result.isError plus prose inside a text node. /batch is the higher-traffic
// path — it is what the SessionStart hook and every four-facade init call use.
//
// This matters more since Phase 7 made the registered facade set
// machine-dependent: "this extension is not installed here" must not look like
// "this query returned nothing", which is exactly the failure that let a dead
// voice inbox render as "voice 0" for five and a half hours.
import { describe, it, expect, beforeAll } from 'vitest';
import { createKernel, type ToolKernel } from '../../src/kernel.js';

let kernel: ToolKernel;

beforeAll(async () => {
  kernel = await createKernel();
});

describe('kernel.batch — unknown facades are structural failures', () => {
  it('flags an unregistered facade with a code instead of dispatching', async () => {
    const [result] = await kernel.batch([{ facade: 'definitely_not_a_facade', action: 'noop' }]);

    expect(result.code).toBe('UNKNOWN_FACADE');
    expect(result.error).toContain('definitely_not_a_facade');
    // It must not have run: no tool result at all, rather than a result that
    // happens to carry isError.
    expect(result.result).toBeUndefined();
  });

  it('accepts a raw internal tool name, which dispatch also accepts', async () => {
    // sentinel_createIssue is absent from facades/definitions.ts but reachable
    // by raw name through toolMap. If the structural check only consulted
    // facadeMap it would reject a call that dispatch would have served.
    expect(kernel.toolMap.has('sentinel_createIssue')).toBe(true);
    const [result] = await kernel.batch([{ facade: 'sentinel_createIssue', action: 'noop' }]);
    expect(result.code).toBeUndefined();
  });

  it('leaves a registered facade unflagged even when the action fails', async () => {
    // The distinction the code field exists to preserve: this call reached a
    // real facade and failed there. That is a normal batch outcome and must not
    // be reported the same way as a missing facade.
    const [result] = await kernel.batch([
      { facade: 'sentinel', action: 'no_such_action_at_all' },
    ]);

    expect(result.code).toBeUndefined();
    expect(result.result?.isError ?? Boolean(result.error)).toBe(true);
  });

  it('flags only the unknown call in a mixed batch, leaving the rest intact', async () => {
    const results = await kernel.batch([
      { facade: 'nope_not_here', action: 'noop' },
      { facade: 'registry', action: 'list' },
    ]);

    expect(results[0].code).toBe('UNKNOWN_FACADE');
    expect(results[1].code).toBeUndefined();
    expect(results[1].result).toBeDefined();
  });
});
