import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { recordArchDecision } from '../../src/tools/architect.js';
import {
  createTestContext,
  cleanupTestContext,
  readFileWithFrontmatter,
  TestContext,
} from '../utils/test-context.js';
import '../utils/matchers.js';

describe('Architect Tool', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext();
  });

  afterEach(async () => {
    await cleanupTestContext(ctx);
  });

  describe('recordArchDecision', () => {
    it('should create an ADR markdown file', async () => {
      const result = await recordArchDecision({
        system_id: 'main-system',
        change: 'Migrate to microservices',
        rationale: 'Better scalability and team independence',
      });

      expect(result.id).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z-.*\.md$/);
      expect(result.timestamp).toBeValidTimestamp();
      expect(result.path).toContain('architect/main-system');
      await expect(result.path).toBeMarkdownFile();
    });

    it('should include correct frontmatter', async () => {
      const result = await recordArchDecision({
        system_id: 'api-service',
        change: 'Add caching layer',
        rationale: 'Reduce database load',
      });

      const { frontmatter } = await readFileWithFrontmatter(result.path);

      expect(frontmatter).toMatchFrontmatter({
        system_id: 'api-service',
        change: 'Add caching layer',
      });
      expect(frontmatter.timestamp).toBeValidTimestamp();
    });

    it('should include ADR sections in body', async () => {
      const result = await recordArchDecision({
        system_id: 'system',
        change: 'Switch to PostgreSQL',
        rationale: 'Better JSON support and performance',
        impact: 'Requires migration scripts',
      });

      const { body } = await readFileWithFrontmatter(result.path);

      expect(body).toContain('## Change');
      expect(body).toContain('Switch to PostgreSQL');
      expect(body).toContain('## Rationale');
      expect(body).toContain('Better JSON support and performance');
      expect(body).toContain('## Impact');
      expect(body).toContain('Requires migration scripts');
    });

    it('should use default impact text when not provided', async () => {
      const result = await recordArchDecision({
        system_id: 'system',
        change: 'Minor refactor',
        rationale: 'Code cleanup',
      });

      const { body } = await readFileWithFrontmatter(result.path);

      expect(body).toContain('## Impact');
      expect(body).toContain('No specific impact documented');
    });

    it('should include ADR prefix in title', async () => {
      const result = await recordArchDecision({
        system_id: 'system',
        change: 'Important Change',
        rationale: 'Good reasons',
      });

      const { body } = await readFileWithFrontmatter(result.path);
      expect(body).toContain('# ADR: Important Change');
    });

    it('should generate safe slugs from change descriptions', async () => {
      const result = await recordArchDecision({
        system_id: 'system',
        change: 'Use Event-Driven Architecture!!!',
        rationale: 'Better decoupling',
      });

      const match = result.id.match(/Z-(.*)\.md$/);
      expect(match).not.toBeNull();
      const slug = match![1];
      expect(slug).toBeSafeSlug();
    });

    it('should create directories for new system_ids', async () => {
      const result = await recordArchDecision({
        system_id: 'brand-new-system',
        change: 'Initial architecture',
        rationale: 'Starting fresh',
      });

      expect(result.path).toContain('brand-new-system');
      await expect(result.path).toBeMarkdownFile();
    });

    it('should handle multiline rationale', async () => {
      const multilineRationale = `First reason.
Second reason.
Third reason with details.`;

      const result = await recordArchDecision({
        system_id: 'system',
        change: 'Complex change',
        rationale: multilineRationale,
      });

      const { body } = await readFileWithFrontmatter(result.path);
      expect(body).toContain('First reason.');
      expect(body).toContain('Second reason.');
      expect(body).toContain('Third reason with details.');
    });
  });
});
