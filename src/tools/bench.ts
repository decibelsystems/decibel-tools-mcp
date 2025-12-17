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
  BenchmarkOptions,
  formatTable,
  formatMarkdown,
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
