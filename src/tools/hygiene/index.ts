// ============================================================================
// Hygiene Scanner Domain Tools
// ============================================================================
// Tools for detecting AI-induced technical debt and operational blindspots.
// - sentinel_scan_codebase: Structural code analysis
// - sentinel_scan_coverage: Test coverage gaps
// - sentinel_scan_config: Configuration and secrets issues
// - oracle_hygiene_report: Correlate findings with Vector run history
// ============================================================================

import { ToolSpec } from '../types.js';
import { toolSuccess, toolError } from '../shared/index.js';
import { resolveProjectPaths } from '../../projectRegistry.js';
import { scanCodebase, CodebaseScanInput } from './codebase-scanner.js';
import { scanCoverage, CoverageScanInput } from './coverage-scanner.js';
import { scanConfig, ConfigScanInput } from './config-scanner.js';
import { generateHygieneReport, HygieneReportInput } from './oracle-hygiene.js';

// ============================================================================
// Codebase Scanner Tool
// ============================================================================

export const sentinelScanCodebaseTool: ToolSpec = {
  definition: {
    name: 'sentinel_scan_codebase',
    description: 'Scan codebase for structural technical debt: god scripts (>500 LOC), rule sprawl (>10 elif chains), duplicated blocks, hardcoded values, and deep nesting. Returns findings with severity and suggestions.',
    annotations: {
      title: 'Scan Codebase',
      readOnlyHint: true,
      destructiveHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Optional project identifier. Uses default project if not specified.',
        },
        path: {
          type: 'string',
          description: 'Optional path to scan (relative to project root). Defaults to entire project.',
        },
        thresholds: {
          type: 'object',
          description: 'Optional custom thresholds for detection',
          properties: {
            godScriptLines: {
              type: 'number',
              description: 'Lines of code threshold for god scripts (default: 500)',
            },
            ruleSprawlChains: {
              type: 'number',
              description: 'elif/else-if chain length threshold (default: 10)',
            },
            nestingDepth: {
              type: 'number',
              description: 'Maximum nesting depth (default: 5)',
            },
          },
        },
        includePatterns: {
          type: 'array',
          items: { type: 'string' },
          description: 'Glob patterns to include (default: ["**/*.ts", "**/*.js", "**/*.py", ...])',
        },
        excludePatterns: {
          type: 'array',
          items: { type: 'string' },
          description: 'Glob patterns to exclude (default: ["node_modules/**", "dist/**", ...])',
        },
      },
    },
  },
  handler: async (args) => {
    try {
      // Resolve project path
      const resolved = resolveProjectPaths(args.projectId);

      const projectPath = args.path
        ? `${resolved.projectPath}/${args.path}`
        : resolved.projectPath;

      const input: CodebaseScanInput = {
        projectPath,
        thresholds: args.thresholds,
        includePatterns: args.includePatterns,
        excludePatterns: args.excludePatterns,
      };

      const result = await scanCodebase(input);

      // Format for Vector compatibility
      return toolSuccess({
        score: result.score,
        findings: result.findings.map(f => ({
          id: f.id,
          category: 'structural',
          severity: f.severity,
          type: f.type,
          title: f.title,
          description: f.description,
          file: f.file,
          line: f.line,
          suggestion: f.suggestion,
        })),
        summary: result.summary,
        scanDuration: result.scanDuration,
      });
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// Coverage Scanner Tool
// ============================================================================

export const sentinelScanCoverageTool: ToolSpec = {
  definition: {
    name: 'sentinel_scan_coverage',
    description: 'Analyze test coverage gaps by directory. Identifies directories without tests, critical untested paths (auth, payments, security), and low test-to-source ratios.',
    annotations: {
      title: 'Scan Coverage',
      readOnlyHint: true,
      destructiveHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Optional project identifier. Uses default project if not specified.',
        },
        path: {
          type: 'string',
          description: 'Optional path to scan (relative to project root). Defaults to entire project.',
        },
        thresholds: {
          type: 'object',
          description: 'Optional custom thresholds',
          properties: {
            minCoveragePercent: {
              type: 'number',
              description: 'Minimum acceptable coverage percentage (default: 70)',
            },
          },
        },
      },
    },
  },
  handler: async (args) => {
    try {
      // Resolve project path
      const resolved = resolveProjectPaths(args.projectId);

      const projectPath = args.path
        ? `${resolved.projectPath}/${args.path}`
        : resolved.projectPath;

      const input: CoverageScanInput = {
        projectPath,
        thresholds: args.thresholds,
      };

      const result = await scanCoverage(input);

      return toolSuccess({
        score: result.score,
        findings: result.findings.map(f => ({
          id: f.id,
          category: 'coverage',
          severity: f.severity,
          type: f.type,
          title: f.title,
          description: f.description,
          directory: f.directory,
          suggestion: f.suggestion,
        })),
        directories: result.directories,
        summary: result.summary,
        scanDuration: result.scanDuration,
      });
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// Config Scanner Tool
// ============================================================================

export const sentinelScanConfigTool: ToolSpec = {
  definition: {
    name: 'sentinel_scan_config',
    description: 'Scan for configuration issues: exposed secrets, env drift between environments, missing .env.example, and insecure defaults. Critical for security hygiene.',
    annotations: {
      title: 'Scan Config',
      readOnlyHint: true,
      destructiveHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Optional project identifier. Uses default project if not specified.',
        },
        path: {
          type: 'string',
          description: 'Optional path to scan (relative to project root). Defaults to entire project.',
        },
      },
    },
  },
  handler: async (args) => {
    try {
      // Resolve project path
      const resolved = resolveProjectPaths(args.projectId);

      const projectPath = args.path
        ? `${resolved.projectPath}/${args.path}`
        : resolved.projectPath;

      const input: ConfigScanInput = {
        projectPath,
      };

      const result = await scanConfig(input);

      return toolSuccess({
        score: result.score,
        findings: result.findings.map(f => ({
          id: f.id,
          category: 'config',
          severity: f.severity,
          type: f.type,
          title: f.title,
          description: f.description,
          file: f.file,
          line: f.line,
          suggestion: f.suggestion,
        })),
        envFiles: result.envFiles,
        summary: result.summary,
        scanDuration: result.scanDuration,
      });
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// Oracle Hygiene Report Tool
// ============================================================================

export const oracleHygieneReportTool: ToolSpec = {
  definition: {
    name: 'oracle_hygiene_report',
    description: 'Generate a comprehensive hygiene report with drift correlation. Runs all scanners (structural, coverage, config), correlates findings with Vector run history to identify files that cause agent struggles, and generates prioritized hotspots for remediation.',
    annotations: {
      title: 'Hygiene Report',
      readOnlyHint: true,
      destructiveHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Optional project identifier. Uses default project if not specified.',
        },
        runLimit: {
          type: 'number',
          description: 'How many recent Vector runs to analyze for correlation (default: 50)',
        },
        correlateWithDrift: {
          type: 'boolean',
          description: 'Whether to correlate findings with Vector run history (default: true)',
        },
      },
    },
  },
  handler: async (args) => {
    try {
      const input: HygieneReportInput = {
        projectId: args.projectId,
        runLimit: args.runLimit,
        correlateWithDrift: args.correlateWithDrift,
      };

      const result = await generateHygieneReport(input);

      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// Domain Export
// ============================================================================

export const hygieneTools: ToolSpec[] = [
  sentinelScanCodebaseTool,
  sentinelScanCoverageTool,
  sentinelScanConfigTool,
  oracleHygieneReportTool,
];
