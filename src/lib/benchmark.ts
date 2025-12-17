/**
 * Decibel Benchmark Library
 *
 * First-class benchmarking for the decibel toolchain.
 * Supports micro (ns, pure functions) and integration (ms, I/O) benchmarks.
 * Includes baseline persistence and regression detection for CI.
 *
 * Usage:
 *   - Direct: runBenchmarkSuite(benchmarks, options)
 *   - Dojo: dojo_bench tool (discovers from experiments)
 *   - CLI: decibel bench <suite.json>
 */

import { createHash } from 'crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import os from 'os';

// ============================================================================
// Types
// ============================================================================

export type BenchKind = 'micro' | 'integration';

export type Verdict = 'FAST' | 'OK' | 'SLOW';

export type Stability = 'high' | 'medium' | 'low';

export interface Bench {
  id: string;
  kind?: BenchKind;
  threshold_p99_ns?: number;  // Override default for this bench
  setup?: () => unknown | Promise<unknown>;
  run: (ctx?: unknown) => void | Promise<void>;
  teardown?: (ctx?: unknown) => void | Promise<void>;
}

export interface BenchmarkOptions {
  kind: BenchKind;
  iterations?: number;       // Override auto-detect
  warmup?: number;           // Override auto-detect
  threshold_p99_ns?: number; // Override kind default
  time_budget_ms?: number;   // Max time per bench (auto mode)
  min_iterations?: number;   // Min iterations (auto mode)
  save_baseline?: boolean;   // Write results as new baseline
  baseline_path?: string;    // Path to baseline file
  regression_tolerance?: number; // e.g., 0.10 = 10% regression allowed
}

export interface BenchmarkResult {
  id: string;
  kind: BenchKind;
  p50_ns: number;
  p95_ns: number;
  p99_ns: number;
  max_ns: number;
  min_ns: number;
  mean_ns: number;
  stddev_ns: number;
  iterations: number;
  stability: Stability;
  threshold_p99_ns: number;
  passed: boolean;
}

export interface RegressionInfo {
  id: string;
  baseline_p99_ns: number;
  current_p99_ns: number;
  delta_pct: number;
  regressed: boolean;
  tolerance_pct: number;
}

export interface PlatformFingerprint {
  git_sha?: string;
  git_branch?: string;
  node_version: string;
  os_arch: string;
  cpu_model: string;
  timestamp: string;
}

export interface BenchmarkReport {
  suite_id: string;
  kind: BenchKind;
  results: BenchmarkResult[];
  regressions: RegressionInfo[];
  verdict: Verdict;
  platform: PlatformFingerprint;
  baseline_used?: string;
  has_regressions: boolean;
  timestamp: string;
}

export interface Baseline {
  suite_id: string;
  platform: PlatformFingerprint;
  results: Record<string, { p99_ns: number; p95_ns: number; mean_ns: number }>;
  created_at: string;
}

// ============================================================================
// Kind Defaults
// ============================================================================

const KIND_DEFAULTS: Record<BenchKind, {
  iterations: number;
  warmup: number;
  threshold_p99_ns: number;
  time_budget_ms: number;
  min_iterations: number;
}> = {
  micro: {
    iterations: 10000,
    warmup: 1000,
    threshold_p99_ns: 100_000,      // 100μs
    time_budget_ms: 5000,           // 5s max per bench
    min_iterations: 1000,
  },
  integration: {
    iterations: 100,
    warmup: 10,
    threshold_p99_ns: 500_000_000,  // 500ms
    time_budget_ms: 30000,          // 30s max per bench
    min_iterations: 20,
  },
};

// ============================================================================
// Platform Fingerprint
// ============================================================================

export function getPlatformFingerprint(): PlatformFingerprint {
  let gitSha: string | undefined;
  let gitBranch: string | undefined;

  try {
    const { execSync } = require('child_process');
    gitSha = execSync('git rev-parse HEAD', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    gitBranch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    // Not in a git repo
  }

  const cpus = os.cpus();
  const cpuModel = cpus.length > 0 ? cpus[0].model : 'unknown';

  return {
    git_sha: gitSha,
    git_branch: gitBranch,
    node_version: process.version,
    os_arch: `${os.platform()}-${os.arch()}`,
    cpu_model: cpuModel,
    timestamp: new Date().toISOString(),
  };
}

// ============================================================================
// Statistics
// ============================================================================

function calculateStddev(times: number[], mean: number): number {
  if (times.length < 2) return 0;
  const squaredDiffs = times.map(t => Math.pow(t - mean, 2));
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / (times.length - 1);
  return Math.sqrt(variance);
}

function calculateStability(stddev: number, mean: number): Stability {
  if (mean === 0) return 'high';
  const cv = stddev / mean;  // Coefficient of variation
  if (cv < 0.1) return 'high';
  if (cv < 0.3) return 'medium';
  return 'low';
}

// ============================================================================
// Core Benchmark Runner
// ============================================================================

/**
 * Run a single benchmark
 */
export async function runBenchmark(
  bench: Bench,
  options: BenchmarkOptions
): Promise<BenchmarkResult> {
  const kind = bench.kind || options.kind;
  const defaults = KIND_DEFAULTS[kind];

  const iterations = options.iterations ?? defaults.iterations;
  const warmup = options.warmup ?? defaults.warmup;
  const threshold = bench.threshold_p99_ns ?? options.threshold_p99_ns ?? defaults.threshold_p99_ns;

  // Setup
  let ctx: unknown;
  if (bench.setup) {
    ctx = await bench.setup();
  }

  try {
    // Warmup phase
    for (let i = 0; i < warmup; i++) {
      const result = bench.run(ctx);
      if (result instanceof Promise) await result;
    }

    // Measurement phase
    const times: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const start = process.hrtime.bigint();
      const result = bench.run(ctx);
      if (result instanceof Promise) await result;
      const end = process.hrtime.bigint();
      times.push(Number(end - start));
    }

    // Sort for percentile calculations
    times.sort((a, b) => a - b);

    // Calculate statistics
    const sum = times.reduce((a, b) => a + b, 0);
    const mean = sum / times.length;
    const stddev = calculateStddev(times, mean);
    const stability = calculateStability(stddev, mean);

    const p99 = times[Math.floor(times.length * 0.99)];

    return {
      id: bench.id,
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
      threshold_p99_ns: threshold,
      passed: p99 < threshold,
    };
  } finally {
    // Teardown
    if (bench.teardown) {
      await bench.teardown(ctx);
    }
  }
}

/**
 * Run a suite of benchmarks
 */
export async function runBenchmarkSuite(
  suiteId: string,
  benchmarks: Bench[],
  options: Partial<BenchmarkOptions> = {}
): Promise<BenchmarkReport> {
  const kind = options.kind || 'micro';
  const fullOptions: BenchmarkOptions = { kind, ...options };

  const results: BenchmarkResult[] = [];

  for (const bench of benchmarks) {
    const result = await runBenchmark(bench, fullOptions);
    results.push(result);
  }

  // Load baseline for regression detection
  let baseline: Baseline | null = null;
  let regressions: RegressionInfo[] = [];
  const tolerancePct = options.regression_tolerance ?? 0.10;  // 10% default

  if (options.baseline_path && existsSync(options.baseline_path)) {
    try {
      baseline = JSON.parse(readFileSync(options.baseline_path, 'utf-8'));
    } catch {
      // Invalid baseline, ignore
    }
  }

  if (baseline) {
    for (const result of results) {
      const baselineResult = baseline.results[result.id];
      if (baselineResult) {
        const deltaPct = (result.p99_ns - baselineResult.p99_ns) / baselineResult.p99_ns;
        regressions.push({
          id: result.id,
          baseline_p99_ns: baselineResult.p99_ns,
          current_p99_ns: result.p99_ns,
          delta_pct: deltaPct,
          regressed: deltaPct > tolerancePct,
          tolerance_pct: tolerancePct,
        });
      }
    }
  }

  const hasRegressions = regressions.some(r => r.regressed);
  const allPassed = results.every(r => r.passed);
  const verdict = getVerdict(results, hasRegressions);

  const platform = getPlatformFingerprint();

  const report: BenchmarkReport = {
    suite_id: suiteId,
    kind,
    results,
    regressions,
    verdict,
    platform,
    baseline_used: baseline ? options.baseline_path : undefined,
    has_regressions: hasRegressions,
    timestamp: new Date().toISOString(),
  };

  // Save as new baseline if requested
  if (options.save_baseline && options.baseline_path) {
    const newBaseline: Baseline = {
      suite_id: suiteId,
      platform,
      results: Object.fromEntries(
        results.map(r => [r.id, { p99_ns: r.p99_ns, p95_ns: r.p95_ns, mean_ns: r.mean_ns }])
      ),
      created_at: new Date().toISOString(),
    };

    const dir = dirname(options.baseline_path);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(options.baseline_path, JSON.stringify(newBaseline, null, 2));
  }

  return report;
}

// ============================================================================
// Verdict Logic
// ============================================================================

export function getVerdict(results: BenchmarkResult[], hasRegressions: boolean): Verdict {
  if (hasRegressions) {
    return 'SLOW';
  }

  const allPassed = results.every(r => r.passed);
  if (allPassed) {
    return 'FAST';
  }

  // Some passed, some didn't
  const passRate = results.filter(r => r.passed).length / results.length;
  if (passRate >= 0.8) {
    return 'OK';
  }

  return 'SLOW';
}

// ============================================================================
// Formatting Functions
// ============================================================================

function formatNs(ns: number, kind: BenchKind): string {
  if (kind === 'integration' || ns >= 1_000_000) {
    return `${(ns / 1_000_000).toFixed(1)}ms`;
  } else if (ns >= 1000) {
    return `${(ns / 1000).toFixed(1)}μs`;
  } else {
    return `${ns}ns`;
  }
}

function formatPct(pct: number): string {
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${(pct * 100).toFixed(1)}%`;
}

export function formatTable(report: BenchmarkReport): string {
  const lines: string[] = [];
  const kind = report.kind;

  lines.push(`${report.suite_id} Benchmark Results (${kind})`);
  lines.push('='.repeat(60));
  lines.push(`Platform: ${report.platform.os_arch} | Node ${report.platform.node_version}`);
  if (report.platform.git_sha) {
    lines.push(`Git: ${report.platform.git_branch}@${report.platform.git_sha.slice(0, 7)}`);
  }
  lines.push('');

  const header = 'Benchmark            p50      p95      p99      stab  pass';
  lines.push(header);
  lines.push('─'.repeat(header.length));

  for (const r of report.results) {
    const name = r.id.padEnd(18).slice(0, 18);
    const p50 = formatNs(r.p50_ns, kind).padStart(8);
    const p95 = formatNs(r.p95_ns, kind).padStart(8);
    const p99 = formatNs(r.p99_ns, kind).padStart(8);
    const stab = r.stability.padStart(6);
    const pass = r.passed ? '  ✓' : '  ✗';
    lines.push(`${name}  ${p50} ${p95} ${p99} ${stab} ${pass}`);
  }

  if (report.regressions.length > 0) {
    lines.push('');
    lines.push('Regressions:');
    lines.push('─'.repeat(40));
    for (const r of report.regressions) {
      const status = r.regressed ? '✗ REGRESSED' : '✓ OK';
      lines.push(`  ${r.id}: ${formatPct(r.delta_pct)} (${status})`);
    }
  }

  lines.push('');
  const verdictSymbol = report.verdict === 'FAST' ? '✓' : report.verdict === 'OK' ? '○' : '✗';
  lines.push(`${verdictSymbol} Verdict: ${report.verdict}${report.has_regressions ? ' (regressions detected)' : ''}`);

  return lines.join('\n');
}

export function formatMarkdown(report: BenchmarkReport): string {
  const lines: string[] = [];
  const kind = report.kind;

  lines.push(`# ${report.suite_id} Benchmark Results`);
  lines.push('');
  lines.push(`**Kind:** ${kind}`);
  lines.push(`**Platform:** ${report.platform.os_arch} | Node ${report.platform.node_version}`);
  if (report.platform.git_sha) {
    lines.push(`**Git:** ${report.platform.git_branch}@${report.platform.git_sha.slice(0, 7)}`);
  }
  lines.push(`**Verdict:** ${report.verdict}`);
  lines.push('');
  lines.push('## Results');
  lines.push('');
  lines.push('| Benchmark | p50 | p95 | p99 | Stability | Pass |');
  lines.push('|-----------|-----|-----|-----|-----------|------|');

  for (const r of report.results) {
    const pass = r.passed ? '✓' : '✗';
    lines.push(`| ${r.id} | ${formatNs(r.p50_ns, kind)} | ${formatNs(r.p95_ns, kind)} | ${formatNs(r.p99_ns, kind)} | ${r.stability} | ${pass} |`);
  }

  if (report.regressions.length > 0) {
    lines.push('');
    lines.push('## Regressions');
    lines.push('');
    lines.push('| Benchmark | Baseline | Current | Delta | Status |');
    lines.push('|-----------|----------|---------|-------|--------|');
    for (const r of report.regressions) {
      const status = r.regressed ? '✗ REGRESSED' : '✓ OK';
      lines.push(`| ${r.id} | ${formatNs(r.baseline_p99_ns, kind)} | ${formatNs(r.current_p99_ns, kind)} | ${formatPct(r.delta_pct)} | ${status} |`);
    }
  }

  return lines.join('\n');
}

// ============================================================================
// Convenience: Simple benchmark operations dict
// ============================================================================

export interface BenchmarkOperations {
  [name: string]: () => void | Promise<void>;
}

/**
 * Convert simple operations dict to Bench array
 */
export function operationsToBenches(
  operations: BenchmarkOperations,
  kind: BenchKind = 'micro'
): Bench[] {
  return Object.entries(operations).map(([id, run]) => ({
    id,
    kind,
    run,
  }));
}

/**
 * Simple runner for operations dict (backwards compatible)
 */
export async function runAllBenchmarks(
  suiteId: string,
  operations: BenchmarkOperations,
  options: Partial<BenchmarkOptions> = {}
): Promise<BenchmarkReport> {
  const kind = options.kind || 'micro';
  const benchmarks = operationsToBenches(operations, kind);
  return runBenchmarkSuite(suiteId, benchmarks, options);
}
