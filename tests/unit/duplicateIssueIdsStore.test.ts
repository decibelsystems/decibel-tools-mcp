import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import {
  listIssuesForProject,
  getIssueById,
  updateIssue,
} from '../../src/sentinelIssues.js';
import {
  createTestContext,
  cleanupTestContext,
  TestContext,
} from '../utils/test-context.js';

vi.mock('../../src/projectPaths.js', () => ({
  resolveProjectRoot: vi.fn(),
}));

import { resolveProjectRoot } from '../../src/projectPaths.js';

/**
 * ISS-0131, second store. src/sentinelIssues.ts backs read_issue/update_issue
 * and had two defects of its own:
 *
 *   1. listIssuesForProject deduped by id and DROPPED the loser, so one of the
 *      two colliding issues was unreachable to read_issue entirely.
 *   2. updateIssue matched with a bare `basename.startsWith(id)` and `break`,
 *      so "ISS-011" matched ISS-0110/ISS-0112/ISS-0119 and wrote to whichever
 *      readdir yielded first.
 */

const yamlIssue = (id: string, title: string, status = 'open') =>
  [`id: ${id}`, `title: ${title}`, 'project: test-project', `status: ${status}`, ''].join('\n');

describe('duplicate issue ids — sentinelIssues store (ISS-0131)', () => {
  let ctx: TestContext;
  let issuesDir: string;

  beforeEach(async () => {
    ctx = await createTestContext();
    issuesDir = path.join(ctx.rootDir, '.decibel', 'sentinel', 'issues');
    await fs.mkdir(issuesDir, { recursive: true });

    vi.mocked(resolveProjectRoot).mockResolvedValue({
      projectId: 'test-project',
      projectName: 'Test Project',
      root: ctx.rootDir,
    });
  });

  afterEach(async () => {
    await cleanupTestContext(ctx);
    vi.resetAllMocks();
  });

  async function writeCollidingPair() {
    await fs.writeFile(
      path.join(issuesDir, 'ISS-0105-governor-timeout.yml'),
      yamlIssue('ISS-0105', 'Governor timeout on close_position'),
      'utf-8'
    );
    await fs.writeFile(
      path.join(issuesDir, 'ISS-0105-v3-bot-engine.yml'),
      yamlIssue('ISS-0105', 'v3 bot engine never updated position'),
      'utf-8'
    );
  }

  describe('listIssuesForProject', () => {
    it('keeps BOTH colliding issues instead of dropping the second', async () => {
      await writeCollidingPair();

      const issues = await listIssuesForProject('test-project');

      expect(issues).toHaveLength(2);
      expect(issues.map((i) => i.title).sort()).toEqual([
        'Governor timeout on close_position',
        'v3 bot engine never updated position',
      ]);
    });

    it('marks every member of the collision, not just the one seen second', async () => {
      await writeCollidingPair();

      const issues = await listIssuesForProject('test-project');

      expect(issues.every((i) => i.duplicate_id === true)).toBe(true);
    });

    it('does not mark issues whose ids are unique', async () => {
      await fs.writeFile(
        path.join(issuesDir, 'ISS-0200-lonely.yml'),
        yamlIssue('ISS-0200', 'A lonely issue'),
        'utf-8'
      );

      const issues = await listIssuesForProject('test-project');

      expect(issues[0].duplicate_id).toBeUndefined();
    });
  });

  describe('getIssueById', () => {
    it('refuses an ambiguous id rather than returning an arbitrary twin', async () => {
      await writeCollidingPair();

      await expect(getIssueById('test-project', 'ISS-0105')).rejects.toThrow(
        /AMBIGUOUS_ISSUE_ID/
      );
    });

    it('resolves by exact filename as the escape hatch', async () => {
      await writeCollidingPair();

      const issue = await getIssueById('test-project', 'ISS-0105-v3-bot-engine.yml');

      expect(issue?.title).toBe('v3 bot engine never updated position');
    });

    it('still resolves a unique id', async () => {
      await fs.writeFile(
        path.join(issuesDir, 'ISS-0200-lonely.yml'),
        yamlIssue('ISS-0200', 'A lonely issue'),
        'utf-8'
      );

      const issue = await getIssueById('test-project', 'ISS-0200');

      expect(issue?.title).toBe('A lonely issue');
    });
  });

  describe('updateIssue', () => {
    it('refuses to write when the id is ambiguous', async () => {
      await writeCollidingPair();

      await expect(
        updateIssue({ projectId: 'test-project', issueId: 'ISS-0105', status: 'done' })
      ).rejects.toThrow(/AMBIGUOUS_ISSUE_ID/);
    });

    it('leaves both files untouched when it refuses', async () => {
      await writeCollidingPair();
      const names = await fs.readdir(issuesDir);
      const before = await Promise.all(
        names.map((n) => fs.readFile(path.join(issuesDir, n), 'utf-8'))
      );

      await expect(
        updateIssue({ projectId: 'test-project', issueId: 'ISS-0105', status: 'done' })
      ).rejects.toThrow();

      const after = await Promise.all(
        names.map((n) => fs.readFile(path.join(issuesDir, n), 'utf-8'))
      );
      expect(after).toEqual(before);
    });

    it('does not let a partial id prefix match a longer, different id', async () => {
      // "ISS-011" is not an issue. It must not silently write to ISS-0110.
      await fs.writeFile(
        path.join(issuesDir, 'ISS-0110-oracle-bugs.yml'),
        yamlIssue('ISS-0110', 'Oracle reporting bugs'),
        'utf-8'
      );

      await expect(
        updateIssue({ projectId: 'test-project', issueId: 'ISS-011', status: 'done' })
      ).rejects.toThrow(/not found/i);

      const untouched = await fs.readFile(
        path.join(issuesDir, 'ISS-0110-oracle-bugs.yml'),
        'utf-8'
      );
      expect(untouched).toContain('status: open');
    });

    it('updates normally when the id is unique', async () => {
      await fs.writeFile(
        path.join(issuesDir, 'ISS-0200-lonely.yml'),
        yamlIssue('ISS-0200', 'A lonely issue'),
        'utf-8'
      );

      const result = await updateIssue({
        projectId: 'test-project',
        issueId: 'ISS-0200',
        status: 'done',
      });

      expect(result.status).toBe('done');
      expect(result.changes).toContain('status: open → done');
    });

    it('accepts an exact filename to target one twin precisely', async () => {
      await writeCollidingPair();

      const result = await updateIssue({
        projectId: 'test-project',
        issueId: 'ISS-0105-governor-timeout.yml',
        status: 'done',
      });

      expect(result.status).toBe('done');

      // The twin is untouched.
      const twin = await fs.readFile(
        path.join(issuesDir, 'ISS-0105-v3-bot-engine.yml'),
        'utf-8'
      );
      expect(twin).toContain('status: open');
    });
  });
});
