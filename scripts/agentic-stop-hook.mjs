#!/usr/bin/env node
// ============================================================================
// Agentic Dispatch — Stop-hook auto-pickup
// ============================================================================
// A Claude Code `Stop` hook. Fires when an interactive session finishes a
// turn. If the session's project has auto-pickup enabled AND a queued
// dispatch job is waiting, this hook claims the oldest job and *blocks the
// stop*, feeding the job's prompt back as the session's next instruction.
//
// The session then works the job as if the user had typed it, and on its
// next stop the hook fires again — draining the queue one job per turn.
//
// This is the "session pull" backend made automatic: HQ enqueues, and the
// project's live VS Code / terminal session picks the work up on its own.
//
//   Wiring:   ~/.claude/settings.json → hooks.Stop → this script
//   Per-project toggle:  <project>/.decibel/agentic/auto-pickup.on
//     • file present → auto-pickup ON for that project
//     • file absent  → OFF (hook is a no-op)
//
// FAIL-OPEN: any error, or any "nothing to do" path, exits 0 with no output
// so the session stops normally. A Stop hook must never trap the user.
//
// Loop safety: the hook *claims* the job (queued → running) before
// injecting it, so the same job is never re-injected. The queue strictly
// shrinks; when no `queued` job remains the hook stops blocking. No
// `stop_hook_active` guard is needed.
//
// Single-agent: like the headless worker, claiming is not atomic. Don't run
// this hook and scripts/agent-worker.ts against the same project at once.
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf-8');
  } catch {
    return '';
  }
}

/** Walk up from startDir until a directory containing `.decibel/` is found. */
function findProjectRoot(startDir) {
  let dir = path.resolve(startDir);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.decibel'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function main() {
  const payload = (() => {
    try {
      return JSON.parse(readStdin());
    } catch {
      return {};
    }
  })();

  const cwd = payload.cwd || process.cwd();
  const sessionId = String(payload.session_id || 'unknown');

  const root = findProjectRoot(cwd);
  if (!root) return; // not inside a decibel project

  const agenticDir = path.join(root, '.decibel', 'agentic');
  const toggle = path.join(agenticDir, 'auto-pickup.on');
  if (!fs.existsSync(toggle)) return; // auto-pickup disabled for this project

  const jobsDir = path.join(agenticDir, 'jobs');
  if (!fs.existsSync(jobsDir)) return;

  // Collect queued jobs.
  const queued = [];
  for (const file of fs.readdirSync(jobsDir)) {
    if (!file.endsWith('.yml') && !file.endsWith('.yaml')) continue;
    const filePath = path.join(jobsDir, file);
    try {
      const job = parseYaml(fs.readFileSync(filePath, 'utf-8'));
      if (job && job.status === 'queued' && job.id && job.prompt) {
        queued.push({ filePath, job });
      }
    } catch {
      // skip malformed file
    }
  }
  if (queued.length === 0) return; // nothing to pick up — stop normally

  queued.sort((a, b) =>
    String(a.job.created_at).localeCompare(String(b.job.created_at)),
  );
  const { filePath, job } = queued[0];

  // Claim it — flip queued → running so it is never re-injected.
  const claimed = {
    ...job,
    status: 'running',
    claimed_by: `claude-code-session:${os.hostname()}:${sessionId.slice(0, 8)}`,
    claimed_at: new Date().toISOString(),
  };
  fs.writeFileSync(filePath, stringifyYaml(claimed), 'utf-8');

  const reason = [
    `[agentic auto-pickup] You are now working dispatched job ${job.id} from`,
    `this project's queue (${root}).`,
    ``,
    `Job file: ${filePath}`,
    `It has already been claimed for you — status is "running".`,
    ``,
    `Execute the following prompt exactly as if the user had typed it:`,
    `--- PROMPT ---`,
    String(job.prompt),
    `--- END PROMPT ---`,
    ``,
    `When you finish, edit the job file above and set:`,
    `  status: done            (or "failed" if you could not complete it)`,
    `  completed_at:            current UTC ISO-8601 timestamp`,
    `  result:`,
    `    output:               a concise summary of what you actually did`,
    `    files_changed:        the real files touched — from`,
    `                          \`git -C ${root} diff --stat\` (empty list if none)`,
    ``,
    `Then tell the user ${job.id} is complete. Any further queued jobs will be`,
    `picked up automatically on your next stop. To turn auto-pickup off, the`,
    `user can delete: ${toggle}`,
  ].join('\n');

  process.stderr.write(`[agentic auto-pickup] claimed ${job.id}\n`);
  process.stdout.write(JSON.stringify({ decision: 'block', reason }));
}

try {
  main();
} catch {
  // Fail open — never block the user because a hook misbehaved.
}
process.exit(0);
