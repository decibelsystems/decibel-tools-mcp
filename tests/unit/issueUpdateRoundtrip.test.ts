// Regression tests for decibel-bug-report.md:
// `update_issue` used to rewrite markdown-frontmatter issues as bare YAML,
// dropping the `---` delimiters, the `# Title` heading, and the body — making
// the issue invisible to `list_issues`. And `read_issue` couldn't see
// markdown-format issues at all (its lister required id:/title: YAML keys).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import { createIssue, listRepoIssues } from '../../src/tools/sentinel.js';
import { updateIssue, getIssueById } from '../../src/sentinelIssues.js';
import {
  createTestContext,
  cleanupTestContext,
  TestContext,
} from '../utils/test-context.js';

describe('issue update roundtrip (markdown format preservation)', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext();
  });

  afterEach(async () => {
    await cleanupTestContext(ctx);
  });

  async function createMarkdownIssue() {
    const result = await createIssue({
      projectId: 'test-project',
      severity: 'high',
      title: 'Roundtrip survivor',
      details: 'This body must survive update_issue.',
    });
    if (!('id' in result)) throw new Error('createIssue failed: ' + JSON.stringify(result));
    return result;
  }

  it('create → update → list still returns the issue with its original title', async () => {
    const created = await createMarkdownIssue();

    await updateIssue({
      projectId: 'test-project',
      issueId: created.id,
      status: 'in_progress',
      note: 'progress note',
    });

    const listed = await listRepoIssues({ projectId: 'test-project' });
    if (!('issues' in listed)) throw new Error('listRepoIssues failed');
    const found = listed.issues.find((i) => i.title === 'Roundtrip survivor');
    expect(found).toBeDefined();
    expect(found!.status).toBe('in_progress');
    expect(listed.malformed).toBeUndefined();
  });

  it('update preserves ---, the # Title heading, and the body on disk', async () => {
    const created = await createMarkdownIssue();

    await updateIssue({
      projectId: 'test-project',
      issueId: created.id,
      note: 'appended note',
    });

    const content = await fs.readFile(created.path, 'utf-8');
    expect(content.startsWith('---\n')).toBe(true);
    expect(content).toMatch(/\n---\n/);
    expect(content).toContain('# Roundtrip survivor');
    expect(content).toContain('This body must survive update_issue.');
    expect(content).toContain('appended note');
    // Body must not be folded into a description: frontmatter scalar
    const frontmatter = content.match(/^---\n([\s\S]*?)\n---/)![1];
    expect(frontmatter).not.toContain('description:');
  });

  it('read_issue (getIssueById) finds markdown issues, with or without .md suffix', async () => {
    const created = await createMarkdownIssue();
    const filename = created.path.split('/').pop()!;

    const byFilename = await getIssueById('test-project', filename);
    expect(byFilename).not.toBeNull();
    expect(byFilename!.title).toBe('Roundtrip survivor');

    const withoutMd = await getIssueById('test-project', filename.replace(/\.md$/, ''));
    expect(withoutMd).not.toBeNull();
  });

  it('list_issues reports malformed files instead of silently skipping them', async () => {
    const created = await createMarkdownIssue();
    const issuesDir = created.path.slice(0, created.path.lastIndexOf('/'));
    await fs.writeFile(`${issuesDir}/broken.md`, '{{{ not: yaml: at: all', 'utf-8');

    const listed = await listRepoIssues({ projectId: 'test-project' });
    if (!('issues' in listed)) throw new Error('listRepoIssues failed');
    expect(listed.malformed).toBe(1);
    expect(listed.malformed_files).toEqual(['broken.md']);
  });
});
