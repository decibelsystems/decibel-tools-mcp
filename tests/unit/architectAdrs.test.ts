import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createProjectAdr, parseAdrContent } from '../../src/architectAdrs.js';
import {
  createTestContext,
  cleanupTestContext,
  TestContext,
} from '../utils/test-context.js';

// Mock the projectPaths module
vi.mock('../../src/projectPaths.js', () => ({
  resolveProjectRoot: vi.fn(),
}));

import { resolveProjectRoot } from '../../src/projectPaths.js';

/**
 * Read an ADR file and run it through the canonical uniform parser.
 * This is what every reader (oracle, sentinel cross-links, MCP tools)
 * sees — assert against this shape rather than the on-disk format.
 */
async function readAdr(filePath: string): Promise<Record<string, unknown>> {
  const content = await fs.readFile(filePath, 'utf-8');
  return parseAdrContent(path.basename(filePath), content);
}

describe('architectAdrs', () => {
  let ctx: TestContext;
  let projectRoot: string;
  let adrsDir: string;

  beforeEach(async () => {
    ctx = await createTestContext();
    projectRoot = ctx.rootDir;
    adrsDir = path.join(projectRoot, '.decibel', 'architect', 'adrs');

    // Setup mock to return our test directory
    vi.mocked(resolveProjectRoot).mockResolvedValue({
      projectId: 'test-project',
      projectName: 'Test Project',
      root: projectRoot,
    });
  });

  afterEach(async () => {
    await cleanupTestContext(ctx);
    vi.resetAllMocks();
  });

  // ==========================================================================
  // createProjectAdr Tests
  //
  // ADRs are now written as markdown (`ADR-NNNN-<slug>.md`) with YAML
  // frontmatter for metadata and `## Context / ## Decision / ## Consequences`
  // sections for prose. Legacy `.yml` ADRs remain readable; new ADRs are `.md`.
  // Tests read back through parseAdrContent so they assert against the
  // uniform record shape rather than the on-disk file format.
  // ==========================================================================

  describe('createProjectAdr', () => {
    it('should create a new ADR with auto-generated ID', async () => {
      const result = await createProjectAdr({
        projectId: 'test-project',
        title: 'Use PostgreSQL for persistence',
        context: 'We need a reliable database',
        decision: 'Use PostgreSQL',
        consequences: 'Need to manage DB infrastructure',
      });

      expect(result.id).toBe('ADR-0001');
      expect(result.path).toContain('ADR-0001-use-postgresql-for-persistence.md');
    });

    it('should increment ID based on existing ADRs', async () => {
      // Existing legacy .yml ADR — counter must skip past it
      await fs.mkdir(adrsDir, { recursive: true });
      await fs.writeFile(
        path.join(adrsDir, 'ADR-0005-existing-decision.yml'),
        'id: ADR-0005\ntitle: Existing'
      );

      const result = await createProjectAdr({
        projectId: 'test-project',
        title: 'Next Decision',
        context: 'Some context',
        decision: 'Some decision',
        consequences: 'Some consequences',
      });

      expect(result.id).toBe('ADR-0006');
    });

    it('should write a file readable by the canonical ADR parser', async () => {
      const result = await createProjectAdr({
        projectId: 'test-project',
        title: 'YAML Test',
        context: 'Context text',
        decision: 'Decision text',
        consequences: 'Consequences text',
      });

      const parsed = await readAdr(result.path);

      expect(parsed.id).toBe('ADR-0001');
      expect(parsed.title).toBe('YAML Test');
      expect(parsed.scope).toBe('project');
      expect(parsed.project).toBe('test-project');
      expect(parsed.status).toBe('accepted');
      expect(parsed.context).toBe('Context text');
      expect(parsed.decision).toBe('Decision text');
      expect(parsed.consequences).toBe('Consequences text');
    });

    it('should include timestamps', async () => {
      const before = new Date().toISOString();
      const result = await createProjectAdr({
        projectId: 'test-project',
        title: 'Timestamp Test',
        context: 'Context',
        decision: 'Decision',
        consequences: 'Consequences',
      });
      const after = new Date().toISOString();

      const parsed = await readAdr(result.path);

      expect(parsed.created_at).toBeDefined();
      expect(parsed.updated_at).toBeDefined();
      expect((parsed.created_at as string) >= before).toBe(true);
      expect((parsed.created_at as string) <= after).toBe(true);
    });

    it('should include related issues when provided', async () => {
      const result = await createProjectAdr({
        projectId: 'test-project',
        title: 'With Issues',
        context: 'Context',
        decision: 'Decision',
        consequences: 'Consequences',
        relatedIssues: ['ISS-0001', 'ISS-0003'],
      });

      const parsed = await readAdr(result.path);

      expect(parsed.related_issues).toEqual(['ISS-0001', 'ISS-0003']);
    });

    it('should include related epics when provided', async () => {
      const result = await createProjectAdr({
        projectId: 'test-project',
        title: 'With Epics',
        context: 'Context',
        decision: 'Decision',
        consequences: 'Consequences',
        relatedEpics: ['EPIC-0002'],
      });

      const parsed = await readAdr(result.path);

      expect(parsed.related_epics).toEqual(['EPIC-0002']);
    });

    it('should not include related fields when not provided', async () => {
      const result = await createProjectAdr({
        projectId: 'test-project',
        title: 'No Relations',
        context: 'Context',
        decision: 'Decision',
        consequences: 'Consequences',
      });

      const parsed = await readAdr(result.path);

      expect(parsed.related_issues).toBeUndefined();
      expect(parsed.related_epics).toBeUndefined();
    });

    it('should slugify title for filename', async () => {
      const result = await createProjectAdr({
        projectId: 'test-project',
        title: 'Use PostgreSQL: For Persistence!!!',
        context: 'Context',
        decision: 'Decision',
        consequences: 'Consequences',
      });

      expect(result.path).toContain('ADR-0001-use-postgresql-for-persistence.md');
    });

    it('should truncate long slugs', async () => {
      const result = await createProjectAdr({
        projectId: 'test-project',
        title: 'This is a very very very very very very very very very very long title that should be truncated',
        context: 'Context',
        decision: 'Decision',
        consequences: 'Consequences',
      });

      // Slug should be max 50 chars
      const filename = path.basename(result.path);
      const slug = filename.replace(/^ADR-\d+-/, '').replace('.md', '');
      expect(slug.length).toBeLessThanOrEqual(50);
    });

    it('should create the adrs directory if it does not exist', async () => {
      // Ensure directory doesn't exist
      await fs.rm(adrsDir, { recursive: true, force: true });

      const result = await createProjectAdr({
        projectId: 'test-project',
        title: 'Directory Creation Test',
        context: 'Context',
        decision: 'Decision',
        consequences: 'Consequences',
      });

      // File should exist
      const exists = await fs.access(result.path).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });
  });

  // ==========================================================================
  // parseAdrContent — round-trip via both formats
  //
  // Regression cover for the legacy `.yml` reader path, which must stay
  // intact while the writer moves to `.md`. Without this, a future refactor
  // could silently drop legacy support and only show up when someone tries
  // to read an old project's ADRs.
  // ==========================================================================

  describe('parseAdrContent', () => {
    it('parses a markdown ADR (new format) into the uniform shape', async () => {
      const result = await createProjectAdr({
        projectId: 'test-project',
        title: 'Markdown Round-Trip',
        context: 'CTX',
        decision: 'DEC',
        consequences: 'CON',
      });

      const parsed = await readAdr(result.path);

      expect(parsed.id).toBe('ADR-0001');
      expect(parsed.title).toBe('Markdown Round-Trip');
      expect(parsed.context).toBe('CTX');
      expect(parsed.decision).toBe('DEC');
      expect(parsed.consequences).toBe('CON');
    });

    it('parses a legacy .yml ADR into the same uniform shape', async () => {
      await fs.mkdir(adrsDir, { recursive: true });
      const legacyPath = path.join(adrsDir, 'ADR-0099-legacy-decision.yml');
      await fs.writeFile(
        legacyPath,
        [
          'id: ADR-0099',
          'projectId: test-project',
          'title: Legacy Decision',
          'status: accepted',
          'context: legacy context',
          'decision: legacy decision',
          'consequences: legacy consequences',
        ].join('\n')
      );

      const parsed = await readAdr(legacyPath);

      expect(parsed.id).toBe('ADR-0099');
      expect(parsed.title).toBe('Legacy Decision');
      expect(parsed.status).toBe('accepted');
      expect(parsed.context).toBe('legacy context');
      expect(parsed.decision).toBe('legacy decision');
      expect(parsed.consequences).toBe('legacy consequences');
    });
  });
});
