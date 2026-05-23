import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { parse as parseYaml } from 'yaml';
import {
  createIssue,
  listRepoIssues,
  logEpic,
  listEpics,
  getEpic,
  getEpicIssues,
  resolveEpic,
} from '../../src/tools/sentinel.js';
import {
  createTestContext,
  cleanupTestContext,
  readFileWithFrontmatter,
  TestContext,
} from '../utils/test-context.js';
import '../utils/matchers.js';

describe('Sentinel Tool', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext();
  });

  afterEach(async () => {
    await cleanupTestContext(ctx);
  });

  // ==========================================================================
  // Issue Tests
  // ==========================================================================

  describe('createIssue', () => {
    it('should create an issue markdown file', async () => {
      const result = await createIssue({
        projectId: 'my-repo',
        severity: 'high',
        title: 'Memory leak detected',
        details: 'Process memory grows unbounded',
      });

      // Issue IDs migrated from ISO-timestamp filenames to sequential
      // ISS-NNNN labels in PR #8 (feat: ISS-NNNN issue IDs in sentinel).
      // The filename on disk follows ISS-NNNN-<slug>.md.
      expect(result.id).toMatch(/^ISS-\d{4}$/);
      expect(result.path).toMatch(/ISS-\d{4}-.*\.md$/);
      expect(result.timestamp).toBeValidTimestamp();
      expect(result.path).toContain('sentinel/issues');
      expect(result.status).toBe('open');
      await expect(result.path).toBeMarkdownFile();
    });

    it('should include correct frontmatter', async () => {
      const result = await createIssue({
        projectId: 'test-repo',
        severity: 'critical',
        title: 'Security vulnerability',
        details: 'SQL injection found',
      });

      const { frontmatter } = await readFileWithFrontmatter(result.path);

      expect(frontmatter).toMatchFrontmatter({
        projectId: 'test-repo',
        severity: 'critical',
        status: 'open',
      });
      expect(frontmatter.created_at).toBeValidTimestamp();
    });

    it('should include title and details in body', async () => {
      const result = await createIssue({
        projectId: 'repo',
        severity: 'med',
        title: 'Performance Issue',
        details: 'Response times have increased by 50%',
      });

      const { body } = await readFileWithFrontmatter(result.path);

      expect(body).toContain('# Performance Issue');
      expect(body).toContain('## Details');
      expect(body).toContain('Response times have increased by 50%');
    });

    it('should display severity in body', async () => {
      const result = await createIssue({
        projectId: 'repo',
        severity: 'high',
        title: 'Test',
        details: 'Test details',
      });

      const { body } = await readFileWithFrontmatter(result.path);
      expect(body).toContain('**Severity:** high');
      expect(body).toContain('**Status:** open');
    });

    it.each(['low', 'med', 'high', 'critical'] as const)(
      'should accept severity level: %s',
      async (severity) => {
        const result = await createIssue({
          projectId: 'repo',
          severity,
          title: `Test ${severity}`,
          details: 'Details',
        });

        const { frontmatter } = await readFileWithFrontmatter(result.path);
        expect(frontmatter.severity).toBe(severity);
        expect(frontmatter.severity).toBeValidSeverity();
      }
    );

    it('should generate safe slugs from titles', async () => {
      const result = await createIssue({
        projectId: 'repo',
        severity: 'low',
        title: 'Bug: Something is Wrong! (Critical)',
        details: 'Details here',
      });

      // Post-PR#8 the slug lives in the filename (ISS-NNNN-<slug>.md), not
      // in the issue id itself. Extract from result.path instead.
      const match = result.path.match(/ISS-\d{4}-(.*)\.md$/);
      expect(match).not.toBeNull();
      const slug = match![1];
      expect(slug).toBeSafeSlug();
    });

    it('should create issues directory structure', async () => {
      const result = await createIssue({
        projectId: 'new-repo',
        severity: 'low',
        title: 'First issue',
        details: 'Details',
      });

      expect(result.path).toContain('sentinel/issues');
      await expect(result.path).toBeMarkdownFile();
    });

    it('should handle projectIds with special characters', async () => {
      const result = await createIssue({
        projectId: 'org-repo-name',
        severity: 'med',
        title: 'Issue in nested repo',
        details: 'Details',
      });

      expect(result.path).toContain('sentinel/issues');
      await expect(result.path).toBeMarkdownFile();
    });

    it('should always return status as open for new issues', async () => {
      const result = await createIssue({
        projectId: 'repo',
        severity: 'low',
        title: 'Test',
        details: 'Test',
      });

      expect(result.status).toBe('open');

      const { frontmatter } = await readFileWithFrontmatter(result.path);
      expect(frontmatter.status).toBe('open');
    });

    it('should handle long detailed descriptions', async () => {
      const longDetails = 'X'.repeat(10000);

      const result = await createIssue({
        projectId: 'repo',
        severity: 'low',
        title: 'Issue with long details',
        details: longDetails,
      });

      const { body } = await readFileWithFrontmatter(result.path);
      expect(body).toContain(longDetails);
    });

    it('should include epic_id when provided', async () => {
      // Create epic first (validation requires epic to exist)
      await logEpic({ title: 'Test Epic', summary: 'Summary' });

      const result = await createIssue({
        projectId: 'repo',
        severity: 'high',
        title: 'Issue linked to epic',
        details: 'Details',
        epic_id: 'EPIC-0001',
      });

      // Should succeed now that epic exists
      expect('error' in result).toBe(false);
      if (!('error' in result)) {
        expect(result.epic_id).toBe('EPIC-0001');

        const { frontmatter, body } = await readFileWithFrontmatter(result.path);
        expect(frontmatter.epic_id).toBe('EPIC-0001');
        expect(body).toContain('**Epic:** EPIC-0001');
      }
    });

    it('should not include epic_id when not provided', async () => {
      const result = await createIssue({
        projectId: 'repo',
        severity: 'low',
        title: 'Issue without epic',
        details: 'Details',
      });

      expect(result.epic_id).toBeUndefined();

      const { frontmatter, body } = await readFileWithFrontmatter(result.path);
      expect(frontmatter.epic_id).toBeUndefined();
      expect(body).not.toContain('**Epic:**');
    });
  });

  // ==========================================================================
  // Epic Tests
  // ==========================================================================

  describe('logEpic', () => {
    it('should create an epic markdown file', async () => {
      const result = await logEpic({
        title: 'MCP Server Epic Support',
        summary: 'Add epic tracking to Sentinel',
      });

      expect(result.epic_id).toMatch(/^EPIC-\d{4}$/);
      expect(result.timestamp).toBeValidTimestamp();
      expect(result.path).toContain('sentinel/epics');
      await expect(result.path).toBeMarkdownFile();
    });

    it('should auto-increment epic IDs', async () => {
      const epic1 = await logEpic({
        title: 'First Epic',
        summary: 'Summary 1',
      });

      const epic2 = await logEpic({
        title: 'Second Epic',
        summary: 'Summary 2',
      });

      expect(epic1.epic_id).toBe('EPIC-0001');
      expect(epic2.epic_id).toBe('EPIC-0002');
    });

    it('should include all fields in frontmatter', async () => {
      const result = await logEpic({
        title: 'Full Epic',
        summary: 'A complete epic',
        priority: 'high',
        tags: ['mcp', 'sentinel'],
        owner: 'ben',
        squad: 'decibel',
      });

      const { frontmatter } = await readFileWithFrontmatter(result.path);

      expect(frontmatter.id).toBe(result.epic_id);
      expect(frontmatter.title).toBe('Full Epic');
      expect(frontmatter.summary).toBe('A complete epic');
      expect(frontmatter.status).toBe('planned');
      expect(frontmatter.priority).toBe('high');
      expect(frontmatter.owner).toBe('ben');
      expect(frontmatter.squad).toBe('decibel');
    });

    it('should use default priority when not provided', async () => {
      const result = await logEpic({
        title: 'Default Priority Epic',
        summary: 'Summary',
      });

      const { frontmatter } = await readFileWithFrontmatter(result.path);
      expect(frontmatter.priority).toBe('medium');
    });

    it('should include motivation section', async () => {
      const result = await logEpic({
        title: 'Motivated Epic',
        summary: 'Summary',
        motivation: ['Reason 1', 'Reason 2'],
      });

      const { body } = await readFileWithFrontmatter(result.path);
      expect(body).toContain('## Motivation');
      expect(body).toContain('- Reason 1');
      expect(body).toContain('- Reason 2');
    });

    // ISS-0110 bug 3: hand-crafted YAML frontmatter must quote values
    // containing '#' (and other YAML indicator chars) so they round-trip
    // through a *real* YAML parser. The naive test-helper parser doesn't
    // interpret '#' as a comment indicator, so we use yaml.parse directly.
    async function parseFrontmatterStrict(filePath: string): Promise<Record<string, unknown>> {
      const content = await fs.readFile(filePath, 'utf-8');
      const m = content.match(/^---\n([\s\S]*?)\n---/);
      if (!m) throw new Error(`No frontmatter in ${filePath}`);
      return parseYaml(m[1]) as Record<string, unknown>;
    }

    it('should round-trip title containing # without truncation', async () => {
      const title = 'Fix bug from PR #42';
      const summary = 'A # in summary too';
      const result = await logEpic({ title, summary });

      const fm = await parseFrontmatterStrict(result.path);
      expect(fm.title).toBe(title);
      expect(fm.summary).toBe(summary);
    });

    it('should round-trip title containing a colon without losing the suffix', async () => {
      const title = 'Phase 6: Distribution & Reach';
      const result = await logEpic({ title, summary: 'Summary' });

      const fm = await parseFrontmatterStrict(result.path);
      expect(fm.title).toBe(title);
    });

    it('should include outcomes section', async () => {
      const result = await logEpic({
        title: 'Outcome Epic',
        summary: 'Summary',
        outcomes: ['Outcome A', 'Outcome B'],
      });

      const { body } = await readFileWithFrontmatter(result.path);
      expect(body).toContain('## Outcomes');
      expect(body).toContain('- Outcome A');
      expect(body).toContain('- Outcome B');
    });

    it('should include acceptance criteria as checkboxes', async () => {
      const result = await logEpic({
        title: 'AC Epic',
        summary: 'Summary',
        acceptance_criteria: ['Criterion 1', 'Criterion 2'],
      });

      const { body } = await readFileWithFrontmatter(result.path);
      expect(body).toContain('## Acceptance Criteria');
      expect(body).toContain('- [ ] Criterion 1');
      expect(body).toContain('- [ ] Criterion 2');
    });

    it('should generate safe slugs in filenames', async () => {
      const result = await logEpic({
        title: 'Epic: Special Characters! @#$%',
        summary: 'Summary',
      });

      expect(result.path).toMatch(/EPIC-\d{4}-[a-z0-9-]+\.md$/);
    });
  });

  describe('listEpics', () => {
    it('should return empty array when no epics exist', async () => {
      const result = await listEpics({});

      expect(result.epics).toEqual([]);
    });

    it('should list all epics', async () => {
      await logEpic({ title: 'Epic 1', summary: 'Summary 1' });
      await logEpic({ title: 'Epic 2', summary: 'Summary 2' });

      const result = await listEpics({});

      expect(result.epics).toHaveLength(2);
      expect(result.epics.map((e) => e.title)).toContain('Epic 1');
      expect(result.epics.map((e) => e.title)).toContain('Epic 2');
    });

    it('should filter by status', async () => {
      await logEpic({ title: 'Planned Epic', summary: 'Summary' });
      // Note: All new epics start as 'planned', so filtering by other status returns empty

      const result = await listEpics({ status: 'planned' });

      expect(result.epics).toHaveLength(1);
      expect(result.epics[0].status).toBe('planned');
    });

    it('should filter by priority', async () => {
      await logEpic({ title: 'High Priority', summary: 'Summary', priority: 'high' });
      await logEpic({ title: 'Low Priority', summary: 'Summary', priority: 'low' });

      const result = await listEpics({ priority: 'high' });

      expect(result.epics).toHaveLength(1);
      expect(result.epics[0].title).toBe('High Priority');
    });

    it('should filter by tags', async () => {
      await logEpic({ title: 'Tagged Epic', summary: 'Summary', tags: ['mcp', 'test'] });
      await logEpic({ title: 'Other Epic', summary: 'Summary', tags: ['other'] });

      const result = await listEpics({ tags: ['mcp'] });

      expect(result.epics).toHaveLength(1);
      expect(result.epics[0].title).toBe('Tagged Epic');
    });

    it('should sort by ID descending (newest first)', async () => {
      await logEpic({ title: 'First', summary: 'Summary' });
      await logEpic({ title: 'Second', summary: 'Summary' });
      await logEpic({ title: 'Third', summary: 'Summary' });

      const result = await listEpics({});

      expect(result.epics[0].id).toBe('EPIC-0003');
      expect(result.epics[1].id).toBe('EPIC-0002');
      expect(result.epics[2].id).toBe('EPIC-0001');
    });
  });

  describe('getEpic', () => {
    it('should return epic details', async () => {
      await logEpic({
        title: 'Test Epic',
        summary: 'Test summary',
        priority: 'high',
        owner: 'ben',
      });

      const result = await getEpic({ epic_id: 'EPIC-0001' });

      expect(result.error).toBeUndefined();
      expect(result.epic).not.toBeNull();
      expect(result.epic!.id).toBe('EPIC-0001');
      expect(result.epic!.title).toBe('Test Epic');
      expect(result.epic!.summary).toBe('Test summary');
      expect(result.epic!.priority).toBe('high');
      expect(result.epic!.owner).toBe('ben');
    });

    it('should return error for non-existent epic', async () => {
      const result = await getEpic({ epic_id: 'EPIC-9999' });

      expect(result.epic).toBeNull();
      expect(result.error).toContain('Epic not found');
    });

    it('should parse motivation from body', async () => {
      await logEpic({
        title: 'Motivated Epic',
        summary: 'Summary',
        motivation: ['Reason 1', 'Reason 2'],
      });

      const result = await getEpic({ epic_id: 'EPIC-0001' });

      expect(result.epic!.motivation).toContain('Reason 1');
      expect(result.epic!.motivation).toContain('Reason 2');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Regression tests for the issue-parsing format mismatch (fix branch
  // fix/sentinel-epic-issue-relationship). updateIssue writes pure-YAML
  // files (no --- markers) but the previous parseIssueFile only accepted
  // markdown-frontmatter format. Result: list_issues / list_epic_issues
  // silently dropped any update_issue'd issue. These tests lock in the
  // both-formats parsing + the richer IssueSummary fields.
  // ──────────────────────────────────────────────────────────────────────────

  describe('parseIssueFile (via listRepoIssues / getEpicIssues)', () => {
    it('lists issues stored in YAML-only format (no --- markers)', async () => {
      // Simulate what updateIssue writes after stringifyYaml: pure YAML, no
      // frontmatter delimiters, multi-line description as `|-` literal block.
      const issuesDir = path.join(ctx.rootDir, '.decibel', 'sentinel', 'issues');
      await fs.mkdir(issuesDir, { recursive: true });

      const yamlOnly = `projectId: my-repo
severity: high
status: in_progress
created_at: 2026-04-29T06:00:40.269Z
epic_id: EPIC-0001
updated_at: 2026-04-29T21:00:30.713Z
description: |-
  body content
  with multiple lines
`;
      await fs.writeFile(
        path.join(issuesDir, '2026-04-29T06-00-40Z-yaml-only-format.md'),
        yamlOnly,
        'utf-8',
      );

      const result = await listRepoIssues({});
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].severity).toBe('high');
      expect(result.issues[0].status).toBe('in_progress');
      expect(result.issues[0].epic_id).toBe('EPIC-0001');
      expect(result.issues[0].created_at).toBe('2026-04-29T06:00:40.269Z');
      expect(result.issues[0].updated_at).toBe('2026-04-29T21:00:30.713Z');
    });

    it('lists issues stored in markdown frontmatter format (--- delimiters)', async () => {
      const issuesDir = path.join(ctx.rootDir, '.decibel', 'sentinel', 'issues');
      await fs.mkdir(issuesDir, { recursive: true });

      const withMarkers = `---
projectId: my-repo
severity: low
status: open
epic_id: EPIC-0002
created_at: 2026-04-29T07:00:00.000Z
---

# Issue title

Body content here.
`;
      await fs.writeFile(
        path.join(issuesDir, '2026-04-29T07-00-00Z-markdown-format.md'),
        withMarkers,
        'utf-8',
      );

      const result = await listRepoIssues({});
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].title).toBe('Issue title');
      expect(result.issues[0].severity).toBe('low');
      expect(result.issues[0].epic_id).toBe('EPIC-0002');
    });

    it('lists issues from BOTH formats in the same directory', async () => {
      // The most-likely real situation: createIssue writes --- format,
      // updateIssue rewrites the same file as YAML-only. Without the fix,
      // any project with a mix would have its update_issue'd issues dropped.
      const issuesDir = path.join(ctx.rootDir, '.decibel', 'sentinel', 'issues');
      await fs.mkdir(issuesDir, { recursive: true });

      await fs.writeFile(
        path.join(issuesDir, 'a-yaml-only.md'),
        `severity: high\nstatus: open\nepic_id: EPIC-0001\n`,
        'utf-8',
      );
      await fs.writeFile(
        path.join(issuesDir, 'b-with-markers.md'),
        `---\nseverity: low\nstatus: closed\nepic_id: EPIC-0001\n---\n# Title\nbody\n`,
        'utf-8',
      );

      const result = await listRepoIssues({});
      expect(result.issues).toHaveLength(2);
    });

    it('surfaces epic_id from either snake_case or camelCase frontmatter key', async () => {
      // Some daemon-client paths still write `epicId:` (camel). The parser
      // should accept either form so we don't drop relationships.
      const issuesDir = path.join(ctx.rootDir, '.decibel', 'sentinel', 'issues');
      await fs.mkdir(issuesDir, { recursive: true });
      await fs.writeFile(
        path.join(issuesDir, 'snake.md'),
        `severity: low\nstatus: open\nepic_id: EPIC-0001\n`,
        'utf-8',
      );
      await fs.writeFile(
        path.join(issuesDir, 'camel.md'),
        `severity: low\nstatus: open\nepicId: EPIC-0002\n`,
        'utf-8',
      );

      const result = await listRepoIssues({});
      const ids = result.issues.map((i) => i.epic_id);
      expect(ids).toContain('EPIC-0001');
      expect(ids).toContain('EPIC-0002');
    });

    it('parses inline-flow tags (tags: [a, b])', async () => {
      const issuesDir = path.join(ctx.rootDir, '.decibel', 'sentinel', 'issues');
      await fs.mkdir(issuesDir, { recursive: true });
      await fs.writeFile(
        path.join(issuesDir, 'with-tags.md'),
        `severity: low\nstatus: open\ntags: ["review", "code-review", "fragility"]\n`,
        'utf-8',
      );

      const result = await listRepoIssues({});
      expect(result.issues[0].tags).toEqual(['review', 'code-review', 'fragility']);
    });
  });

  describe('getEpicIssues regression — handles both formats', () => {
    it('returns YAML-only issues that link to the epic', async () => {
      const issuesDir = path.join(ctx.rootDir, '.decibel', 'sentinel', 'issues');
      await fs.mkdir(issuesDir, { recursive: true });
      await fs.writeFile(
        path.join(issuesDir, 'yaml-only-linked.md'),
        `severity: high\nstatus: open\nepic_id: EPIC-0001\n`,
        'utf-8',
      );
      await fs.writeFile(
        path.join(issuesDir, 'yaml-only-unlinked.md'),
        `severity: high\nstatus: open\nepic_id: EPIC-0002\n`,
        'utf-8',
      );

      const result = await getEpicIssues({ epic_id: 'EPIC-0001' });
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].epic_id).toBe('EPIC-0001');
    });

    it('does NOT match commented-out epic_id lines (regression)', async () => {
      // The old substring filter `content.includes('epic_id: EPIC-0001')`
      // would falsely match a `# epic_id: EPIC-0001` comment in the body.
      // Parsed-field filter doesn't.
      const issuesDir = path.join(ctx.rootDir, '.decibel', 'sentinel', 'issues');
      await fs.mkdir(issuesDir, { recursive: true });
      await fs.writeFile(
        path.join(issuesDir, 'commented.md'),
        `severity: low\nstatus: open\nepic_id: EPIC-0002\ndescription: |-\n  saw # epic_id: EPIC-0001 in another file\n`,
        'utf-8',
      );

      const result = await getEpicIssues({ epic_id: 'EPIC-0001' });
      expect(result.issues).toHaveLength(0);
    });

    it('does NOT match a column-0 epic_id line embedded in the description body (regression for SH1)', async () => {
      // Earlier ad-hoc parser would exit the multi-line literal block on any
      // column-0 line that looked like `key:`, so a crafted description
      // could hijack the parsed epic_id. The real YAML parser doesn't fall
      // for this — `description:` value is just a string regardless of its
      // contents.
      const issuesDir = path.join(ctx.rootDir, '.decibel', 'sentinel', 'issues');
      await fs.mkdir(issuesDir, { recursive: true });
      await fs.writeFile(
        path.join(issuesDir, 'injection-attempt.md'),
        // Real epic is EPIC-VICTIM. Description body contains a fake
        // `epic_id: EPIC-ATTACKER` at column 0 of the literal block.
        // YAML treats it as part of the description string.
        `severity: low
status: open
epic_id: EPIC-VICTIM
description: |
  innocent body
  but here is some injected text:
  epic_id: EPIC-ATTACKER
`,
        'utf-8',
      );

      const victim = await getEpicIssues({ epic_id: 'EPIC-VICTIM' });
      const attacker = await getEpicIssues({ epic_id: 'EPIC-ATTACKER' });
      expect(victim.issues).toHaveLength(1);
      expect(attacker.issues).toHaveLength(0);
    });

    it('parses multi-line YAML array tags (tags:\n  - a\n  - b)', async () => {
      // The ad-hoc parser only handled inline-flow `[a, b]`. Real YAML parser
      // handles both forms.
      const issuesDir = path.join(ctx.rootDir, '.decibel', 'sentinel', 'issues');
      await fs.mkdir(issuesDir, { recursive: true });
      await fs.writeFile(
        path.join(issuesDir, 'multi-line-tags.md'),
        `severity: low
status: open
epic_id: EPIC-0001
tags:
  - review
  - code-review
  - fragility
`,
        'utf-8',
      );

      const result = await listRepoIssues({});
      expect(result.issues[0].tags).toEqual(['review', 'code-review', 'fragility']);
    });
  });

  describe('getEpicIssues', () => {
    it('should return empty array when no issues linked', async () => {
      await logEpic({ title: 'Lonely Epic', summary: 'No issues' });

      const result = await getEpicIssues({ epic_id: 'EPIC-0001' });

      expect(result.issues).toEqual([]);
    });

    it('should return issues linked to epic', async () => {
      await logEpic({ title: 'Parent Epic', summary: 'Has issues' });

      await createIssue({
        projectId: 'repo1',
        severity: 'high',
        title: 'Linked Issue 1',
        details: 'Details',
        epic_id: 'EPIC-0001',
      });

      await createIssue({
        projectId: 'repo2',
        severity: 'low',
        title: 'Linked Issue 2',
        details: 'Details',
        epic_id: 'EPIC-0001',
      });

      await createIssue({
        projectId: 'repo1',
        severity: 'med',
        title: 'Unlinked Issue',
        details: 'Details',
      });

      const result = await getEpicIssues({ epic_id: 'EPIC-0001' });

      expect(result.issues).toHaveLength(2);
      expect(result.issues.map((i) => i.title)).toContain('Linked Issue 1');
      expect(result.issues.map((i) => i.title)).toContain('Linked Issue 2');
      expect(result.issues.map((i) => i.title)).not.toContain('Unlinked Issue');
    });

    it('should search across multiple projects', async () => {
      await logEpic({ title: 'Cross-project Epic', summary: 'Summary' });

      await createIssue({
        projectId: 'repo-a',
        severity: 'high',
        title: 'Issue A',
        details: 'Details',
        epic_id: 'EPIC-0001',
      });

      await createIssue({
        projectId: 'repo-b',
        severity: 'low',
        title: 'Issue B',
        details: 'Details',
        epic_id: 'EPIC-0001',
      });

      const result = await getEpicIssues({ epic_id: 'EPIC-0001' });

      expect(result.issues).toHaveLength(2);
    });
  });

  // ==========================================================================
  // Epic Validation Tests
  // ==========================================================================

  describe('createIssue with epic validation', () => {
    it('should return EPIC_NOT_FOUND for invalid epic_id', async () => {
      const result = await createIssue({
        projectId: 'repo',
        severity: 'high',
        title: 'Issue with bad epic',
        details: 'Details',
        epic_id: 'EPIC-9999',
      });

      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.error).toBe('EPIC_NOT_FOUND');
        expect(result.epic_id).toBe('EPIC-9999');
        expect(result.message).toContain('Unknown epic_id');
        expect(result.suggested_epics).toBeDefined();
      }
    });

    it('should include suggested epics in error', async () => {
      // Create some epics first
      await logEpic({ title: 'MCP Server Epic', summary: 'Summary' });
      await logEpic({ title: 'Another Epic', summary: 'Summary' });

      const result = await createIssue({
        projectId: 'repo',
        severity: 'low',
        title: 'Issue',
        details: 'Details',
        epic_id: 'EPIC-9999',
      });

      expect('error' in result).toBe(true);
      if ('error' in result) {
        expect(result.suggested_epics.length).toBeGreaterThan(0);
        expect(result.suggested_epics[0]).toHaveProperty('id');
        expect(result.suggested_epics[0]).toHaveProperty('title');
      }
    });

    it('should succeed with valid epic_id', async () => {
      await logEpic({ title: 'Valid Epic', summary: 'Summary' });

      const result = await createIssue({
        projectId: 'repo',
        severity: 'high',
        title: 'Issue linked to valid epic',
        details: 'Details',
        epic_id: 'EPIC-0001',
      });

      expect('error' in result).toBe(false);
      if (!('error' in result)) {
        expect(result.epic_id).toBe('EPIC-0001');
        expect(result.id).toBeDefined();
      }
    });

    it('should allow issues without epic_id', async () => {
      const result = await createIssue({
        projectId: 'repo',
        severity: 'low',
        title: 'Standalone issue',
        details: 'Details',
      });

      expect('error' in result).toBe(false);
      if (!('error' in result)) {
        expect(result.id).toBeDefined();
        expect(result.epic_id).toBeUndefined();
      }
    });
  });

  // ==========================================================================
  // Resolve Epic Tests
  // ==========================================================================

  describe('resolveEpic', () => {
    it('should return empty matches when no epics exist', async () => {
      const result = await resolveEpic({ query: 'test' });

      expect(result.matches).toEqual([]);
    });

    it('should find epic by exact ID', async () => {
      await logEpic({ title: 'Test Epic', summary: 'Summary' });

      const result = await resolveEpic({ query: 'EPIC-0001' });

      expect(result.matches.length).toBeGreaterThan(0);
      expect(result.matches[0].id).toBe('EPIC-0001');
      expect(result.matches[0].score).toBeGreaterThan(0.8);
    });

    it('should find epic by title keyword', async () => {
      await logEpic({ title: 'MCP Server Integration', summary: 'Summary' });
      await logEpic({ title: 'Database Optimization', summary: 'Summary' });

      const result = await resolveEpic({ query: 'MCP' });

      expect(result.matches.length).toBeGreaterThan(0);
      expect(result.matches[0].title).toContain('MCP');
    });

    it('should return matches sorted by score', async () => {
      await logEpic({ title: 'MCP Server Integration', summary: 'Summary' });
      await logEpic({ title: 'MCP Client', summary: 'Summary' });
      await logEpic({ title: 'Database', summary: 'Summary' });

      const result = await resolveEpic({ query: 'MCP Server' });

      expect(result.matches.length).toBeGreaterThanOrEqual(2);
      // First result should have higher score
      expect(result.matches[0].score).toBeGreaterThanOrEqual(result.matches[1].score);
    });

    it('should respect limit parameter', async () => {
      await logEpic({ title: 'Epic 1', summary: 'Summary' });
      await logEpic({ title: 'Epic 2', summary: 'Summary' });
      await logEpic({ title: 'Epic 3', summary: 'Summary' });

      const result = await resolveEpic({ query: 'Epic', limit: 2 });

      expect(result.matches.length).toBeLessThanOrEqual(2);
    });

    it('should include status and priority in results', async () => {
      await logEpic({
        title: 'High Priority Epic',
        summary: 'Summary',
        priority: 'high',
      });

      const result = await resolveEpic({ query: 'High Priority' });

      expect(result.matches[0].status).toBe('planned');
      expect(result.matches[0].priority).toBe('high');
    });

    it('should handle partial word matches', async () => {
      await logEpic({ title: 'Authentication System', summary: 'Summary' });

      const result = await resolveEpic({ query: 'auth' });

      expect(result.matches.length).toBeGreaterThan(0);
    });

    it('should be case insensitive', async () => {
      await logEpic({ title: 'MCP Server', summary: 'Summary' });

      const result = await resolveEpic({ query: 'mcp server' });

      expect(result.matches.length).toBeGreaterThan(0);
    });
  });
});
