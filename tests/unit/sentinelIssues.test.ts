import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import {
  listIssuesForProject,
  createIssue,
  filterByStatus,
  filterByEpicId,
  SentinelIssue,
} from '../../src/sentinelIssues.js';
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

describe('sentinelIssues', () => {
  let ctx: TestContext;
  let projectRoot: string;
  let issuesDir: string;

  beforeEach(async () => {
    ctx = await createTestContext();
    projectRoot = ctx.rootDir;
    issuesDir = path.join(projectRoot, '.decibel', 'sentinel', 'issues');

    // Setup mock to return our test directory
    vi.mocked(resolveProjectRoot).mockResolvedValue({
      projectId: 'test-project',
      projectName: 'Test Project',
      root: projectRoot,
    });

    // Create issues directory
    await fs.mkdir(issuesDir, { recursive: true });
  });

  afterEach(async () => {
    await cleanupTestContext(ctx);
    vi.resetAllMocks();
  });

  // ==========================================================================
  // listIssuesForProject Tests
  // ==========================================================================

  describe('listIssuesForProject', () => {
    it('should return empty array when no issues exist', async () => {
      const issues = await listIssuesForProject('test-project');
      expect(issues).toEqual([]);
    });

    it('should load issues from YAML files', async () => {
      const issueYaml = `
id: ISS-0001
title: Test Issue
project: test-project
status: open
priority: high
tags:
  - bug
  - urgent
created_at: 2025-12-01T10:00:00Z
updated_at: 2025-12-01T10:00:00Z
`;
      await fs.writeFile(path.join(issuesDir, 'ISS-0001-test-issue.yml'), issueYaml);

      const issues = await listIssuesForProject('test-project');

      expect(issues).toHaveLength(1);
      expect(issues[0].id).toBe('ISS-0001');
      expect(issues[0].title).toBe('Test Issue');
      expect(issues[0].status).toBe('open');
      expect(issues[0].priority).toBe('high');
      expect(issues[0].tags).toEqual(['bug', 'urgent']);
    });

    it('should handle epic_id field', async () => {
      const issueYaml = `
id: ISS-0002
title: Issue with Epic
project: test-project
status: in_progress
epic_id: EPIC-0001
`;
      await fs.writeFile(path.join(issuesDir, 'ISS-0002.yml'), issueYaml);

      const issues = await listIssuesForProject('test-project');

      expect(issues).toHaveLength(1);
      expect(issues[0].epicId).toBe('EPIC-0001');
    });

    it('should skip files without id or title', async () => {
      await fs.writeFile(
        path.join(issuesDir, 'invalid.yml'),
        'status: open\npriority: high'
      );

      const issues = await listIssuesForProject('test-project');
      expect(issues).toHaveLength(0);
    });

    it('should sort issues by ID descending (newest first)', async () => {
      await fs.writeFile(
        path.join(issuesDir, 'ISS-0001.yml'),
        'id: ISS-0001\ntitle: First'
      );
      await fs.writeFile(
        path.join(issuesDir, 'ISS-0003.yml'),
        'id: ISS-0003\ntitle: Third'
      );
      await fs.writeFile(
        path.join(issuesDir, 'ISS-0002.yml'),
        'id: ISS-0002\ntitle: Second'
      );

      const issues = await listIssuesForProject('test-project');

      expect(issues).toHaveLength(3);
      expect(issues[0].id).toBe('ISS-0003');
      expect(issues[1].id).toBe('ISS-0002');
      expect(issues[2].id).toBe('ISS-0001');
    });

    it('should handle malformed YAML gracefully', async () => {
      await fs.writeFile(
        path.join(issuesDir, 'valid.yml'),
        'id: ISS-0001\ntitle: Valid'
      );
      await fs.writeFile(
        path.join(issuesDir, 'malformed.yml'),
        '{{{{not valid yaml'
      );

      const issues = await listIssuesForProject('test-project');

      expect(issues).toHaveLength(1);
      expect(issues[0].id).toBe('ISS-0001');
    });

    it('should return empty array if directory does not exist', async () => {
      await fs.rm(issuesDir, { recursive: true });

      const issues = await listIssuesForProject('test-project');
      expect(issues).toEqual([]);
    });
  });

  // ==========================================================================
  // createIssue Tests
  // ==========================================================================

  describe('createIssue', () => {
    it('should create a new issue with auto-generated ID', async () => {
      const result = await createIssue({
        projectId: 'test-project',
        title: 'New Bug Fix',
      });

      expect(result.id).toBe('ISS-0001');
      expect(result.title).toBe('New Bug Fix');
      expect(result.project).toBe('test-project');
      expect(result.status).toBe('open');
      expect(result.priority).toBe('medium');
      expect(result.filePath).toContain('ISS-0001-new-bug-fix.yml');
    });

    it('should increment ID based on existing issues', async () => {
      await fs.writeFile(
        path.join(issuesDir, 'ISS-0005.yml'),
        'id: ISS-0005\ntitle: Existing'
      );

      const result = await createIssue({
        projectId: 'test-project',
        title: 'Next Issue',
      });

      expect(result.id).toBe('ISS-0006');
    });

    it('should include optional fields', async () => {
      const result = await createIssue({
        projectId: 'test-project',
        title: 'Full Issue',
        description: 'Detailed description here',
        epicId: 'EPIC-0001',
        priority: 'high',
        tags: ['frontend', 'performance'],
      });

      expect(result.priority).toBe('high');
      expect(result.epicId).toBe('EPIC-0001');
      expect(result.tags).toEqual(['frontend', 'performance']);
      expect(result.description).toBe('Detailed description here');
    });

    it('should write valid YAML file', async () => {
      const result = await createIssue({
        projectId: 'test-project',
        title: 'YAML Test',
        priority: 'low',
      });

      const content = await fs.readFile(result.filePath, 'utf-8');

      expect(content).toContain('id: ISS-0001');
      expect(content).toContain('title: YAML Test');
      expect(content).toContain('status: open');
      expect(content).toContain('priority: low');
    });

    it('should include timestamps', async () => {
      const before = new Date().toISOString();
      const result = await createIssue({
        projectId: 'test-project',
        title: 'Timestamp Test',
      });
      const after = new Date().toISOString();

      expect(result.created_at).toBeDefined();
      expect(result.updated_at).toBeDefined();
      expect(result.created_at! >= before).toBe(true);
      expect(result.created_at! <= after).toBe(true);
    });

    it('should slugify title for filename', async () => {
      const result = await createIssue({
        projectId: 'test-project',
        title: 'Fix: User Authentication Bug!!!',
      });

      expect(result.filePath).toContain('ISS-0001-fix-user-authentication-bug.yml');
    });

    it('should truncate long slugs', async () => {
      const result = await createIssue({
        projectId: 'test-project',
        title: 'This is a very very very very very very very very very very long title that should be truncated',
      });

      // Slug should be max 50 chars
      const filename = path.basename(result.filePath);
      const slug = filename.replace(/^ISS-\d+-/, '').replace('.yml', '');
      expect(slug.length).toBeLessThanOrEqual(50);
    });
  });

  // ==========================================================================
  // Filter Functions Tests
  // ==========================================================================

  describe('filterByStatus', () => {
    const issues: SentinelIssue[] = [
      { id: 'ISS-0001', title: 'Open 1', project: 'test', status: 'open' },
      { id: 'ISS-0002', title: 'Open 2', project: 'test', status: 'open' },
      { id: 'ISS-0003', title: 'Done', project: 'test', status: 'done' },
      { id: 'ISS-0004', title: 'Blocked', project: 'test', status: 'blocked' },
    ];

    it('should filter by open status', () => {
      const result = filterByStatus(issues, 'open');
      expect(result).toHaveLength(2);
      expect(result.every((i) => i.status === 'open')).toBe(true);
    });

    it('should filter by done status', () => {
      const result = filterByStatus(issues, 'done');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('ISS-0003');
    });

    it('should return empty array if no matches', () => {
      const result = filterByStatus(issues, 'in_progress');
      expect(result).toHaveLength(0);
    });
  });

  describe('filterByEpicId', () => {
    const issues: SentinelIssue[] = [
      { id: 'ISS-0001', title: 'Epic 1', project: 'test', status: 'open', epicId: 'EPIC-0001' },
      { id: 'ISS-0002', title: 'Epic 1', project: 'test', status: 'open', epicId: 'EPIC-0001' },
      { id: 'ISS-0003', title: 'Epic 2', project: 'test', status: 'open', epicId: 'EPIC-0002' },
      { id: 'ISS-0004', title: 'No Epic', project: 'test', status: 'open' },
    ];

    it('should filter by epicId', () => {
      const result = filterByEpicId(issues, 'EPIC-0001');
      expect(result).toHaveLength(2);
      expect(result.every((i) => i.epicId === 'EPIC-0001')).toBe(true);
    });

    it('should return empty array if no matches', () => {
      const result = filterByEpicId(issues, 'EPIC-9999');
      expect(result).toHaveLength(0);
    });
  });
});
