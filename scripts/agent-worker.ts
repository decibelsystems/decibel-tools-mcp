#!/usr/bin/env -S npx tsx
// ============================================================================
// Agent Worker — v1 single-agent dispatch consumer
// ============================================================================
// Polls a project's `.decibel/agentic/jobs/` directory for queued jobs,
// claims the oldest one by setting status: running, shells out to
// `claude --print` to execute the prompt in the project's working dir,
// and writes the output back as `done` (or `failed` on error).
//
// Usage:
//   tsx scripts/agent-worker.ts <project-path>            # poll forever
//   tsx scripts/agent-worker.ts <project-path> --once     # one job and exit
//
// Single-agent assumption — no atomicity. If you run two workers against
// the same project they will both try to claim the same job. v2 will add
// daemon-mediated claim_job for multi-agent coordination.
//
// Stale-claim recovery is also v2 — if the worker crashes mid-job, the
// job stays in `running` state and must be manually reset (edit the YAML
// and set status: queued).
// ============================================================================

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

// ============================================================================
// Config
// ============================================================================

const POLL_INTERVAL_MS = 3000;
const CLAUDE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes per job

interface Job {
  id: string;
  project_id: string;
  prompt: string;
  status: 'queued' | 'claimed' | 'running' | 'done' | 'cancelled' | 'failed';
  claimed_by?: string;
  claimed_at?: string;
  completed_at?: string;
  result?: {
    output?: string;
    files_changed?: string[];
  };
  created_at: string;
  created_by?: string;
  [key: string]: unknown;
}

// ============================================================================
// Args
// ============================================================================

const args = process.argv.slice(2);
const projectPath = args.find((a) => !a.startsWith('--'));
const runOnce = args.includes('--once');

if (!projectPath) {
  console.error('Usage: tsx scripts/agent-worker.ts <project-path> [--once]');
  process.exit(1);
}

const PROJECT_ROOT = path.resolve(projectPath);
const JOBS_DIR = path.join(PROJECT_ROOT, '.decibel', 'agentic', 'jobs');
const AGENT_ID = `claude-code:${os.hostname()}:${process.pid}`;

// ============================================================================
// Queue I/O
// ============================================================================

async function listQueuedJobs(): Promise<{ filePath: string; job: Job }[]> {
  let files: string[];
  try {
    files = await fs.readdir(JOBS_DIR);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }

  const results: { filePath: string; job: Job }[] = [];
  for (const file of files) {
    if (!file.endsWith('.yml') && !file.endsWith('.yaml')) continue;
    const filePath = path.join(JOBS_DIR, file);
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const job = parseYaml(content) as Job;
      if (job && job.status === 'queued') {
        results.push({ filePath, job });
      }
    } catch (err) {
      console.error(`[agent] skipping malformed ${file}: ${(err as Error).message}`);
    }
  }

  results.sort((a, b) => a.job.created_at.localeCompare(b.job.created_at));
  return results;
}

async function writeJob(filePath: string, job: Job): Promise<void> {
  await fs.writeFile(filePath, stringifyYaml(job), 'utf-8');
}

// ============================================================================
// Claude CLI bridge
// ============================================================================

function execClaude(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('claude', ['--print'], {
      cwd: PROJECT_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });

    let stdout = '';
    let stderr = '';
    let killed = false;

    const timeout = setTimeout(() => {
      killed = true;
      proc.kill('SIGTERM');
      reject(new Error(`claude timed out after ${CLAUDE_TIMEOUT_MS / 1000}s`));
    }, CLAUDE_TIMEOUT_MS);

    proc.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`failed to spawn claude: ${err.message}`));
    });
    proc.on('close', (code) => {
      clearTimeout(timeout);
      if (killed) return;
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`claude exited ${code}: ${stderr.trim() || stdout.trim()}`));
      }
    });

    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}

// ============================================================================
// Worker loop
// ============================================================================

async function processOne(): Promise<boolean> {
  const queued = await listQueuedJobs();
  if (queued.length === 0) return false;

  const { filePath, job } = queued[0];
  const preview = job.prompt.length > 80 ? `${job.prompt.slice(0, 80)}…` : job.prompt;
  console.log(`[agent] claiming ${job.id}: "${preview}"`);

  const claimed: Job = {
    ...job,
    status: 'running',
    claimed_by: AGENT_ID,
    claimed_at: new Date().toISOString(),
  };
  await writeJob(filePath, claimed);

  try {
    const output = await execClaude(job.prompt);
    const done: Job = {
      ...claimed,
      status: 'done',
      completed_at: new Date().toISOString(),
      result: { output },
    };
    await writeJob(filePath, done);
    console.log(`[agent] ${job.id} → done (${output.length} chars)`);
  } catch (err) {
    const failed: Job = {
      ...claimed,
      status: 'failed',
      completed_at: new Date().toISOString(),
      result: { output: (err as Error).message },
    };
    await writeJob(filePath, failed);
    console.error(`[agent] ${job.id} → failed: ${(err as Error).message}`);
  }

  return true;
}

async function main(): Promise<void> {
  console.log(`[agent] starting`);
  console.log(`[agent] project:  ${PROJECT_ROOT}`);
  console.log(`[agent] queue:    ${JOBS_DIR}`);
  console.log(`[agent] agent-id: ${AGENT_ID}`);
  console.log(`[agent] mode:     ${runOnce ? 'once' : `poll every ${POLL_INTERVAL_MS / 1000}s`}`);

  let running = true;
  process.on('SIGINT', () => {
    console.log('\n[agent] SIGINT — exiting after current job');
    running = false;
  });

  while (running) {
    try {
      const processed = await processOne();
      if (runOnce) {
        if (!processed) console.log('[agent] queue empty — exiting');
        break;
      }
    } catch (err) {
      console.error(`[agent] tick error:`, err);
    }
    if (!running) break;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  console.log('[agent] stopped');
}

main().catch((err) => {
  console.error('[agent] fatal:', err);
  process.exit(1);
});
