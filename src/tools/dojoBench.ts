/**
 * Dojo Benchmark Tool
 *
 * MCP tool for running standardized performance benchmarks on Dojo experiments.
 * Specialized subclass of decibel_bench that discovers benchmarks from experiments.
 *
 * Experiments opt into benchmarking by exporting:
 * - Python: DOJO_BENCHMARKS dict or dojo_benchmark() function
 * - TypeScript: DOJO_BENCHMARKS object or dojoBenchmark() function
 *
 * Ref: WISH-0002 (Dojo Benchmark Tool)
 */

import { spawn } from 'child_process';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { log } from '../config.js';
import { buildDojoContext, finishDojoRequest, DojoContext } from './dojo.js';
import { CallerRole } from './dojoPolicy.js';
import { generatePythonBenchRunner } from './bench.js';
import {
  BenchKind,
  BenchmarkReport,
  formatTable,
  formatMarkdown,
} from '../lib/benchmark.js';

// ============================================================================
// Kind Defaults (match lib/benchmark.ts)
// ============================================================================

const KIND_DEFAULTS: Record<BenchKind, {
  iterations: number;
  warmup: number;
  threshold_p99_ns: number;
}> = {
  micro: {
    iterations: 10000,
    warmup: 1000,
    threshold_p99_ns: 100_000,      // 100μs
  },
  integration: {
    iterations: 100,
    warmup: 10,
    threshold_p99_ns: 500_000_000,  // 500ms
  },
};

// ============================================================================
// Types
// ============================================================================

export interface DojoBenchInput {
  project_id: string;
  experiment_id: string;
  kind?: BenchKind;              // 'micro' or 'integration'
  iterations?: number;
  warmup?: number;
  threshold_p99_ns?: number;     // Override threshold
  save_baseline?: boolean;
  check_regression?: boolean;
  regression_tolerance?: number;  // e.g., 0.10 = 10%
  output_format?: 'table' | 'json' | 'markdown';
  caller_role?: CallerRole;
  agent_id?: string;
}

export interface DojoBenchOutput {
  experiment_id: string;
  status: 'success' | 'no_benchmarks' | 'regression_detected' | 'error';
  report?: BenchmarkReport;
  formatted?: string;
  message?: string;
}

export interface DojoBenchError {
  error: string;
  exitCode: number;
  stderr: string;
}

// ============================================================================
// Main Tool Implementation
// ============================================================================

/**
 * Run benchmarks on a Dojo experiment
 */
export async function dojoBench(
  input: DojoBenchInput
): Promise<DojoBenchOutput | DojoBenchError> {
  const callerRole = input.caller_role || 'human';
  let ctx: DojoContext;

  try {
    ctx = await buildDojoContext(
      input.project_id,
      callerRole,
      'dojo_bench',
      input.agent_id
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      error: message,
      exitCode: 1,
      stderr: message,
    };
  }

  try {
    // Find experiment directory
    const experimentPath = path.join(ctx.dojoRoot, 'experiments', input.experiment_id);

    try {
      await fs.access(experimentPath);
    } catch {
      return {
        error: `Experiment not found: ${input.experiment_id}`,
        exitCode: 1,
        stderr: `Directory does not exist: ${experimentPath}`,
      };
    }

    // Check for run.py
    const runPy = path.join(experimentPath, 'run.py');
    try {
      await fs.access(runPy);
    } catch {
      return {
        error: `No run.py in experiment: ${input.experiment_id}`,
        exitCode: 1,
        stderr: `File does not exist: ${runPy}`,
      };
    }

    // Determine kind and defaults
    const kind = input.kind || 'micro';
    const defaults = KIND_DEFAULTS[kind];
    const iterations = input.iterations ?? defaults.iterations;
    const warmup = input.warmup ?? defaults.warmup;
    const thresholdNs = input.threshold_p99_ns ?? defaults.threshold_p99_ns;

    // Baseline path for regression detection
    const baselinePath = input.check_regression
      ? path.join(ctx.dojoRoot, 'benchmarks', `${input.experiment_id}-baseline.json`)
      : undefined;

    // Generate and run Python benchmark script
    const script = generatePythonBenchRunner(
      experimentPath,
      kind,
      iterations,
      warmup,
      thresholdNs,
      baselinePath,
      input.regression_tolerance
    );

    log(`dojo-bench: Running ${kind} benchmark for ${input.experiment_id}`);

    const result = await new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve) => {
      const proc = spawn('python3', ['-c', script], {
        cwd: experimentPath,
        env: { ...process.env },
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on('error', (err) => {
        resolve({ stdout: '', stderr: err.message, exitCode: -1 });
      });

      proc.on('close', (code) => {
        resolve({ stdout, stderr, exitCode: code ?? -1 });
      });
    });

    if (result.exitCode !== 0 && !result.stdout) {
      return {
        error: `Benchmark failed with exit code ${result.exitCode}`,
        exitCode: result.exitCode,
        stderr: result.stderr,
      };
    }

    // Parse JSON output
    let parsed: {
      status: string;
      message?: string;
      report?: BenchmarkReport;
      error?: string;
    };
    try {
      parsed = JSON.parse(result.stdout.trim());
    } catch {
      return {
        error: 'Failed to parse benchmark output',
        exitCode: 1,
        stderr: `Invalid JSON: ${result.stdout}`,
      };
    }

    if (parsed.error) {
      return {
        error: parsed.error,
        exitCode: 1,
        stderr: parsed.error,
      };
    }

    if (parsed.status === 'no_benchmarks') {
      return {
        experiment_id: input.experiment_id,
        status: 'no_benchmarks',
        message: parsed.message || 'No benchmarks found',
      };
    }

    if (!parsed.report) {
      return {
        error: 'No report in benchmark output',
        exitCode: 1,
        stderr: 'Unexpected output format',
      };
    }

    // Save baseline if requested
    if (input.save_baseline && parsed.report) {
      const baselineDir = path.join(ctx.dojoRoot, 'benchmarks');
      const baselineFile = path.join(baselineDir, `${input.experiment_id}-baseline.json`);

      try {
        await fs.mkdir(baselineDir, { recursive: true });

        const baseline = {
          suite_id: input.experiment_id,
          platform: parsed.report.platform,
          results: Object.fromEntries(
            parsed.report.results.map(r => [r.id, {
              p99_ns: r.p99_ns,
              p95_ns: r.p95_ns,
              mean_ns: r.mean_ns,
            }])
          ),
          created_at: new Date().toISOString(),
        };

        await fs.writeFile(baselineFile, JSON.stringify(baseline, null, 2));
        log(`dojo-bench: Saved baseline to ${baselineFile}`);
      } catch (err) {
        log(`dojo-bench: Failed to save baseline: ${err}`);
      }
    }

    // Format output
    const outputFormat = input.output_format || 'json';
    let formatted: string | undefined;

    if (outputFormat === 'table') {
      formatted = formatTable(parsed.report);
    } else if (outputFormat === 'markdown') {
      formatted = formatMarkdown(parsed.report);
    }

    return {
      experiment_id: input.experiment_id,
      status: parsed.status as 'success' | 'regression_detected',
      report: parsed.report,
      formatted,
    };
  } finally {
    finishDojoRequest(callerRole);
  }
}

/**
 * Type guard for DojoBenchError
 */
export function isDojoBenchError(result: unknown): result is DojoBenchError {
  return (
    typeof result === 'object' &&
    result !== null &&
    'error' in result &&
    'exitCode' in result
  );
}
