import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createIssue as createViaFacadePath } from '../../src/tools/sentinel.js';
import { createIssue as createViaLegacyPath } from '../../src/sentinelIssues.js';
import { createTestContext, cleanupTestContext, TestContext } from '../utils/test-context.js';

/**
 * EPIC-0038 Phase 5 sequences behaviour before representation, because
 * converging the files while two writers ran would leave one of them
 * re-emitting the old format behind the migration.
 *
 * There were two. src/sentinelIssues.ts wrote .yml; src/tools/sentinel.ts
 * wrote .md — into the same directory, from the same ISS-NNNN space. The legacy
 * entry point is kept (the kernel dispatches raw tool names, so external
 * callers can still reach sentinel_createIssue) but it now delegates.
 */

describe('single issue writer', () => {
  let ctx: TestContext;
  let issuesDir: string;

  beforeEach(async () => {
    ctx = await createTestContext();
    issuesDir = path.join(ctx.rootDir, '.decibel', 'sentinel', 'issues');
  });
  afterEach(async () => { await cleanupTestContext(ctx); });

  it('both entry points write the same format', async () => {
    await createViaFacadePath({
      projectId: ctx.rootDir, severity: 'low', title: 'Via facade', details: 'x',
    });
    await createViaLegacyPath({
      projectId: ctx.rootDir, title: 'Via legacy', description: 'y',
    });

    const files = (await fs.readdir(issuesDir)).filter(f => /\.(md|yml|yaml)$/i.test(f));
    expect(files).toHaveLength(2);
    expect(files.every(f => f.endsWith('.md'))).toBe(true);
  });

  it('both entry points draw from one ISS-NNNN space without colliding', async () => {
    const a = await createViaLegacyPath({ projectId: ctx.rootDir, title: 'First' });
    const b = await createViaFacadePath({
      projectId: ctx.rootDir, severity: 'med', title: 'Second', details: 'x',
    });
    const c = await createViaLegacyPath({ projectId: ctx.rootDir, title: 'Third' });

    expect([a.id, (b as { id: string }).id, c.id]).toEqual(['ISS-0001', 'ISS-0002', 'ISS-0003']);
  });

  it('preserves the legacy return contract', async () => {
    const res = await createViaLegacyPath({
      projectId: ctx.rootDir,
      title: 'Contract check',
      description: 'The prose body.',
      epicId: 'EPIC-0001',
      priority: 'high',
      tags: ['a', 'b'],
    });

    // Every field this API returned before the redirect.
    expect(res.id).toBe('ISS-0001');
    expect(res.title).toBe('Contract check');
    expect(res.project).toBe(ctx.rootDir);
    expect(res.status).toBe('open');
    expect(res.priority).toBe('high');
    expect(res.epicId).toBe('EPIC-0001');
    expect(res.tags).toEqual(['a', 'b']);
    expect(res.description).toBe('The prose body.');
    expect(res.created_at).toBeDefined();
    expect(res.updated_at).toBeDefined();
    expect(res.filePath).toContain('ISS-0001-contract-check.md');
  });

  it('defaults severity rather than deriving it from priority', async () => {
    const res = await createViaLegacyPath({
      projectId: ctx.rootDir, title: 'No severity given', priority: 'high',
    });
    const raw = await fs.readFile(res.filePath, 'utf-8');
    // priority:'high' must not become severity:'high' — they answer different
    // questions.
    expect(raw).toMatch(/^severity:\s*med$/m);
    expect(raw).toMatch(/^priority:\s*high$/m);
  });

  it('accepts an explicit severity', async () => {
    const res = await createViaLegacyPath({
      projectId: ctx.rootDir, title: 'Explicit', severity: 'critical',
    });
    const raw = await fs.readFile(res.filePath, 'utf-8');
    expect(raw).toMatch(/^severity:\s*critical$/m);
  });
});
