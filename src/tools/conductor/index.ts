// ============================================================================
// Conductor Domain Tools
// ============================================================================
// Thin TS facade over the Python Conductor orchestrator (decibel-orchestrator).
//
//   run / dryrun  -> shell out to `python -m conductor.run` (the orchestrator)
//   trace / cost  -> read the append-only JSONL ledger directly (no Python)
//   egress/routing-> view the deterministic policy (`--policy`, view-only)
//
// Config via env:
//   CONDUCTOR_DIR     path to the decibel-orchestrator repo (has the `conductor` pkg)
//   CONDUCTOR_PYTHON  python executable (default: python3)
//   CONDUCTOR_LEDGER  ledger path (default: $CONDUCTOR_DIR/.decibel/conductor/trace.jsonl)
// ============================================================================

import { execFile } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { ToolSpec } from '../types.js';
import { toolSuccess, toolError } from '../shared/index.js';

const execFileAsync = promisify(execFile);

function conductorDir(): string {
  return process.env.CONDUCTOR_DIR || path.resolve(process.cwd(), '../decibel-orchestrator');
}

function ledgerPath(): string {
  return process.env.CONDUCTOR_LEDGER || path.join(conductorDir(), '.decibel/conductor/trace.jsonl');
}

/** Invoke the Python conductor CLI and parse its JSON stdout. */
async function cli(args: string[]): Promise<unknown> {
  const py = process.env.CONDUCTOR_PYTHON || 'python3';
  const { stdout } = await execFileAsync(py, ['-m', 'conductor.run', ...args], {
    cwd: conductorDir(),
    maxBuffer: 8 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

/** Read the JSONL ledger, optionally filtered to a request_id. */
function readLedger(requestId?: string): Record<string, unknown>[] {
  const p = ledgerPath();
  if (!existsSync(p)) return [];
  const rows = readFileSync(p, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => {
      try { return JSON.parse(l) as Record<string, unknown>; } // skip a partial line
      catch { return null; }
    })
    .filter((r): r is Record<string, unknown> => r !== null);
  return requestId ? rows.filter((r) => r.request_id === requestId) : rows;
}

// --- run --------------------------------------------------------------------

export const conductorRunTool: ToolSpec = {
  definition: {
    name: 'conductor_run',
    description: 'Orchestrate a request end-to-end through the sovereign Conductor (classify → egress gate → route → call → verify). Returns the answer plus a trace_id whose full routing decisions are auditable via conductor.trace. Proprietary/personal tasks never leave local hardware.',
    annotations: { title: 'Conductor Run', readOnlyHint: false, openWorldHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'The request to orchestrate.' },
        sensitivity: { type: 'string', enum: ['public', 'proprietary', 'personal'], description: 'Egress class. proprietary/personal stay on local hardware. Default public.' },
        difficulty: { type: 'number', description: 'Optional 0..1 override of the difficulty heuristic.' },
        project_id: { type: 'string', description: 'Project this run belongs to. Stamped on every trace row so HQ can join the session to project data.' },
      },
      required: ['task'],
    },
  },
  handler: async (args) => {
    try {
      const a: string[] = ['--sensitivity', args.sensitivity || 'public', '--ledger', ledgerPath()];
      if (typeof args.difficulty === 'number') a.push('--difficulty', String(args.difficulty));
      if (args.project_id) a.push('--project', String(args.project_id));
      a.push('--', args.task); // `--` stops option parsing so a task starting with "--" isn't a flag
      return toolSuccess(await cli(a));
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err), 'Is CONDUCTOR_DIR set and the local model server running?');
    }
  },
};

// --- dryrun -----------------------------------------------------------------

export const conductorDryrunTool: ToolSpec = {
  definition: {
    name: 'conductor_dryrun',
    description: 'Preview the plan and routing for a request WITHOUT executing it: shows which targets are allowed, what would egress, and the chosen route. No model call, no ledger write. Use to inspect egress before committing.',
    annotations: { title: 'Conductor Dry Run', readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'The request to plan.' },
        sensitivity: { type: 'string', enum: ['public', 'proprietary', 'personal'] },
        difficulty: { type: 'number' },
        project_id: { type: 'string', description: 'Project this run belongs to (echoed in the plan).' },
      },
      required: ['task'],
    },
  },
  handler: async (args) => {
    try {
      const a: string[] = ['--dryrun', '--sensitivity', args.sensitivity || 'public'];
      if (typeof args.difficulty === 'number') a.push('--difficulty', String(args.difficulty));
      if (args.project_id) a.push('--project', String(args.project_id));
      a.push('--', args.task); // `--` stops option parsing so a task starting with "--" isn't a flag
      return toolSuccess(await cli(a));
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err), 'Is CONDUCTOR_DIR set?');
    }
  },
};

// --- trace ------------------------------------------------------------------

export const conductorTraceTool: ToolSpec = {
  definition: {
    name: 'conductor_trace',
    description: 'Full append-only routing trace for a request id: every step, role, target, egress decision, capability route, and verdict.',
    annotations: { title: 'Conductor Trace', readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: { request_id: { type: 'string', description: 'The trace_id returned by conductor.run.' } },
      required: ['request_id'],
    },
  },
  handler: async (args) => {
    try {
      const steps = readLedger(args.request_id);
      if (steps.length === 0) return toolError(`no trace found for request_id=${args.request_id}`);
      return toolSuccess({ request_id: args.request_id, steps });
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// --- cost -------------------------------------------------------------------

export const conductorCostTool: ToolSpec = {
  definition: {
    name: 'conductor_cost',
    description: 'Cost + egress summary over a window: total steps, how many egressed off-hardware, cost (when the transport reports it), and a breakdown by target.',
    annotations: { title: 'Conductor Cost', readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        hours: { type: 'number', description: 'Window in hours. Omit for all-time.' },
        project_id: { type: 'string', description: 'Scope the summary to one project (the HQ join key). Omit for all projects.' },
      },
    },
  },
  handler: async (args) => {
    try {
      let rows = readLedger();
      if (typeof args.hours === 'number') {
        const cutoff = Date.now() - args.hours * 3600_000;
        rows = rows.filter((r) => typeof r.ts === 'string' && Date.parse(r.ts as string) >= cutoff);
      }
      if (args.project_id) rows = rows.filter((r) => r.project_id === args.project_id);
      const byTarget: Record<string, number> = {};
      const byRequest = new Map<string, { request_id: string; project_id: unknown; ts: string; steps: number; egressed: boolean; targets: Set<string> }>();
      let egressed = 0;
      let cost = 0;
      for (const r of rows) {
        byTarget[r.target as string] = (byTarget[r.target as string] || 0) + 1;
        if (r.egress === true) egressed += 1;
        if (typeof r.cost_usd === 'number') cost += r.cost_usd as number;
        const id = r.request_id as string;
        const g = byRequest.get(id) || { request_id: id, project_id: r.project_id ?? null, ts: r.ts as string, steps: 0, egressed: false, targets: new Set<string>() };
        g.steps += 1;
        g.ts = r.ts as string; // last step's ts
        if (r.egress === true) g.egressed = true;
        g.targets.add(r.target as string);
        byRequest.set(id, g);
      }
      const recent_requests = [...byRequest.values()]
        .sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))
        .slice(0, 50)
        .map((g) => ({ request_id: g.request_id, project_id: g.project_id, ts: g.ts, steps: g.steps, egressed: g.egressed, targets: [...g.targets] }));
      return toolSuccess({ window_hours: args.hours ?? null, project_id: args.project_id ?? null, requests: byRequest.size, steps: rows.length, egressed_steps: egressed, cost_usd: cost, by_target: byTarget, recent_requests });
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// --- egress / routing (view-only) -------------------------------------------

export const conductorEgressTool: ToolSpec = {
  definition: {
    name: 'conductor_egress',
    description: 'View the deterministic EgressPolicy (axis 1): which sensitivities stay on-hardware, the on-hardware host allowlist, and any trusted hosts. View-only — this policy is permanent code, never a runtime knob (spec §3.1).',
    annotations: { title: 'Conductor Egress Policy', readOnlyHint: true },
    inputSchema: { type: 'object', properties: {} },
  },
  handler: async () => {
    try {
      const policy = (await cli(['--policy'])) as { egress: unknown };
      return toolSuccess(policy.egress);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err), 'Is CONDUCTOR_DIR set?');
    }
  },
};

export const conductorRoutingTool: ToolSpec = {
  definition: {
    name: 'conductor_routing',
    description: 'View the CapabilityRouter (axis 2) configuration — the difficulty threshold above which a task warrants frontier (within what egress allows).',
    annotations: { title: 'Conductor Routing Policy', readOnlyHint: true },
    inputSchema: { type: 'object', properties: {} },
  },
  handler: async () => {
    try {
      const policy = (await cli(['--policy'])) as { routing: unknown };
      return toolSuccess(policy.routing);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err), 'Is CONDUCTOR_DIR set?');
    }
  },
};

export const conductorTools: ToolSpec[] = [
  conductorRunTool,
  conductorDryrunTool,
  conductorTraceTool,
  conductorCostTool,
  conductorEgressTool,
  conductorRoutingTool,
];
