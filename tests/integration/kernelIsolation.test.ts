// One runtime serves every client. These tests pin the promise that makes
// that safe: nothing a single facade does can escape dispatch() as a rejected
// promise, and a facade whose dependency is wedged gets refused fast instead
// of holding a connection open for everyone else.
//
// The tests hijack a real tool's handler in the kernel's own toolMap rather
// than constructing a fake kernel — dispatch resolves handlers through that
// map at call time, so this exercises the real dispatch path, real facade
// resolution, and the real breaker wiring.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { createKernel, type ToolKernel } from '../../src/kernel.js';
import type { ToolSpec, ToolResult } from '../../src/tools/types.js';

const FACADE = 'friction';
const ACTION = 'list';
const TOOL = 'friction_list';

let kernel: ToolKernel;
let original: ToolSpec;

function textOf(result: ToolResult): Record<string, unknown> {
  const text = result.content.find((c) => c.type === 'text')?.text ?? '{}';
  return JSON.parse(text) as Record<string, unknown>;
}

/** Swap in a handler for `friction_list`, keeping its real definition. */
function stub(handler: ToolSpec['handler']): void {
  kernel.toolMap.set(TOOL, { ...original, handler });
}

beforeAll(async () => {
  kernel = await createKernel();
  original = kernel.toolMap.get(TOOL)!;
  expect(original).toBeDefined();
});

afterEach(() => {
  kernel.toolMap.set(TOOL, original);
  kernel.resetCircuit();
});

describe('dispatch error isolation', () => {
  it('turns a throwing handler into an error result, not a rejected promise', async () => {
    stub(async () => { throw new Error('handler exploded'); });

    const result = await kernel.dispatch(FACADE, { action: ACTION });

    expect(result.isError).toBe(true);
    expect(textOf(result).error).toBe('handler exploded');
    expect(textOf(result).facade).toBe(FACADE);
  });

  it('contains a handler that rejects with a non-Error', async () => {
    stub(async () => { throw 'a bare string'; });

    const result = await kernel.dispatch(FACADE, { action: ACTION });

    expect(result.isError).toBe(true);
    expect(textOf(result).error).toBe('a bare string');
  });

  it('contains a failure raised OUTSIDE the handler, before it is ever called', async () => {
    // A definition whose schema throws on read — stands in for any fault in
    // the dispatch machinery itself (param coercion, facade resolution).
    kernel.toolMap.set(TOOL, {
      ...original,
      definition: new Proxy(original.definition, {
        get(target, prop) {
          if (prop === 'inputSchema') throw new Error('schema is corrupt');
          return Reflect.get(target, prop);
        },
      }),
      handler: async () => { throw new Error('should never run'); },
    });

    const result = await kernel.dispatch(FACADE, { action: ACTION });

    expect(result.isError).toBe(true);
    expect(textOf(result).error).toBe('schema is corrupt');
    expect(textOf(result).dispatch_fault).toBe(true);
  });

  it('survives a dispatch listener that throws', async () => {
    // An SSE writer whose socket died mid-write is the real version of this.
    const boom = () => { throw new Error('listener exploded'); };
    kernel.on('dispatch', boom);
    kernel.on('result', boom);
    try {
      stub(async () => ({ content: [{ type: 'text', text: '{"ok":true}' }] }));

      const result = await kernel.dispatch(FACADE, { action: ACTION });

      expect(result.isError).toBeFalsy();
      expect(textOf(result).ok).toBe(true);
    } finally {
      kernel.off('dispatch', boom);
      kernel.off('result', boom);
    }
  });
});

describe('per-facade circuit breaker', () => {
  it('opens after repeated handler faults and refuses further calls fast', async () => {
    stub(async () => { throw new Error('ECONNREFUSED'); });

    for (let i = 0; i < 5; i++) {
      await kernel.dispatch(FACADE, { action: ACTION });
    }

    // Sixth call must not reach the handler at all.
    let reached = false;
    stub(async () => { reached = true; throw new Error('ECONNREFUSED'); });
    const refused = await kernel.dispatch(FACADE, { action: ACTION });

    expect(reached).toBe(false);
    expect(refused.isError).toBe(true);
    const body = textOf(refused);
    expect(body.circuit_open).toBe(true);
    expect(body.facade).toBe(FACADE);
    expect(body.last_error).toBe('ECONNREFUSED');
    expect(typeof body.retry_after_ms).toBe('number');
  });

  it('leaves every other facade reachable while one circuit is open', async () => {
    stub(async () => { throw new Error('ECONNREFUSED'); });
    for (let i = 0; i < 5; i++) await kernel.dispatch(FACADE, { action: ACTION });

    const other = await kernel.dispatch('registry', { action: 'list' });

    expect(textOf(other).circuit_open).toBeUndefined();
  });

  it('shares one circuit between a facade call and the direct tool call under it', async () => {
    stub(async () => { throw new Error('ECONNREFUSED'); });
    for (let i = 0; i < 5; i++) await kernel.dispatch(FACADE, { action: ACTION });

    const direct = await kernel.dispatch(TOOL, {});

    expect(textOf(direct).circuit_open).toBe(true);
  });

  it('does not open on ordinary fast validation errors', async () => {
    stub(async () => ({
      content: [{ type: 'text', text: JSON.stringify({ error: 'title is required' }) }],
      isError: true,
    }));

    for (let i = 0; i < 20; i++) await kernel.dispatch(FACADE, { action: ACTION });

    expect(kernel.circuitSnapshot()[FACADE]).toBeUndefined();
    const after = await kernel.dispatch(FACADE, { action: ACTION });
    expect(textOf(after).circuit_open).toBeUndefined();
  });

  it('reports the open circuit in the snapshot /health reads', async () => {
    expect(kernel.circuitSnapshot()).toEqual({});

    stub(async () => { throw new Error('pool is wedged'); });
    for (let i = 0; i < 5; i++) await kernel.dispatch(FACADE, { action: ACTION });

    expect(kernel.circuitSnapshot()[FACADE]).toMatchObject({
      state: 'open',
      consecutive_faults: 5,
      last_error: 'pool is wedged',
    });
  });
});

describe('project resolution annotation', () => {
  // A tool that resolves a project and returns a normal payload. The kernel
  // should leave it untouched on a real match and annotate it when the
  // resolver substituted a different project.
  function stubResolvingTool(): void {
    stub(async (args) => {
      const { resolveProjectPaths } = await import('../../src/projectRegistry.js');
      const resolved = resolveProjectPaths((args as { project_id?: string }).project_id);
      return { content: [{ type: 'text', text: JSON.stringify({ items: [], project: resolved.id }) }] };
    });
  }

  it('adds nothing when the project resolved exactly', async () => {
    stubResolvingTool();

    const result = await kernel.dispatch(FACADE, { action: ACTION, project_id: process.cwd() });

    expect(textOf(result).project_resolution).toBeUndefined();
  });

  it('warns the caller when a different project was served', async () => {
    const prev = process.env.DECIBEL_PROJECT_ROOT;
    process.env.DECIBEL_PROJECT_ROOT = process.cwd();
    stubResolvingTool();

    try {
      const result = await kernel.dispatch(FACADE, {
        action: ACTION,
        project_id: 'a-project-that-does-not-exist-anywhere',
      });

      const annotation = textOf(result).project_resolution as Record<string, unknown>;
      expect(annotation).toBeDefined();
      expect(annotation.matched).toBe(false);
      expect(annotation.requested).toBe('a-project-that-does-not-exist-anywhere');
      expect(annotation.strategy).toBe('env_root_fallback');
      // The payload itself survives — the annotation is additive.
      expect(textOf(result).items).toEqual([]);
    } finally {
      if (prev === undefined) delete process.env.DECIBEL_PROJECT_ROOT;
      else process.env.DECIBEL_PROJECT_ROOT = prev;
    }
  });
});
