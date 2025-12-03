import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { recordDesignDecision } from '../../src/tools/designer.js';
import {
  createTestContext,
  cleanupTestContext,
  readFileWithFrontmatter,
  TestContext,
} from '../utils/test-context.js';
import '../utils/matchers.js';

describe('Designer Tool', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext();
  });

  afterEach(async () => {
    await cleanupTestContext(ctx);
  });

  describe('recordDesignDecision', () => {
    it('should create a markdown file with correct structure', async () => {
      const result = await recordDesignDecision({
        project_id: 'test-project',
        area: 'API',
        summary: 'Use REST endpoints',
        details: 'REST is simpler than GraphQL for our use case',
      });

      expect(result.id).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z-.*\.md$/);
      expect(result.timestamp).toBeValidTimestamp();
      expect(result.path).toContain('designer/test-project');
      await expect(result.path).toBeMarkdownFile();
    });

    it('should include correct frontmatter', async () => {
      const result = await recordDesignDecision({
        project_id: 'my-project',
        area: 'Database',
        summary: 'Use PostgreSQL',
      });

      const { frontmatter } = await readFileWithFrontmatter(result.path);

      expect(frontmatter).toMatchFrontmatter({
        project_id: 'my-project',
        area: 'Database',
        summary: 'Use PostgreSQL',
      });
      expect(frontmatter.timestamp).toBeValidTimestamp();
    });

    it('should use summary as body when details is missing', async () => {
      const result = await recordDesignDecision({
        project_id: 'proj',
        area: 'UI',
        summary: 'Use dark mode by default',
      });

      const { body } = await readFileWithFrontmatter(result.path);
      expect(body).toContain('Use dark mode by default');
    });

    it('should use details as body when provided', async () => {
      const details = 'This is the detailed explanation of our decision.';
      const result = await recordDesignDecision({
        project_id: 'proj',
        area: 'UI',
        summary: 'Short summary',
        details,
      });

      const { body } = await readFileWithFrontmatter(result.path);
      expect(body).toContain(details);
    });

    it('should generate safe slugs from summaries', async () => {
      const result = await recordDesignDecision({
        project_id: 'proj',
        area: 'Test',
        summary: 'Use Special Characters!!! & Stuff @#$%',
      });

      // Extract slug from filename (after timestamp)
      const match = result.id.match(/Z-(.*)\.md$/);
      expect(match).not.toBeNull();
      const slug = match![1];
      expect(slug).toBeSafeSlug();
    });

    it('should truncate long summaries in slugs', async () => {
      const longSummary = 'This is a very long summary that should be truncated ' +
        'because it exceeds the maximum length allowed for slugs in filenames';

      const result = await recordDesignDecision({
        project_id: 'proj',
        area: 'Test',
        summary: longSummary,
      });

      const match = result.id.match(/Z-(.*)\.md$/);
      const slug = match![1];
      expect(slug.length).toBeLessThanOrEqual(50);
    });

    it('should create nested directories if they do not exist', async () => {
      const result = await recordDesignDecision({
        project_id: 'new-project/sub-area',
        area: 'Test',
        summary: 'Test nested',
      });

      expect(result.path).toContain('new-project/sub-area');
      await expect(result.path).toBeMarkdownFile();
    });

    it('should handle special characters in project_id', async () => {
      const result = await recordDesignDecision({
        project_id: 'project-with-dashes_and_underscores',
        area: 'Test',
        summary: 'Test special chars',
      });

      expect(result.path).toContain('project-with-dashes_and_underscores');
      await expect(result.path).toBeMarkdownFile();
    });

    it('should create unique files for consecutive calls', async () => {
      const results = await Promise.all([
        recordDesignDecision({
          project_id: 'proj',
          area: 'A',
          summary: 'First decision',
        }),
        recordDesignDecision({
          project_id: 'proj',
          area: 'B',
          summary: 'Second decision',
        }),
      ]);

      // Files should be different (different slugs)
      expect(results[0].id).not.toBe(results[1].id);

      // Both should exist
      await expect(results[0].path).toBeMarkdownFile();
      await expect(results[1].path).toBeMarkdownFile();
    });
  });
});
