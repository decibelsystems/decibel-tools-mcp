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
        projectId: 'test-project',
        area: 'API',
        summary: 'Use REST endpoints',
        details: 'REST is simpler than GraphQL for our use case',
      });

      expect(result.id).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z-.*\.md$/);
      expect(result.timestamp).toBeValidTimestamp();
      // Path should be in .decibel/designer/{area}/
      expect(result.path).toContain('.decibel/designer/API');
      await expect(result.path).toBeMarkdownFile();
    });

    it('should include correct frontmatter', async () => {
      const result = await recordDesignDecision({
        projectId: 'my-project',
        area: 'Database',
        summary: 'Use PostgreSQL',
      });

      const { frontmatter } = await readFileWithFrontmatter(result.path);

      expect(frontmatter).toMatchFrontmatter({
        project_id: 'my-project',  // frontmatter uses snake_case
        area: 'Database',
        summary: 'Use PostgreSQL',
      });
      expect(frontmatter.timestamp).toBeValidTimestamp();
    });

    it('should use summary as body when details is missing', async () => {
      const result = await recordDesignDecision({
        projectId: 'proj',
        area: 'UI',
        summary: 'Use dark mode by default',
      });

      const { body } = await readFileWithFrontmatter(result.path);
      expect(body).toContain('Use dark mode by default');
    });

    it('should use details as body when provided', async () => {
      const details = 'This is the detailed explanation of our decision.';
      const result = await recordDesignDecision({
        projectId: 'proj',
        area: 'UI',
        summary: 'Short summary',
        details,
      });

      const { body } = await readFileWithFrontmatter(result.path);
      expect(body).toContain(details);
    });

    it('should generate safe slugs from summaries', async () => {
      const result = await recordDesignDecision({
        projectId: 'proj',
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
        projectId: 'proj',
        area: 'Test',
        summary: longSummary,
      });

      const match = result.id.match(/Z-(.*)\.md$/);
      const slug = match![1];
      expect(slug.length).toBeLessThanOrEqual(50);
    });

    it('should create nested area directories if they do not exist', async () => {
      const result = await recordDesignDecision({
        projectId: 'test-project',
        area: 'Frontend/Components',  // Nested area
        summary: 'Test nested area',
      });

      // Path should contain the nested area under .decibel/designer/
      expect(result.path).toContain('.decibel/designer/Frontend/Components');
      await expect(result.path).toBeMarkdownFile();
    });

    it('should store in project-local .decibel folder', async () => {
      const result = await recordDesignDecision({
        projectId: 'any-project-id',
        area: 'Test',
        summary: 'Test project-local storage',
      });

      // Path should be within the test context's rootDir/.decibel/
      expect(result.path).toContain(ctx.rootDir);
      expect(result.path).toContain('.decibel/designer');
      await expect(result.path).toBeMarkdownFile();
    });

    it('should create unique files for consecutive calls', async () => {
      const results = await Promise.all([
        recordDesignDecision({
          projectId: 'proj',
          area: 'A',
          summary: 'First decision',
        }),
        recordDesignDecision({
          projectId: 'proj',
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
