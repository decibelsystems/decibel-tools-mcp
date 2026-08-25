import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { closeIssue, listRepoIssues } from '../../src/tools/sentinel.js';
import {
  createTestContext,
  cleanupTestContext,
  TestContext,
} from '../utils/test-context.js';

/**
 * ISS-0131: two records claiming one ISS-NNNN id used to resolve in fs.readdir
 * order. Every writer therefore had an undefined target — it edited one issue,
 * left its twin untouched, and returned success either way.
 *
 * The observable contract these tests pin down:
 *   - an ambiguous id is REFUSED, not guessed
 *   - the refusal names the candidates, because each filename is itself a
 *     usable unambiguous id (the escape hatch)
 *   - refusing writes NOTHING to either file
 *   - list_issues reports the collision instead of letting it stay invisible
 */

const issueFile = (id: string, title: string, status = 'open') =>
  [
    '---',
    `id: ${id}`,
    'projectId: my-repo',
    'severity: high',
    `status: ${status}`,
    'created_at: 2026-08-20T04:24:50.842Z',
    '---',
    '',
    `# ${title}`,
    '',
    '**Severity:** high',
    `**Status:** ${status}`,
    '',
    '## Details',
    '',
    `Details for ${title}`,
    '',
  ].join('\n');

describe('duplicate issue ids (ISS-0131)', () => {
  let ctx: TestContext;
  let issuesDir: string;

  beforeEach(async () => {
    ctx = await createTestContext();
    issuesDir = path.join(ctx.rootDir, '.decibel', 'sentinel', 'issues');
    await fs.mkdir(issuesDir, { recursive: true });
  });

  afterEach(async () => {
    await cleanupTestContext(ctx);
    vi.resetAllMocks();
  });

  /** Write the real-world shape: two DIFFERENT issues sharing one id. */
  async function writeCollidingPair() {
    await fs.writeFile(
      path.join(issuesDir, 'ISS-0105-governor-timeout-on-close-position.md'),
      issueFile('ISS-0105', 'Governor timeout on close_position causes SL/TP exits to fail'),
      'utf-8'
    );
    await fs.writeFile(
      path.join(issuesDir, 'ISS-0105-v3-bot-engine-never-updated-position.md'),
      issueFile('ISS-0105', 'v3 bot engine never updated position, risks DB on close'),
      'utf-8'
    );
  }

  describe('closeIssue', () => {
    it('refuses an ambiguous id instead of picking one in readdir order', async () => {
      await writeCollidingPair();

      const result = await closeIssue({
        projectId: 'my-repo',
        issue_id: 'ISS-0105',
        resolution: 'should never be written',
      });

      expect(result).toMatchObject({ error: 'AMBIGUOUS_ISSUE_ID', issue_id: 'ISS-0105' });
    });

    it('names both candidates so the caller can retry unambiguously', async () => {
      await writeCollidingPair();

      const result = (await closeIssue({
        projectId: 'my-repo',
        issue_id: 'ISS-0105',
      })) as { candidates: string[] };

      expect(result.candidates).toHaveLength(2);
      expect(result.candidates).toEqual(
        expect.arrayContaining([
          'ISS-0105-governor-timeout-on-close-position.md',
          'ISS-0105-v3-bot-engine-never-updated-position.md',
        ])
      );
    });

    it('leaves BOTH files byte-identical when it refuses', async () => {
      await writeCollidingPair();
      const names = await fs.readdir(issuesDir);
      const before = await Promise.all(
        names.map((n) => fs.readFile(path.join(issuesDir, n), 'utf-8'))
      );

      await closeIssue({
        projectId: 'my-repo',
        issue_id: 'ISS-0105',
        resolution: 'must not land anywhere',
      });

      const after = await Promise.all(
        names.map((n) => fs.readFile(path.join(issuesDir, n), 'utf-8'))
      );
      expect(after).toEqual(before);
    });

    it('accepts an exact filename as the way out of the ambiguity', async () => {
      await writeCollidingPair();

      const result = await closeIssue({
        projectId: 'my-repo',
        issue_id: 'ISS-0105-governor-timeout-on-close-position.md',
        resolution: 'Fixed the governor timeout',
      });

      expect(result).not.toHaveProperty('error');
      expect(result).toMatchObject({ status: 'closed' });

      // The named file closed; its twin is untouched.
      const closed = await fs.readFile(
        path.join(issuesDir, 'ISS-0105-governor-timeout-on-close-position.md'),
        'utf-8'
      );
      const twin = await fs.readFile(
        path.join(issuesDir, 'ISS-0105-v3-bot-engine-never-updated-position.md'),
        'utf-8'
      );
      expect(closed).toContain('status: closed');
      expect(twin).toContain('status: open');
    });

    it('still closes normally when the id is unique', async () => {
      await fs.writeFile(
        path.join(issuesDir, 'ISS-0200-a-lonely-issue.md'),
        issueFile('ISS-0200', 'A lonely issue'),
        'utf-8'
      );

      const result = await closeIssue({ projectId: 'my-repo', issue_id: 'ISS-0200' });

      expect(result).not.toHaveProperty('error');
      expect(result).toMatchObject({ id: 'ISS-0200', status: 'closed' });
    });

    it('reports NOT_FOUND, not ambiguity, when nothing matches', async () => {
      await writeCollidingPair();

      const result = await closeIssue({ projectId: 'my-repo', issue_id: 'ISS-9999' });

      expect(result).toMatchObject({ error: 'ISSUE_NOT_FOUND' });
    });

    it('refuses a fuzzy id that spans several distinct issues', async () => {
      // "ISS-011" is a prefix of three different ids. The old fuzzy `includes`
      // match returned whichever came first.
      for (const [id, title] of [
        ['ISS-0110', 'Oracle reporting bugs'],
        ['ISS-0112', 'Array parameters serialized as strings'],
        ['ISS-0119', 'Marketing site copy boxes'],
      ]) {
        await fs.writeFile(
          path.join(issuesDir, `${id}-${title.toLowerCase().replace(/\s+/g, '-')}.md`),
          issueFile(id, title),
          'utf-8'
        );
      }

      const result = await closeIssue({ projectId: 'my-repo', issue_id: 'ISS-011' });

      expect(result).toMatchObject({ error: 'AMBIGUOUS_ISSUE_ID' });
      expect((result as { candidates: string[] }).candidates).toHaveLength(3);
    });
  });

  describe('listRepoIssues', () => {
    it('reports colliding ids with the files that claim them', async () => {
      await writeCollidingPair();
      await fs.writeFile(
        path.join(issuesDir, 'ISS-0200-a-lonely-issue.md'),
        issueFile('ISS-0200', 'A lonely issue'),
        'utf-8'
      );

      const result = await listRepoIssues({ projectId: 'my-repo' });

      expect(result).toMatchObject({ duplicate_ids: 1 });
      expect((result as { duplicate_id_files: Record<string, string[]> }).duplicate_id_files[
        'ISS-0105'
      ]).toHaveLength(2);
    });

    it('omits the duplicate report entirely when ids are clean', async () => {
      await fs.writeFile(
        path.join(issuesDir, 'ISS-0200-a-lonely-issue.md'),
        issueFile('ISS-0200', 'A lonely issue'),
        'utf-8'
      );

      const result = await listRepoIssues({ projectId: 'my-repo' });

      expect(result).not.toHaveProperty('duplicate_ids');
    });

    it('still reports a collision when a status filter hides one twin', async () => {
      // A closed twin keeps the id ambiguous for writers, so filtering it out
      // of the LIST must not filter it out of the COLLISION REPORT.
      await fs.writeFile(
        path.join(issuesDir, 'ISS-0105-governor-timeout-on-close-position.md'),
        issueFile('ISS-0105', 'Governor timeout', 'open'),
        'utf-8'
      );
      await fs.writeFile(
        path.join(issuesDir, 'ISS-0105-v3-bot-engine-never-updated-position.md'),
        issueFile('ISS-0105', 'v3 bot engine', 'closed'),
        'utf-8'
      );

      const result = await listRepoIssues({ projectId: 'my-repo', status: 'open' });

      expect(result.issues).toHaveLength(1);
      expect(result).toMatchObject({ duplicate_ids: 1 });
    });
  });
});
