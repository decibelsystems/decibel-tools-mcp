// ============================================================================
// Run tracking is OFF by default — ISS-0148
// ============================================================================
// The capture was an experiment. Nothing consumes what it produces: 168 run
// directories in this project and not one has ever reached a terminal event,
// against ~100MB and a thousand-plus directories on a volume with a known
// small-file pathology.
//
// Two things are asserted, and the second is the one that matters in a year.
// That the default is off, and that turning it off makes the wrapper a PURE
// PASS-THROUGH — no run directory, no event write, no project resolution. A
// disabled feature that still does the expensive part of its work is the
// failure this change exists to remove, and it would be invisible: the runs
// would simply stop appearing while the cost stayed.
// ============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

let tmpHome: string;
const ORIGINAL_ENV = process.env.DECIBEL_VECTOR_TRACK_RUNS;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'decibel-vector-'));
  vi.spyOn(os, 'homedir').mockReturnValue(tmpHome);
  delete process.env.DECIBEL_VECTOR_TRACK_RUNS;
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  if (ORIGINAL_ENV === undefined) delete process.env.DECIBEL_VECTOR_TRACK_RUNS;
  else process.env.DECIBEL_VECTOR_TRACK_RUNS = ORIGINAL_ENV;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe('vector run tracking', () => {
  it('is declared in the config registry, so it is discoverable rather than folklore', async () => {
    const { CONFIG_SCHEMA } = await import('../../src/toolConfig.js');
    const defs = CONFIG_SCHEMA.vector;

    expect(defs).toBeDefined();
    const trackRuns = defs.find((d) => d.key === 'track_runs');
    expect(trackRuns).toBeDefined();
    // The switch lives in the same table as every other per-facade toggle,
    // rather than being a bespoke env var nobody can find.
    expect(trackRuns!.default).toBe(false);
    expect(trackRuns!.env).toBe('DECIBEL_VECTOR_TRACK_RUNS');
  });

  it('defaults to off', async () => {
    const { getToolConfig } = await import('../../src/toolConfig.js');
    const cfg = getToolConfig<{ track_runs?: boolean }>(undefined, 'vector');
    expect(cfg.track_runs).toBe(false);
  });

  it('can be turned back on by env, since the capture code is untouched', async () => {
    process.env.DECIBEL_VECTOR_TRACK_RUNS = 'true';
    const { getToolConfig } = await import('../../src/toolConfig.js');
    const cfg = getToolConfig<{ track_runs?: boolean }>(undefined, 'vector');
    expect(cfg.track_runs).toBe(true);
  });

  it('is a pure pass-through when disabled — no run dir, no events, result unchanged', async () => {
    const { withRunTracking, __resetRunTrackingCache } = await import(
      '../../src/tools/shared/runTracker.js'
    );
    __resetRunTrackingCache();

    const inner = vi.fn(async () => ({
      content: [{ type: 'text' as const, text: '{"ok":true}' }],
    }));
    const wrapped = withRunTracking(inner, {
      toolName: 'test_tool',
      getProjectId: () => 'decibel-tools-mcp',
    });

    const result = await wrapped({ project_id: 'decibel-tools-mcp' });

    // The handler still runs and its result is untouched.
    expect(inner).toHaveBeenCalledOnce();
    expect(result.content[0].text).toBe('{"ok":true}');

    // And nothing was written anywhere under the (temp) home.
    const runsDir = path.join(tmpHome, '.decibel', 'runs');
    expect(fs.existsSync(runsDir)).toBe(false);
  });

  it('still returns an error result unchanged when disabled', async () => {
    const { withRunTracking, __resetRunTrackingCache } = await import(
      '../../src/tools/shared/runTracker.js'
    );
    __resetRunTrackingCache();

    const wrapped = withRunTracking(
      async () => ({ content: [{ type: 'text' as const, text: 'boom' }], isError: true }),
      { toolName: 'test_tool', getProjectId: () => 'decibel-tools-mcp' }
    );

    const result = await wrapped({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('boom');
  });
});
