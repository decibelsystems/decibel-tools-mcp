import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { parse as parseYaml } from 'yaml';
import { createProjectAdr } from '../../src/architectAdrs.js';
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
      expect(result.path).toContain('ADR-0001-use-postgresql-for-persistence.yml');
    });

    it('should increment ID based on existing ADRs', async () => {
      // Create ADRs directory and existing file
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

    it('should write valid YAML file', async () => {
      const result = await createProjectAdr({
        projectId: 'test-project',
        title: 'YAML Test',
        context: 'Context text',
        decision: 'Decision text',
        consequences: 'Consequences text',
      });

      const content = await fs.readFile(result.path, 'utf-8');
      const parsed = parseYaml(content);

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

      const content = await fs.readFile(result.path, 'utf-8');
      const parsed = parseYaml(content);

      expect(parsed.created_at).toBeDefined();
      expect(parsed.updated_at).toBeDefined();
      expect(parsed.created_at >= before).toBe(true);
      expect(parsed.created_at <= after).toBe(true);
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

      const content = await fs.readFile(result.path, 'utf-8');
      const parsed = parseYaml(content);

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

      const content = await fs.readFile(result.path, 'utf-8');
      const parsed = parseYaml(content);

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

      const content = await fs.readFile(result.path, 'utf-8');
      const parsed = parseYaml(content);

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

      expect(result.path).toContain('ADR-0001-use-postgresql-for-persistence.yml');
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
      const slug = filename.replace(/^ADR-\d+-/, '').replace('.yml', '');
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
});
