// ============================================================================
// Agentic Dispatch Jobs
// ============================================================================
// User-queued prompts that agents (Claude Code, Codex, etc.) read from the
// project's `.decibel/agentic/jobs/` directory and execute. HQ writes via
// agentic.enqueue; agents claim and complete via their MCP tool calls.
//
// See docs-hq/AGENTIC_DISPATCH.md (in the HQ repo) for the full 3-layer
// contract this implements.
// ============================================================================

import fs from 'fs/promises';
import path from 'path';
import { parse as parseYaml, parseAllDocuments, stringify as stringifyYaml } from 'yaml';
import { log } from './config.js';
import { getWritePath, readFilesFromBothPaths } from './decibelPaths.js';

// ============================================================================
// Types
// ============================================================================

export type JobStatus =
  | 'queued'
  | 'claimed'
  | 'running'
  | 'done'
  | 'cancelled'
  | 'failed';

export interface AgenticJob {
  id: string;
  project_id: string;
  prompt: string;
  status: JobStatus;
  claimed_by?: string;
  claimed_at?: string;
  completed_at?: string;
  result?: {
    output?: string;
    files_changed?: string[];
  };
  created_at: string;
  created_by?: string;
  // Allow extras for forward compatibility
  [key: string]: unknown;
}

export interface EnqueueJobInput {
  projectId: string;
  prompt: string;
  createdBy?: string;
}

export interface EnqueueJobOutput {
  jobId: string;
  queuePosition: number;
  filePath: string;
}

export interface CancelJobInput {
  projectId: string;
  jobId: string;
}

// ============================================================================
// Constants
// ============================================================================

const JOBS_SUBPATH = 'agentic/jobs';

// ============================================================================
// Helpers
// ============================================================================

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 40);
}

function extractJobNumber(id: string): number {
  const match = id.match(/^JOB-(\d+)$/i);
  return match ? parseInt(match[1], 10) : 0;
}

function formatJobId(num: number): string {
  return `JOB-${num.toString().padStart(4, '0')}`;
}

async function ensureDir(dirPath: string): Promise<void> {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch {
    // Directory already exists or other error — list/write will surface real issues
  }
}

/**
 * Multi-document YAML parser. Frontmatter format (--- delimited) returns
 * the first doc; plain YAML returns directly. Mirrors sentinelIssues.ts.
 */
function safeParseYaml(content: string): Record<string, unknown> {
  try {
    return parseYaml(content) as Record<string, unknown>;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes('multiple documents')) throw err;
  }
  const docs = parseAllDocuments(content);
  if (docs.length === 0) throw new Error('No YAML documents found');
  const first = docs[0].toJSON();
  if (typeof first !== 'object' || first === null) {
    throw new Error('First YAML document is not an object');
  }
  return first as Record<string, unknown>;
}

function parseJobFile(content: string, fallbackProjectId: string): AgenticJob | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = safeParseYaml(content);
  } catch (err) {
    log(`agenticJobs: failed to parse job YAML: ${(err as Error).message}`);
    return null;
  }
  const id = parsed.id as string;
  const prompt = parsed.prompt as string;
  if (!id || !prompt) return null;

  return {
    id,
    project_id: (parsed.project_id as string) || fallbackProjectId,
    prompt,
    status: (parsed.status as JobStatus) || 'queued',
    claimed_by: parsed.claimed_by as string | undefined,
    claimed_at: parsed.claimed_at as string | undefined,
    completed_at: parsed.completed_at as string | undefined,
    result: parsed.result as AgenticJob['result'],
    created_at: (parsed.created_at as string) || new Date().toISOString(),
    created_by: parsed.created_by as string | undefined,
  };
}

function jobToYaml(job: AgenticJob): string {
  return stringifyYaml(job);
}

// ============================================================================
// Public API
// ============================================================================

/**
 * List all jobs for a project. Returns oldest-first (creation order). Reads
 * from both .decibel/ and decibel/ paths, deduplicating by id.
 */
export async function listJobs(projectId: string): Promise<AgenticJob[]> {
  const seen = new Set<string>();
  const jobs: AgenticJob[] = [];
  const files = await readFilesFromBothPaths(projectId, JOBS_SUBPATH);

  for (const { filePath } of files) {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const job = parseJobFile(content, projectId);
      if (!job || seen.has(job.id)) continue;
      seen.add(job.id);
      jobs.push(job);
    } catch (err) {
      log(`agenticJobs: skipping ${filePath} — ${(err as Error).message}`);
    }
  }

  // Sort oldest-first by creation timestamp
  jobs.sort((a, b) => a.created_at.localeCompare(b.created_at));
  return jobs;
}

/**
 * Enqueue a new dispatch job. Allocates the next JOB-NNNN id, writes the
 * YAML file, and returns the id + queue position (number of active jobs
 * ahead of this one, inclusive).
 */
export async function enqueueJob(input: EnqueueJobInput): Promise<EnqueueJobOutput> {
  const { projectId, prompt, createdBy } = input;
  if (!prompt || !prompt.trim()) {
    throw new Error('prompt is required');
  }

  const dir = await getWritePath(projectId, JOBS_SUBPATH);
  await ensureDir(dir);

  const existing = await listJobs(projectId);
  const maxNum = existing.reduce((max, j) => Math.max(max, extractJobNumber(j.id)), 0);
  const newId = formatJobId(maxNum + 1);

  const slug = slugify(prompt);
  const filename = slug ? `${newId}-${slug}.yml` : `${newId}.yml`;
  const filePath = path.join(dir, filename);

  const now = new Date().toISOString();
  const job: AgenticJob = {
    id: newId,
    project_id: projectId,
    prompt: prompt.trim(),
    status: 'queued',
    created_at: now,
    ...(createdBy ? { created_by: createdBy } : {}),
  };

  await fs.writeFile(filePath, jobToYaml(job), 'utf-8');
  log(`agenticJobs: enqueued ${newId} for project ${projectId}`);

  // Queue position = count of "active" jobs (not done / cancelled / failed)
  // including this new one. Useful for UX.
  const activeCount =
    existing.filter(
      (j) => j.status === 'queued' || j.status === 'claimed' || j.status === 'running',
    ).length + 1;

  return { jobId: newId, queuePosition: activeCount, filePath };
}

/**
 * Cancel a queued / claimed job. No-op if the job is already terminal
 * (done / cancelled / failed). Marks status: cancelled and stamps
 * completed_at.
 */
export async function cancelJob(input: CancelJobInput): Promise<AgenticJob> {
  const { projectId, jobId } = input;
  if (!jobId.match(/^JOB-\d+$/)) {
    throw new Error(`Invalid job id: ${jobId} (expected JOB-NNNN)`);
  }

  const files = await readFilesFromBothPaths(projectId, JOBS_SUBPATH);
  for (const { filePath } of files) {
    const content = await fs.readFile(filePath, 'utf-8');
    const job = parseJobFile(content, projectId);
    if (!job || job.id !== jobId) continue;

    // Already-terminal jobs are not re-cancelled but still return the
    // current state so callers can refresh UI.
    if (job.status === 'done' || job.status === 'cancelled' || job.status === 'failed') {
      return job;
    }

    const updated: AgenticJob = {
      ...job,
      status: 'cancelled',
      completed_at: new Date().toISOString(),
    };
    await fs.writeFile(filePath, jobToYaml(updated), 'utf-8');
    log(`agenticJobs: cancelled ${jobId} for project ${projectId}`);
    return updated;
  }

  throw new Error(`Job not found: ${jobId}`);
}
