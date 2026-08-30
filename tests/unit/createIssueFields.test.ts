import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import { createIssue, listRepoIssues } from '../../src/tools/sentinel.js';
import { createTestContext, cleanupTestContext, TestContext } from '../utils/test-context.js';

/**
 * create_issue forwarded only title/details/severity/epicId/project to
 * repo.create, though CreateIssueSpec and the canonical Issue model have
 * carried `priority` and `tags` all along. Because the MCP input schema allows
 * additional properties, a caller could pass priority:'high' and get a success
 * envelope back with the value silently gone. ISS-0149 was filed with
 * priority:'low' during the session that found this and landed without one.
 */

describe('createIssue field forwarding', () => {
  let ctx: TestContext;

  beforeEach(async () => { ctx = await createTestContext(); });
  afterEach(async () => { await cleanupTestContext(ctx); });

  const create = (extra: Record<string, unknown> = {}) =>
    createIssue({
      projectId: ctx.rootDir,
      severity: 'low',
      title: 'A tracked problem',
      details: 'Some detail.',
      ...extra,
    } as Parameters<typeof createIssue>[0]);

  it('persists priority instead of dropping it', async () => {
    const res = await create({ priority: 'high' });
    const raw = await fs.readFile((res as { path: string }).path, 'utf-8');
    expect(raw).toMatch(/^priority:\s*high$/m);
  });

  it('persists tags instead of dropping them', async () => {
    const res = await create({ tags: ['runtime', 'storage'] });
    const raw = await fs.readFile((res as { path: string }).path, 'utf-8');
    expect(raw).toContain('runtime');
    expect(raw).toContain('storage');
  });

  it('surfaces the priority through list_issues', async () => {
    await create({ priority: 'high' });
    const res = await listRepoIssues({ projectId: ctx.rootDir });
    const issues = (res as { issues: Array<{ priority?: string }> }).issues;
    expect(issues).toHaveLength(1);
    expect(issues[0].priority).toBe('high');
  });

  it('still works when neither is supplied', async () => {
    const res = await create();
    expect(res).toHaveProperty('id');
    const raw = await fs.readFile((res as { path: string }).path, 'utf-8');
    expect(raw).toMatch(/^severity:\s*low$/m);
    // Absent, not written as the string "undefined".
    expect(raw).not.toMatch(/undefined/);
  });

  it('keeps severity and priority as distinct fields', async () => {
    const res = await create({ severity: 'critical', priority: 'low' });
    const raw = await fs.readFile((res as { path: string }).path, 'utf-8');
    expect(raw).toMatch(/^severity:\s*critical$/m);
    expect(raw).toMatch(/^priority:\s*low$/m);
  });
});
