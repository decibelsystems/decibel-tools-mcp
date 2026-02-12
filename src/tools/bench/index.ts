// ============================================================================
// Bench Tools — Modular ToolSpec wrappers
// ============================================================================
// Wraps the benchmark functions from bench.ts and dojoBench.ts as ToolSpecs
// so they appear in the modular tool registry (tools/index.ts).
// ============================================================================

import type { ToolSpec } from '../types.js';
import { dojoBench, isDojoBenchError } from '../dojoBench.js';
import { decibelBench, decibelBenchCompare, isDecibelBenchError, isBenchCompareError } from '../bench.js';

// ============================================================================
// dojo_bench
// ============================================================================

const dojoBenchTool: ToolSpec = {
  definition: {
    name: 'dojo_bench',
    description: 'Run standardized performance benchmarks on a Dojo experiment. Discovers benchmarks from DOJO_BENCHMARKS dict or dojo_benchmark() function in experiment run.py.',
    annotations: {
      title: 'Dojo Benchmark',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'Project ID',
        },
        experiment_id: {
          type: 'string',
          description: 'Experiment ID to benchmark',
        },
        kind: {
          type: 'string',
          enum: ['micro', 'integration'],
          description: 'Benchmark kind (default: micro)',
        },
        iterations: {
          type: 'number',
          description: 'Number of iterations (default: kind-dependent)',
        },
        warmup: {
          type: 'number',
          description: 'Warmup iterations (default: kind-dependent)',
        },
        threshold_p99_ns: {
          type: 'number',
          description: 'P99 threshold in nanoseconds',
        },
        save_baseline: {
          type: 'boolean',
          description: 'Save results as new baseline',
        },
        check_regression: {
          type: 'boolean',
          description: 'Compare against saved baseline',
        },
        regression_tolerance: {
          type: 'number',
          description: 'Regression tolerance (e.g., 0.10 = 10%)',
        },
        output_format: {
          type: 'string',
          enum: ['table', 'json', 'markdown'],
          description: 'Output format (default: json)',
        },
      },
      required: ['project_id', 'experiment_id'],
    },
  },
  handler: async (args) => {
    const result = await dojoBench(args);
    if (isDojoBenchError(result)) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: result.error, exitCode: result.exitCode }) }],
        isError: true,
      };
    }
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
    };
  },
};

// ============================================================================
// decibel_bench
// ============================================================================

const decibelBenchTool: ToolSpec = {
  definition: {
    name: 'decibel_bench',
    description: 'Run a TS/JS benchmark suite with baseline persistence and regression detection. Discovers benchmarks from BENCHMARKS export or benchmarks() function.',
    annotations: {
      title: 'Decibel Benchmark',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'Project ID',
        },
        suite_id: {
          type: 'string',
          description: 'Benchmark suite identifier',
        },
        kind: {
          type: 'string',
          enum: ['micro', 'integration'],
          description: 'Benchmark kind (default: micro)',
        },
        iterations: {
          type: 'number',
          description: 'Number of iterations',
        },
        warmup: {
          type: 'number',
          description: 'Warmup iterations',
        },
        threshold_p99_ns: {
          type: 'number',
          description: 'P99 threshold in nanoseconds',
        },
        save_baseline: {
          type: 'boolean',
          description: 'Save results as new baseline',
        },
        check_regression: {
          type: 'boolean',
          description: 'Compare against saved baseline',
        },
        regression_tolerance: {
          type: 'number',
          description: 'Regression tolerance (e.g., 0.10 = 10%)',
        },
        output_format: {
          type: 'string',
          enum: ['table', 'json', 'markdown'],
          description: 'Output format (default: json)',
        },
      },
      required: ['project_id', 'suite_id'],
    },
  },
  handler: async (args) => {
    const result = await decibelBench(args);
    if (isDecibelBenchError(result)) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: result.error, exitCode: result.exitCode }) }],
        isError: true,
      };
    }
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
    };
  },
};

// ============================================================================
// decibel_bench_compare
// ============================================================================

const decibelBenchCompareTool: ToolSpec = {
  definition: {
    name: 'decibel_bench_compare',
    description: 'Compare two benchmark baselines side-by-side. Shows per-benchmark deltas and overall winner.',
    annotations: {
      title: 'Benchmark Compare',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'Project ID',
        },
        baseline_a: {
          type: 'string',
          description: 'Path or name of baseline A',
        },
        baseline_b: {
          type: 'string',
          description: 'Path or name of baseline B',
        },
        output_format: {
          type: 'string',
          enum: ['table', 'json', 'markdown'],
          description: 'Output format (default: json)',
        },
      },
      required: ['project_id', 'baseline_a', 'baseline_b'],
    },
  },
  handler: async (args) => {
    const result = await decibelBenchCompare(args);
    if (isBenchCompareError(result)) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: result.error, exitCode: result.exitCode }) }],
        isError: true,
      };
    }
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
    };
  },
};

// ============================================================================
// Export
// ============================================================================

export const benchTools: ToolSpec[] = [
  dojoBenchTool,
  decibelBenchTool,
  decibelBenchCompareTool,
];
