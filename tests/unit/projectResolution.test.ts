// Project resolution is deliberately forgiving — seven strategies, the last
// two of which substitute a project the caller never asked for so that an
// interactive agent's typo doesn't hard-fail. The cost is that a wrong id
// returns another project's data wearing the requested name, which is
// misattribution rather than absence and is invisible in the payload.
//
// These tests pin what the resolver reports about its own behaviour. They do
// NOT assert that substitution is wrong — that is a separate decision — only
// that it is distinguishable from a real match.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import {
  withResolutionTracking,
  recordResolution,
  currentResolution,
} from '../../src/runtime/projectResolution.js';

describe('resolution tracking', () => {
  it('records nothing outside a tracked scope', () => {
    recordResolution('a', 'a', '/tmp/a', 'exact_id');
    expect(currentResolution()).toBeUndefined();
  });

  it('reports an exact match as matched', async () => {
    await withResolutionTracking(async () => {
      recordResolution('decibel-tools-mcp', 'decibel-tools-mcp', '/repo', 'exact_id');
      expect(currentResolution()).toMatchObject({
        requested: 'decibel-tools-mcp',
        resolvedId: 'decibel-tools-mcp',
        strategy: 'exact_id',
        matched: true,
      });
    });
  });

  it('reports an alias as matched — a different id, but the project the caller meant', async () => {
    await withResolutionTracking(async () => {
      recordResolution('dtm', 'decibel-tools-mcp', '/repo', 'alias');
      expect(currentResolution()?.matched).toBe(true);
    });
  });

  it('reports the cwd fallback as NOT matched', async () => {
    await withResolutionTracking(async () => {
      recordResolution('typo-project', 'decibel-tools-mcp', '/repo', 'cwd_fallback');
      const rec = currentResolution();
      expect(rec?.matched).toBe(false);
      expect(rec?.requested).toBe('typo-project');
      expect(rec?.resolvedId).toBe('decibel-tools-mcp');
    });
  });

  it('reports the env-root fallback as NOT matched even though the id comes back unchanged', async () => {
    // The subtle one: strategy 6 returns the REQUESTED id with a SUBSTITUTED
    // path, so a caller comparing ids sees a perfect match. Only the resolver
    // knows, which is the whole reason this record exists.
    await withResolutionTracking(async () => {
      recordResolution('some-other-project', 'some-other-project', '/env/root', 'env_root_fallback');
      const rec = currentResolution();
      expect(rec?.matched).toBe(false);
      expect(rec?.requested).toBe(rec?.resolvedId);
      expect(rec?.resolvedPath).toBe('/env/root');
    });
  });

  it('treats an omitted id as a match — nothing was substituted', async () => {
    await withResolutionTracking(async () => {
      recordResolution(undefined, 'default-project', '/def', 'default_project');
      expect(currentResolution()?.matched).toBe(true);
    });
  });

  it('keeps concurrent dispatches from seeing each other resolutions', async () => {
    // The daemon serves calls concurrently; a module-level "last resolution"
    // would report whichever call happened to finish nearest, under load.
    const [a, b] = await Promise.all([
      withResolutionTracking(async () => {
        recordResolution('alpha', 'alpha', '/a', 'exact_id');
        await new Promise((r) => setTimeout(r, 10));
        return currentResolution();
      }),
      withResolutionTracking(async () => {
        recordResolution('beta', 'gamma', '/g', 'cwd_fallback');
        return currentResolution();
      }),
    ]);

    expect(a?.resolvedId).toBe('alpha');
    expect(b?.resolvedId).toBe('gamma');
  });
});

describe('the real resolver populates the record', () => {
  let root: string;
  let prevEnv: string | undefined;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'decibel-resolve-'));
    await fs.mkdir(path.join(root, '.decibel'), { recursive: true });
    prevEnv = process.env.DECIBEL_PROJECT_ROOT;
  });

  afterEach(async () => {
    if (prevEnv === undefined) delete process.env.DECIBEL_PROJECT_ROOT;
    else process.env.DECIBEL_PROJECT_ROOT = prevEnv;
    await fs.rm(root, { recursive: true, force: true });
  });

  it('records an absolute-path resolution as matched', async () => {
    const { resolveProjectPaths } = await import('../../src/projectRegistry.js');

    const rec = await withResolutionTracking(async () => {
      resolveProjectPaths(root);
      return currentResolution();
    });

    expect(rec?.strategy).toBe('absolute_path');
    expect(rec?.matched).toBe(true);
  });

  it('records the env-root fallback when an unknown id is asked for', async () => {
    process.env.DECIBEL_PROJECT_ROOT = root;
    const { resolveProjectPaths } = await import('../../src/projectRegistry.js');

    const rec = await withResolutionTracking(async () => {
      resolveProjectPaths('a-project-that-does-not-exist-anywhere');
      return currentResolution();
    });

    expect(rec?.strategy).toBe('env_root_fallback');
    expect(rec?.matched).toBe(false);
    expect(rec?.resolvedPath).toBe(root);
  });
});
