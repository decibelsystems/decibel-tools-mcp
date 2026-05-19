import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import {
  listJobs,
  enqueueJob,
  cancelJob,
  AgenticJob,
} from '../../src/agenticJobs.js';
import {
  createTestContext,
  cleanupTestContext,
  TestContext,
} from '../utils/test-context.js';

vi.mock('../../src/projectPaths.js', () => ({
  resolveProjectRoot: vi.fn(),
}));

import { resolveProjectRoot } from '../../src/projectPaths.js';

describe('agenticJobs', () => {
  let ctx: TestContext;
  let projectRoot: string;
  let jobsDir: string;

  beforeEach(async () => {
    ctx = await createTestContext();
    projectRoot = ctx.rootDir;
    jobsDir = path.join(projectRoot, '.decibel', 'agentic', 'jobs');

    vi.mocked(resolveProjectRoot).mockResolvedValue({
      projectId: 'test-project',
      projectName: 'Test Project',
      root: projectRoot,
    });

    await fs.mkdir(jobsDir, { recursive: true });
  });

  afterEach(async () => {
    await cleanupTestContext(ctx);
    vi.resetAllMocks();
  });

  // ==========================================================================
  // listJobs
  // ==========================================================================

  describe('listJobs', () => {
    it('returns empty array when no jobs exist', async () => {
      const jobs = await listJobs('test-project');
      expect(jobs).toEqual([]);
    });

    it('loads jobs from YAML files', async () => {
      const yaml = `id: JOB-0001
project_id: test-project
prompt: Add tests for the auth module
status: queued
created_at: 2026-05-01T10:00:00Z
`;
      await fs.writeFile(path.join(jobsDir, 'JOB-0001-add-tests.yml'), yaml);

      const jobs = await listJobs('test-project');

      expect(jobs).toHaveLength(1);
      expect(jobs[0].id).toBe('JOB-0001');
      expect(jobs[0].prompt).toBe('Add tests for the auth module');
      expect(jobs[0].status).toBe('queued');
    });

    it('sorts oldest-first by created_at', async () => {
      const j2 = `id: JOB-0002
project_id: test-project
prompt: second
status: queued
created_at: 2026-05-03T10:00:00Z
`;
      const j1 = `id: JOB-0001
project_id: test-project
prompt: first
status: queued
created_at: 2026-05-01T10:00:00Z
`;
      await fs.writeFile(path.join(jobsDir, 'JOB-0002-second.yml'), j2);
      await fs.writeFile(path.join(jobsDir, 'JOB-0001-first.yml'), j1);

      const jobs = await listJobs('test-project');
      expect(jobs.map((j) => j.id)).toEqual(['JOB-0001', 'JOB-0002']);
    });

    it('skips malformed YAML files without throwing', async () => {
      await fs.writeFile(path.join(jobsDir, 'JOB-0001-bad.yml'), 'not: valid: yaml: content:::');
      // Valid file alongside the bad one
      const good = `id: JOB-0002
project_id: test-project
prompt: good
status: queued
created_at: 2026-05-01T10:00:00Z
`;
      await fs.writeFile(path.join(jobsDir, 'JOB-0002-good.yml'), good);

      const jobs = await listJobs('test-project');
      expect(jobs).toHaveLength(1);
      expect(jobs[0].id).toBe('JOB-0002');
    });

    it('skips files missing id or prompt', async () => {
      const noId = `project_id: test-project
prompt: missing id
status: queued
created_at: 2026-05-01T10:00:00Z
`;
      const noPrompt = `id: JOB-0001
project_id: test-project
status: queued
created_at: 2026-05-01T10:00:00Z
`;
      await fs.writeFile(path.join(jobsDir, 'no-id.yml'), noId);
      await fs.writeFile(path.join(jobsDir, 'JOB-0001-no-prompt.yml'), noPrompt);

      const jobs = await listJobs('test-project');
      expect(jobs).toEqual([]);
    });
  });

  // ==========================================================================
  // enqueueJob
  // ==========================================================================

  describe('enqueueJob', () => {
    it('writes a YAML file with status: queued', async () => {
      const result = await enqueueJob({
        projectId: 'test-project',
        prompt: 'Add tests',
      });

      expect(result.jobId).toBe('JOB-0001');
      expect(result.queuePosition).toBe(1);

      const content = await fs.readFile(result.filePath, 'utf-8');
      expect(content).toContain('id: JOB-0001');
      expect(content).toContain('prompt: Add tests');
      expect(content).toContain('status: queued');
    });

    it('allocates sequential ids based on existing jobs', async () => {
      const a = await enqueueJob({ projectId: 'test-project', prompt: 'first' });
      const b = await enqueueJob({ projectId: 'test-project', prompt: 'second' });
      const c = await enqueueJob({ projectId: 'test-project', prompt: 'third' });

      expect(a.jobId).toBe('JOB-0001');
      expect(b.jobId).toBe('JOB-0002');
      expect(c.jobId).toBe('JOB-0003');
    });

    it('skips ids of cancelled/done jobs when allocating', async () => {
      // Pre-seed a cancelled JOB-0005 — next id should be 0006, not 0001
      const yaml = `id: JOB-0005
project_id: test-project
prompt: previous
status: cancelled
created_at: 2026-05-01T10:00:00Z
`;
      await fs.writeFile(path.join(jobsDir, 'JOB-0005-previous.yml'), yaml);

      const result = await enqueueJob({ projectId: 'test-project', prompt: 'next' });
      expect(result.jobId).toBe('JOB-0006');
    });

    it('queuePosition counts only active jobs', async () => {
      // Seed a cancelled job — should not count toward queue position
      await fs.writeFile(
        path.join(jobsDir, 'JOB-0001-old.yml'),
        `id: JOB-0001
project_id: test-project
prompt: old
status: cancelled
created_at: 2026-05-01T10:00:00Z
`,
      );
      // Seed an active (queued) job — should count
      await fs.writeFile(
        path.join(jobsDir, 'JOB-0002-pending.yml'),
        `id: JOB-0002
project_id: test-project
prompt: pending
status: queued
created_at: 2026-05-02T10:00:00Z
`,
      );

      const result = await enqueueJob({ projectId: 'test-project', prompt: 'new' });
      // 1 active (JOB-0002) + this new one = position 2
      expect(result.queuePosition).toBe(2);
    });

    it('records createdBy when provided', async () => {
      const result = await enqueueJob({
        projectId: 'test-project',
        prompt: 'who did it',
        createdBy: 'richovercash',
      });
      const content = await fs.readFile(result.filePath, 'utf-8');
      expect(content).toContain('created_by: richovercash');
    });

    it('rejects empty prompt', async () => {
      await expect(
        enqueueJob({ projectId: 'test-project', prompt: '   ' }),
      ).rejects.toThrow('prompt is required');
    });

    it('trims whitespace from prompt before writing', async () => {
      const result = await enqueueJob({
        projectId: 'test-project',
        prompt: '  spaced  ',
      });
      const content = await fs.readFile(result.filePath, 'utf-8');
      expect(content).toContain('prompt: spaced');
      expect(content).not.toContain('prompt: "  spaced  "');
    });
  });

  // ==========================================================================
  // cancelJob
  // ==========================================================================

  describe('cancelJob', () => {
    it('cancels a queued job and stamps completed_at', async () => {
      const enqueued = await enqueueJob({
        projectId: 'test-project',
        prompt: 'cancel me',
      });

      const cancelled = await cancelJob({
        projectId: 'test-project',
        jobId: enqueued.jobId,
      });

      expect(cancelled.status).toBe('cancelled');
      expect(cancelled.completed_at).toBeTruthy();

      // Verify on-disk state matches
      const content = await fs.readFile(enqueued.filePath, 'utf-8');
      expect(content).toContain('status: cancelled');
    });

    it('is a no-op for already-terminal jobs', async () => {
      // Pre-seed a done job
      const yaml = `id: JOB-0001
project_id: test-project
prompt: already done
status: done
created_at: 2026-05-01T10:00:00Z
completed_at: 2026-05-01T11:00:00Z
`;
      await fs.writeFile(path.join(jobsDir, 'JOB-0001-done.yml'), yaml);

      const result = await cancelJob({
        projectId: 'test-project',
        jobId: 'JOB-0001',
      });

      // Returns the existing terminal state unchanged
      expect(result.status).toBe('done');
      expect(result.completed_at).toBe('2026-05-01T11:00:00Z');
    });

    it('throws on invalid job id format', async () => {
      await expect(
        cancelJob({ projectId: 'test-project', jobId: 'not-a-job-id' }),
      ).rejects.toThrow('Invalid job id');
    });

    it('throws when job id is not found', async () => {
      await expect(
        cancelJob({ projectId: 'test-project', jobId: 'JOB-9999' }),
      ).rejects.toThrow('Job not found');
    });
  });

  // ==========================================================================
  // End-to-end flow
  // ==========================================================================

  describe('end-to-end flow', () => {
    it('enqueue → list → cancel → list reflects state correctly', async () => {
      const a = await enqueueJob({ projectId: 'test-project', prompt: 'one' });
      const b = await enqueueJob({ projectId: 'test-project', prompt: 'two' });
      await enqueueJob({ projectId: 'test-project', prompt: 'three' });

      let jobs = await listJobs('test-project');
      expect(jobs).toHaveLength(3);
      expect(jobs.every((j: AgenticJob) => j.status === 'queued')).toBe(true);

      await cancelJob({ projectId: 'test-project', jobId: b.jobId });

      jobs = await listJobs('test-project');
      const byId = Object.fromEntries(jobs.map((j) => [j.id, j]));
      expect(byId[a.jobId].status).toBe('queued');
      expect(byId[b.jobId].status).toBe('cancelled');
    });
  });
});
