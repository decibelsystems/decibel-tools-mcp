/**
 * Decibel Benchmark MCP Tool
 *
 * First-class benchmarking tool for the decibel toolchain.
 * Runs benchmark suites with kind support (micro/integration),
 * baseline persistence, and regression detection.
 *
 * Usage:
 *   - decibel_bench: Run TypeScript/JavaScript benchmark suites
 *   - dojo_bench: Specialized for Dojo experiments (Python discovery)
 */

import { spawn } from 'child_process';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { log } from '../config.js';
import { resolveProjectRoot } from '../projectPaths.js';
import { CallerRole, enforceToolAccess } from './dojoPolicy.js';
import { checkRateLimit, recordRequestStart, recordRequestEnd } from './rateLimiter.js';
import {
  BenchKind,
  BenchmarkReport,
  BenchmarkResult,
  BenchmarkOptions,
  Baseline,
  runBenchmarkSuite,
  formatTable,
  formatMarkdown,
  getPlatformFingerprint,
} from '../lib/benchmark.js';

// ============================================================================
// Types
// ============================================================================

export interface DecibelBenchInput {
  project_id: string;
  suite_id: string;              // Identifier for the benchmark suite
  kind?: BenchKind;             // 'micro' or 'integration'
  iterations?: number;
  warmup?: number;
  threshold_p99_ns?: number;    // Override default threshold
  save_baseline?: boolean;       // Write results as new baseline
  check_regression?: boolean;    // Compare against baseline
  regression_tolerance?: number; // e.g., 0.10 = 10%
  output_format?: 'table' | 'json' | 'markdown';
  caller_role?: CallerRole;
  agent_id?: string;
}

export interface DecibelBenchOutput {
  suite_id: string;
  status: 'success' | 'no_benchmarks' | 'regression_detected' | 'error';
  report?: BenchmarkReport;
  formatted?: string;
  message?: string;
}

export interface DecibelBenchError {
  error: string;
  exitCode: number;
  stderr: string;
}

// Compare tool types
export interface BenchCompareInput {
  project_id: string;
  baseline_a: string;           // Path to baseline A (or 'current' for live run)
  baseline_b: string;           // Path to baseline B
  output_format?: 'table' | 'json' | 'markdown';
  caller_role?: CallerRole;
  agent_id?: string;
}

export interface BenchDelta {
  id: string;
  a_p99_ns: number;
  b_p99_ns: number;
  delta_ns: number;
  delta_pct: number;
  winner: 'a' | 'b' | 'tie';
}

export interface BenchCompareOutput {
  status: 'success' | 'error';
  baseline_a: string;
  baseline_b: string;
  deltas: BenchDelta[];
  summary: {
    a_wins: number;
    b_wins: number;
    ties: number;
    overall_winner: 'a' | 'b' | 'tie';
    avg_delta_pct: number;
  };
  formatted?: string;
}

export interface BenchCompareError {
  error: string;
  exitCode: number;
}

// ============================================================================
// Helper: Build context with policy enforcement
// ============================================================================

async function buildBenchContext(
  projectId: string,
  callerRole: CallerRole = 'human',
  toolName: string,
  agentId?: string
): Promise<{ projectRoot: string }> {
  // Check rate limits
  const rateLimitResult = checkRateLimit(callerRole);
  if (!rateLimitResult.allowed) {
    throw new Error(`Rate limit: ${rateLimitResult.reason}`);
  }

  // Enforce policy
  enforceToolAccess(toolName, callerRole);

  // Record request start
  recordRequestStart(callerRole);

  // Resolve paths
  const project = await resolveProjectRoot(projectId);

  // Audit log for AI callers
  if (callerRole !== 'human') {
    log(`bench-audit: [${new Date().toISOString()}] agent=${agentId || 'unknown'} role=${callerRole} tool=${toolName} project=${projectId}`);
  }

  return { projectRoot: project.root };
}

// ============================================================================
// Python Benchmark Runner (for Dojo experiments)
// ============================================================================

/**
 * Generate Python script to discover and run benchmarks from experiments
 */
export function generatePythonBenchRunner(
  experimentPath: string,
  kind: BenchKind,
  iterations: number,
  warmup: number,
  thresholdNs: number,
  baselinePath?: string,
  regressionTolerance?: number
): string {
  return `#!/usr/bin/env python3
"""Benchmark runner for Dojo experiments - auto-generated"""

import json
import sys
import time
import statistics
import importlib.util
import os
from pathlib import Path

def discover_benchmarks(experiment_path: str) -> dict:
    """Discover benchmarks from experiment module"""
    run_py = Path(experiment_path) / "run.py"
    if not run_py.exists():
        return None

    spec = importlib.util.spec_from_file_location("exp", str(run_py))
    module = importlib.util.module_from_spec(spec)

    # Add experiment path to sys.path for imports
    sys.path.insert(0, str(Path(experiment_path)))

    try:
        spec.loader.exec_module(module)
    except Exception as e:
        print(json.dumps({"error": f"Failed to load module: {e}"}))
        sys.exit(1)

    # Try function first
    if hasattr(module, 'dojo_benchmark'):
        try:
            return module.dojo_benchmark()
        except Exception as e:
            print(json.dumps({"error": f"dojo_benchmark() failed: {e}"}))
            sys.exit(1)

    # Try dict
    if hasattr(module, 'DOJO_BENCHMARKS'):
        return module.DOJO_BENCHMARKS

    return None

def calculate_stddev(times: list) -> float:
    if len(times) < 2:
        return 0
    return statistics.stdev(times)

def calculate_stability(stddev: float, mean: float) -> str:
    if mean == 0:
        return "high"
    cv = stddev / mean
    if cv < 0.1:
        return "high"
    elif cv < 0.3:
        return "medium"
    return "low"

def run_benchmark(fn, iterations: int, warmup: int, threshold_ns: int, kind: str) -> dict:
    """Run a single benchmark"""
    # Warmup
    for _ in range(warmup):
        fn()

    # Measure
    times = []
    for _ in range(iterations):
        start = time.perf_counter_ns()
        fn()
        elapsed = time.perf_counter_ns() - start
        times.append(elapsed)

    times.sort()
    mean = statistics.mean(times)
    stddev = calculate_stddev(times)
    stability = calculate_stability(stddev, mean)
    p99 = times[int(len(times) * 0.99)]

    return {
        "p50_ns": times[int(len(times) * 0.50)],
        "p95_ns": times[int(len(times) * 0.95)],
        "p99_ns": p99,
        "max_ns": times[-1],
        "min_ns": times[0],
        "mean_ns": int(mean),
        "stddev_ns": int(stddev),
        "iterations": iterations,
        "stability": stability,
        "threshold_p99_ns": threshold_ns,
        "passed": p99 < threshold_ns,
        "kind": kind,
    }

def get_verdict(results: list, has_regressions: bool) -> str:
    """Determine verdict"""
    if has_regressions:
        return "SLOW"
    all_passed = all(r["passed"] for r in results)
    if all_passed:
        return "FAST"
    pass_rate = sum(1 for r in results if r["passed"]) / len(results)
    if pass_rate >= 0.8:
        return "OK"
    return "SLOW"

def get_platform():
    """Get platform fingerprint"""
    import platform
    import subprocess

    git_sha = None
    git_branch = None
    try:
        git_sha = subprocess.check_output(['git', 'rev-parse', 'HEAD'],
                                          stderr=subprocess.DEVNULL).decode().strip()
        git_branch = subprocess.check_output(['git', 'rev-parse', '--abbrev-ref', 'HEAD'],
                                             stderr=subprocess.DEVNULL).decode().strip()
    except:
        pass

    return {
        "git_sha": git_sha,
        "git_branch": git_branch,
        "node_version": f"python{sys.version_info.major}.{sys.version_info.minor}",
        "os_arch": f"{platform.system().lower()}-{platform.machine()}",
        "cpu_model": platform.processor() or "unknown",
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())
    }

def main():
    experiment_path = ${JSON.stringify(experimentPath)}
    kind = ${JSON.stringify(kind)}
    iterations = ${iterations}
    warmup = ${warmup}
    threshold_ns = ${thresholdNs}
    baseline_path = ${baselinePath ? JSON.stringify(baselinePath) : 'None'}
    regression_tolerance = ${regressionTolerance ?? 0.10}

    benchmarks = discover_benchmarks(experiment_path)

    if benchmarks is None:
        print(json.dumps({
            "status": "no_benchmarks",
            "message": "No DOJO_BENCHMARKS or dojo_benchmark() found"
        }))
        sys.exit(0)

    if not benchmarks:
        print(json.dumps({
            "status": "no_benchmarks",
            "message": "Benchmark dict is empty"
        }))
        sys.exit(0)

    results = []
    for name, fn in benchmarks.items():
        result = run_benchmark(fn, iterations, warmup, threshold_ns, kind)
        result["id"] = name
        results.append(result)

    # Load baseline for regression detection
    baseline = None
    regressions = []
    if baseline_path and os.path.exists(baseline_path):
        try:
            with open(baseline_path) as f:
                baseline = json.load(f)
        except:
            pass

    if baseline and "results" in baseline:
        for result in results:
            if result["id"] in baseline["results"]:
                base = baseline["results"][result["id"]]
                delta_pct = (result["p99_ns"] - base["p99_ns"]) / base["p99_ns"]
                regressions.append({
                    "id": result["id"],
                    "baseline_p99_ns": base["p99_ns"],
                    "current_p99_ns": result["p99_ns"],
                    "delta_pct": delta_pct,
                    "regressed": delta_pct > regression_tolerance,
                    "tolerance_pct": regression_tolerance
                })

    has_regressions = any(r["regressed"] for r in regressions)
    verdict = get_verdict(results, has_regressions)
    platform = get_platform()

    report = {
        "suite_id": Path(experiment_path).name,
        "kind": kind,
        "results": results,
        "regressions": regressions,
        "verdict": verdict,
        "platform": platform,
        "baseline_used": baseline_path if baseline else None,
        "has_regressions": has_regressions,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())
    }

    output = {
        "status": "regression_detected" if has_regressions else "success",
        "report": report
    }

    print(json.dumps(output))

if __name__ == "__main__":
    main()
`;
}

// ============================================================================
// Formatting
// ============================================================================

function formatBenchTable(report: BenchmarkReport): string {
  return formatTable(report);
}

function formatBenchMarkdown(report: BenchmarkReport): string {
  return formatMarkdown(report);
}

// ============================================================================
// Type Guards
// ============================================================================

export function isDecibelBenchError(result: unknown): result is DecibelBenchError {
  return (
    typeof result === 'object' &&
    result !== null &&
    'error' in result &&
    'exitCode' in result
  );
}

export function isBenchCompareError(result: unknown): result is BenchCompareError {
  return (
    typeof result === 'object' &&
    result !== null &&
    'error' in result &&
    'exitCode' in result
  );
}

// ============================================================================
// Kind Defaults
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
// decibel_bench: Run TS/JS benchmark suites
// ============================================================================

/**
 * Run a benchmark suite from a TS/JS file
 * Discovers benchmarks via BENCHMARKS export or benchmarks() function
 */
export async function decibelBench(
  input: DecibelBenchInput
): Promise<DecibelBenchOutput | DecibelBenchError> {
  const callerRole = input.caller_role || 'human';

  try {
    const { projectRoot } = await buildBenchContext(
      input.project_id,
      callerRole,
      'decibel_bench',
      input.agent_id
    );

    // Determine kind and defaults
    const kind = input.kind || 'micro';
    const defaults = KIND_DEFAULTS[kind];

    // Build baseline path
    const baselineDir = path.join(projectRoot, '.decibel', 'benchmarks');
    const baselinePath = path.join(baselineDir, `${input.suite_id}-baseline.json`);

    // Build options
    const options: Partial<BenchmarkOptions> = {
      kind,
      iterations: input.iterations ?? defaults.iterations,
      warmup: input.warmup ?? defaults.warmup,
      threshold_p99_ns: input.threshold_p99_ns ?? defaults.threshold_p99_ns,
      regression_tolerance: input.regression_tolerance ?? 0.10,
    };

    if (input.check_regression) {
      options.baseline_path = baselinePath;
    }

    if (input.save_baseline) {
      options.save_baseline = true;
      options.baseline_path = baselinePath;
    }

    log(`decibel-bench: Running ${kind} benchmark suite ${input.suite_id}`);

    // Try to discover benchmarks from project
    // Look for common locations: bench/, benchmarks/, __bench__/
    const benchDirs = ['bench', 'benchmarks', '__bench__', 'src/bench', 'src/benchmarks'];
    let suitePath: string | null = null;

    for (const dir of benchDirs) {
      const candidate = path.join(projectRoot, dir, `${input.suite_id}.ts`);
      if (existsSync(candidate)) {
        suitePath = candidate;
        break;
      }
      const candidateJs = path.join(projectRoot, dir, `${input.suite_id}.js`);
      if (existsSync(candidateJs)) {
        suitePath = candidateJs;
        break;
      }
    }

    // Also check if suite_id is a direct path
    if (!suitePath && existsSync(path.join(projectRoot, input.suite_id))) {
      suitePath = path.join(projectRoot, input.suite_id);
    }

    if (!suitePath) {
      return {
        error: `Benchmark suite not found: ${input.suite_id}`,
        exitCode: 1,
        stderr: `Searched in: ${benchDirs.join(', ')}`,
      };
    }

    // Use Node.js to run the benchmark via dynamic import
    // Generate a runner script that imports and executes
    const runnerScript = `
      const path = require('path');
      const fs = require('fs');

      async function main() {
        try {
          // Try to import the suite
          const suitePath = ${JSON.stringify(suitePath)};
          const suiteModule = require(suitePath);

          // Discover benchmarks
          let benchmarks = null;

          if (typeof suiteModule.benchmarks === 'function') {
            benchmarks = suiteModule.benchmarks();
          } else if (suiteModule.BENCHMARKS) {
            benchmarks = suiteModule.BENCHMARKS;
          } else if (suiteModule.default && typeof suiteModule.default === 'object') {
            benchmarks = suiteModule.default;
          }

          if (!benchmarks || Object.keys(benchmarks).length === 0) {
            console.log(JSON.stringify({
              status: 'no_benchmarks',
              message: 'No BENCHMARKS export or benchmarks() function found'
            }));
            return;
          }

          // Run benchmarks
          const kind = ${JSON.stringify(kind)};
          const iterations = ${options.iterations};
          const warmup = ${options.warmup};
          const thresholdNs = ${options.threshold_p99_ns};

          const results = [];

          for (const [name, fn] of Object.entries(benchmarks)) {
            // Warmup
            for (let i = 0; i < warmup; i++) {
              const r = fn();
              if (r instanceof Promise) await r;
            }

            // Measure
            const times = [];
            for (let i = 0; i < iterations; i++) {
              const start = process.hrtime.bigint();
              const r = fn();
              if (r instanceof Promise) await r;
              const end = process.hrtime.bigint();
              times.push(Number(end - start));
            }

            times.sort((a, b) => a - b);
            const mean = times.reduce((a, b) => a + b, 0) / times.length;
            const stddev = times.length < 2 ? 0 : Math.sqrt(
              times.map(t => Math.pow(t - mean, 2)).reduce((a, b) => a + b, 0) / (times.length - 1)
            );
            const cv = mean > 0 ? stddev / mean : 0;
            const stability = cv < 0.1 ? 'high' : cv < 0.3 ? 'medium' : 'low';
            const p99 = times[Math.floor(times.length * 0.99)];

            results.push({
              id: name,
              kind,
              p50_ns: times[Math.floor(times.length * 0.50)],
              p95_ns: times[Math.floor(times.length * 0.95)],
              p99_ns: p99,
              max_ns: times[times.length - 1],
              min_ns: times[0],
              mean_ns: Math.round(mean),
              stddev_ns: Math.round(stddev),
              iterations,
              stability,
              threshold_p99_ns: thresholdNs,
              passed: p99 < thresholdNs,
            });
          }

          // Check baseline for regressions
          const baselinePath = ${input.check_regression ? JSON.stringify(baselinePath) : 'null'};
          const regressionTolerance = ${options.regression_tolerance};
          let baseline = null;
          const regressions = [];

          if (baselinePath && fs.existsSync(baselinePath)) {
            try {
              baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf-8'));
            } catch {}
          }

          if (baseline && baseline.results) {
            for (const result of results) {
              if (baseline.results[result.id]) {
                const base = baseline.results[result.id];
                const deltaPct = (result.p99_ns - base.p99_ns) / base.p99_ns;
                regressions.push({
                  id: result.id,
                  baseline_p99_ns: base.p99_ns,
                  current_p99_ns: result.p99_ns,
                  delta_pct: deltaPct,
                  regressed: deltaPct > regressionTolerance,
                  tolerance_pct: regressionTolerance
                });
              }
            }
          }

          const hasRegressions = regressions.some(r => r.regressed);
          const allPassed = results.every(r => r.passed);
          const passRate = results.filter(r => r.passed).length / results.length;
          const verdict = hasRegressions ? 'SLOW' : allPassed ? 'FAST' : passRate >= 0.8 ? 'OK' : 'SLOW';

          // Platform info
          const os = require('os');
          const { execSync } = require('child_process');
          let gitSha, gitBranch;
          try {
            gitSha = execSync('git rev-parse HEAD', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
            gitBranch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
          } catch {}

          const platform = {
            git_sha: gitSha,
            git_branch: gitBranch,
            node_version: process.version,
            os_arch: os.platform() + '-' + os.arch(),
            cpu_model: os.cpus()[0]?.model || 'unknown',
            timestamp: new Date().toISOString()
          };

          const report = {
            suite_id: ${JSON.stringify(input.suite_id)},
            kind,
            results,
            regressions,
            verdict,
            platform,
            baseline_used: baseline ? baselinePath : undefined,
            has_regressions: hasRegressions,
            timestamp: new Date().toISOString()
          };

          // Save baseline if requested
          const saveBaseline = ${!!input.save_baseline};
          if (saveBaseline) {
            const baselineDir = ${JSON.stringify(baselineDir)};
            const baselineFile = ${JSON.stringify(baselinePath)};
            fs.mkdirSync(baselineDir, { recursive: true });
            const newBaseline = {
              suite_id: ${JSON.stringify(input.suite_id)},
              platform,
              results: Object.fromEntries(
                results.map(r => [r.id, { p99_ns: r.p99_ns, p95_ns: r.p95_ns, mean_ns: r.mean_ns }])
              ),
              created_at: new Date().toISOString()
            };
            fs.writeFileSync(baselineFile, JSON.stringify(newBaseline, null, 2));
          }

          console.log(JSON.stringify({
            status: hasRegressions ? 'regression_detected' : 'success',
            report
          }));

        } catch (err) {
          console.log(JSON.stringify({ error: err.message || String(err) }));
          process.exit(1);
        }
      }

      main();
    `;

    const result = await new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve) => {
      const proc = spawn('node', ['-e', runnerScript], {
        cwd: projectRoot,
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

    // Parse output
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
        suite_id: input.suite_id,
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

    // Format output
    const outputFormat = input.output_format || 'json';
    let formatted: string | undefined;

    if (outputFormat === 'table') {
      formatted = formatTable(parsed.report);
    } else if (outputFormat === 'markdown') {
      formatted = formatMarkdown(parsed.report);
    }

    return {
      suite_id: input.suite_id,
      status: parsed.status as 'success' | 'regression_detected',
      report: parsed.report,
      formatted,
    };

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      error: message,
      exitCode: 1,
      stderr: message,
    };
  } finally {
    recordRequestEnd(callerRole);
  }
}

// ============================================================================
// decibel_bench_compare: Compare two baselines
// ============================================================================

/**
 * Compare two benchmark baselines side-by-side
 */
export async function decibelBenchCompare(
  input: BenchCompareInput
): Promise<BenchCompareOutput | BenchCompareError> {
  const callerRole = input.caller_role || 'human';

  try {
    const { projectRoot } = await buildBenchContext(
      input.project_id,
      callerRole,
      'decibel_bench_compare',
      input.agent_id
    );

    // Resolve baseline paths
    const resolveBaselinePath = (p: string): string => {
      if (path.isAbsolute(p)) return p;
      // Check in .decibel/benchmarks
      const benchPath = path.join(projectRoot, '.decibel', 'benchmarks', p);
      if (existsSync(benchPath)) return benchPath;
      if (existsSync(benchPath + '.json')) return benchPath + '.json';
      if (existsSync(benchPath + '-baseline.json')) return benchPath + '-baseline.json';
      // Check direct path
      const directPath = path.join(projectRoot, p);
      if (existsSync(directPath)) return directPath;
      return p;
    };

    const pathA = resolveBaselinePath(input.baseline_a);
    const pathB = resolveBaselinePath(input.baseline_b);

    // Load baselines
    let baselineA: Baseline;
    let baselineB: Baseline;

    try {
      const contentA = await fs.readFile(pathA, 'utf-8');
      baselineA = JSON.parse(contentA);
    } catch (err) {
      return {
        error: `Failed to load baseline A: ${pathA}`,
        exitCode: 1,
      };
    }

    try {
      const contentB = await fs.readFile(pathB, 'utf-8');
      baselineB = JSON.parse(contentB);
    } catch (err) {
      return {
        error: `Failed to load baseline B: ${pathB}`,
        exitCode: 1,
      };
    }

    // Compare
    const deltas: BenchDelta[] = [];
    const allIds = new Set([
      ...Object.keys(baselineA.results || {}),
      ...Object.keys(baselineB.results || {}),
    ]);

    for (const id of allIds) {
      const a = baselineA.results?.[id];
      const b = baselineB.results?.[id];

      if (!a || !b) continue; // Skip if not in both

      const aPns = a.p99_ns;
      const bPns = b.p99_ns;
      const deltaNs = aPns - bPns;
      const deltaPct = bPns !== 0 ? deltaNs / bPns : 0;

      // Winner: lower p99 is better (faster)
      // a_wins if a is faster (lower), b_wins if b is faster
      const tolerance = 0.02; // 2% tolerance for tie
      let winner: 'a' | 'b' | 'tie';
      if (Math.abs(deltaPct) < tolerance) {
        winner = 'tie';
      } else if (aPns < bPns) {
        winner = 'a';
      } else {
        winner = 'b';
      }

      deltas.push({
        id,
        a_p99_ns: aPns,
        b_p99_ns: bPns,
        delta_ns: deltaNs,
        delta_pct: deltaPct,
        winner,
      });
    }

    // Summary
    const aWins = deltas.filter(d => d.winner === 'a').length;
    const bWins = deltas.filter(d => d.winner === 'b').length;
    const ties = deltas.filter(d => d.winner === 'tie').length;
    const avgDeltaPct = deltas.length > 0
      ? deltas.reduce((sum, d) => sum + d.delta_pct, 0) / deltas.length
      : 0;

    let overallWinner: 'a' | 'b' | 'tie';
    if (aWins > bWins) {
      overallWinner = 'a';
    } else if (bWins > aWins) {
      overallWinner = 'b';
    } else {
      overallWinner = 'tie';
    }

    const output: BenchCompareOutput = {
      status: 'success',
      baseline_a: pathA,
      baseline_b: pathB,
      deltas,
      summary: {
        a_wins: aWins,
        b_wins: bWins,
        ties,
        overall_winner: overallWinner,
        avg_delta_pct: avgDeltaPct,
      },
    };

    // Format output
    if (input.output_format === 'table' || input.output_format === 'markdown') {
      output.formatted = formatCompareOutput(output, input.output_format);
    }

    return output;

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      error: message,
      exitCode: 1,
    };
  } finally {
    recordRequestEnd(callerRole);
  }
}

// ============================================================================
// Compare Formatting
// ============================================================================

function formatNsForCompare(ns: number): string {
  if (ns >= 1_000_000) {
    return `${(ns / 1_000_000).toFixed(1)}ms`;
  } else if (ns >= 1000) {
    return `${(ns / 1000).toFixed(1)}μs`;
  } else {
    return `${ns}ns`;
  }
}

function formatCompareOutput(output: BenchCompareOutput, format: 'table' | 'markdown'): string {
  const lines: string[] = [];

  if (format === 'markdown') {
    lines.push('# Benchmark Comparison');
    lines.push('');
    lines.push(`**Baseline A:** ${output.baseline_a}`);
    lines.push(`**Baseline B:** ${output.baseline_b}`);
    lines.push('');
    lines.push('## Results');
    lines.push('');
    lines.push('| Benchmark | A (p99) | B (p99) | Delta | Winner |');
    lines.push('|-----------|---------|---------|-------|--------|');

    for (const d of output.deltas) {
      const deltaSign = d.delta_pct >= 0 ? '+' : '';
      const winnerSymbol = d.winner === 'a' ? '← A' : d.winner === 'b' ? 'B →' : '=';
      lines.push(`| ${d.id} | ${formatNsForCompare(d.a_p99_ns)} | ${formatNsForCompare(d.b_p99_ns)} | ${deltaSign}${(d.delta_pct * 100).toFixed(1)}% | ${winnerSymbol} |`);
    }

    lines.push('');
    lines.push('## Summary');
    lines.push('');
    lines.push(`- **A wins:** ${output.summary.a_wins}`);
    lines.push(`- **B wins:** ${output.summary.b_wins}`);
    lines.push(`- **Ties:** ${output.summary.ties}`);
    lines.push(`- **Overall:** ${output.summary.overall_winner === 'a' ? 'A is faster' : output.summary.overall_winner === 'b' ? 'B is faster' : 'Tie'}`);

  } else {
    // Table format
    lines.push('Benchmark Comparison');
    lines.push('='.repeat(60));
    lines.push(`A: ${output.baseline_a}`);
    lines.push(`B: ${output.baseline_b}`);
    lines.push('');
    lines.push('Benchmark            A (p99)    B (p99)    Delta   Winner');
    lines.push('─'.repeat(60));

    for (const d of output.deltas) {
      const name = d.id.padEnd(18).slice(0, 18);
      const aPns = formatNsForCompare(d.a_p99_ns).padStart(9);
      const bPns = formatNsForCompare(d.b_p99_ns).padStart(9);
      const deltaSign = d.delta_pct >= 0 ? '+' : '';
      const delta = `${deltaSign}${(d.delta_pct * 100).toFixed(1)}%`.padStart(7);
      const winner = d.winner === 'a' ? '  ← A' : d.winner === 'b' ? '  B →' : '   =';
      lines.push(`${name}  ${aPns}  ${bPns}  ${delta} ${winner}`);
    }

    lines.push('');
    lines.push('Summary:');
    lines.push(`  A wins: ${output.summary.a_wins} | B wins: ${output.summary.b_wins} | Ties: ${output.summary.ties}`);
    const overallText = output.summary.overall_winner === 'a' ? 'A is faster' :
                       output.summary.overall_winner === 'b' ? 'B is faster' : 'Tie';
    lines.push(`  Overall: ${overallText}`);
  }

  return lines.join('\n');
}
