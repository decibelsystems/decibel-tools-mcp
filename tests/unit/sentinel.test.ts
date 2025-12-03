import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createIssue } from '../../src/tools/sentinel.js';
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

  describe('createIssue', () => {
    it('should create an issue markdown file', async () => {
      const result = await createIssue({
        repo: 'my-repo',
        severity: 'high',
        title: 'Memory leak detected',
        details: 'Process memory grows unbounded',
      });

      expect(result.id).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z-.*\.md$/);
      expect(result.timestamp).toBeValidTimestamp();
      expect(result.path).toContain('sentinel/my-repo/issues');
      expect(result.status).toBe('open');
      await expect(result.path).toBeMarkdownFile();
    });

    it('should include correct frontmatter', async () => {
      const result = await createIssue({
        repo: 'test-repo',
        severity: 'critical',
        title: 'Security vulnerability',
        details: 'SQL injection found',
      });

      const { frontmatter } = await readFileWithFrontmatter(result.path);

      expect(frontmatter).toMatchFrontmatter({
        repo: 'test-repo',
        severity: 'critical',
        status: 'open',
      });
      expect(frontmatter.created_at).toBeValidTimestamp();
    });

    it('should include title and details in body', async () => {
      const result = await createIssue({
        repo: 'repo',
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
        repo: 'repo',
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
          repo: 'repo',
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
        repo: 'repo',
        severity: 'low',
        title: 'Bug: Something is Wrong! (Critical)',
        details: 'Details here',
      });

      const match = result.id.match(/Z-(.*)\.md$/);
      expect(match).not.toBeNull();
      const slug = match![1];
      expect(slug).toBeSafeSlug();
    });

    it('should create issues directory structure', async () => {
      const result = await createIssue({
        repo: 'new-repo',
        severity: 'low',
        title: 'First issue',
        details: 'Details',
      });

      expect(result.path).toContain('sentinel/new-repo/issues');
      await expect(result.path).toBeMarkdownFile();
    });

    it('should handle repos with special characters', async () => {
      const result = await createIssue({
        repo: 'org/repo-name',
        severity: 'med',
        title: 'Issue in nested repo',
        details: 'Details',
      });

      expect(result.path).toContain('org/repo-name');
      await expect(result.path).toBeMarkdownFile();
    });

    it('should always return status as open for new issues', async () => {
      const result = await createIssue({
        repo: 'repo',
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
        repo: 'repo',
        severity: 'low',
        title: 'Issue with long details',
        details: longDetails,
      });

      const { body } = await readFileWithFrontmatter(result.path);
      expect(body).toContain(longDetails);
    });
  });
});
