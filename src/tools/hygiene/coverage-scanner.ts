// ============================================================================
// Coverage Scanner - Test Coverage Gap Analysis
// ============================================================================
// Detects test coverage gaps by analyzing test file presence, coverage reports,
// and test-to-source file ratios.
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Types
// ============================================================================

export interface CoverageFinding {
  id: string;
  category: 'coverage';
  severity: 'critical' | 'high' | 'medium' | 'low';
  type: 'no_tests' | 'low_coverage' | 'untested_critical' | 'missing_test_file';
  title: string;
  description: string;
  file?: string;
  directory?: string;
  suggestion?: string;
  metadata?: Record<string, unknown>;
}

export interface CoverageScanInput {
  projectPath: string;
  thresholds?: {
    minCoveragePercent?: number;  // Default: 70
  };
}

export interface DirectoryCoverage {
  directory: string;
  sourceFiles: number;
  testFiles: number;
  coverageRatio: number; // testFiles / sourceFiles
  hasTests: boolean;
  isCritical: boolean;   // Based on directory name patterns
}

export interface CoverageScanResult {
  findings: CoverageFinding[];
  score: number; // 0-100
  directories: DirectoryCoverage[];
  summary: {
    totalSourceFiles: number;
    totalTestFiles: number;
    overallCoverageRatio: number;
    directoriesWithNoTests: number;
    criticalPathsUntested: number;
  };
  scanDuration: number;
}

// ============================================================================
// Configuration
// ============================================================================

// Patterns that indicate critical code paths
const CRITICAL_PATH_PATTERNS = [
  /auth/i,
  /payment/i,
  /security/i,
  /crypto/i,
  /database/i,
  /api/i,
  /middleware/i,
  /validation/i,
  /session/i,
  /token/i,
];

// Patterns to identify test files
const TEST_FILE_PATTERNS = [
  /\.test\.[jt]sx?$/,
  /\.spec\.[jt]sx?$/,
  /_test\.[jt]sx?$/,
  /_spec\.[jt]sx?$/,
  /test_.*\.py$/,
  /.*_test\.py$/,
  /.*_test\.go$/,
  /.*_test\.rs$/,
];

// Patterns to identify source files (not tests, not config)
const SOURCE_FILE_PATTERNS = [
  /\.[jt]sx?$/,
  /\.py$/,
  /\.go$/,
  /\.rs$/,
];

// Directories to exclude from analysis
const EXCLUDE_DIRS = [
  'node_modules',
  'dist',
  'build',
  '.git',
  'vendor',
  '__pycache__',
  '.next',
  'coverage',
  '.nyc_output',
];

// ============================================================================
// File Classification
// ============================================================================

function isTestFile(fileName: string): boolean {
  return TEST_FILE_PATTERNS.some(pattern => pattern.test(fileName));
}

function isSourceFile(fileName: string): boolean {
  if (isTestFile(fileName)) return false;

  // Exclude common config files
  const configPatterns = [
    /\.config\.[jt]sx?$/,
    /\.d\.ts$/,
    /index\.[jt]sx?$/,     // Often just re-exports
    /types?\.[jt]sx?$/,    // Type definitions
  ];

  if (configPatterns.some(p => p.test(fileName))) {
    return false;
  }

  return SOURCE_FILE_PATTERNS.some(pattern => pattern.test(fileName));
}

function isCriticalPath(dirPath: string): boolean {
  return CRITICAL_PATH_PATTERNS.some(pattern => pattern.test(dirPath));
}

// ============================================================================
// Directory Analysis
// ============================================================================

function analyzeDirectory(
  dirPath: string,
  baseDir: string
): { sourceFiles: string[]; testFiles: string[] } {
  const sourceFiles: string[] = [];
  const testFiles: string[] = [];

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        // Skip excluded directories
        if (EXCLUDE_DIRS.includes(entry.name)) continue;

        // Recursively analyze subdirectories
        const subResult = analyzeDirectory(fullPath, baseDir);
        sourceFiles.push(...subResult.sourceFiles);
        testFiles.push(...subResult.testFiles);
      } else if (entry.isFile()) {
        const relativePath = path.relative(baseDir, fullPath);

        if (isTestFile(entry.name)) {
          testFiles.push(relativePath);
        } else if (isSourceFile(entry.name)) {
          sourceFiles.push(relativePath);
        }
      }
    }
  } catch {
    // Directory not readable
  }

  return { sourceFiles, testFiles };
}

function getDirectoryMap(
  projectPath: string
): Map<string, { sourceFiles: string[]; testFiles: string[] }> {
  const dirMap = new Map<string, { sourceFiles: string[]; testFiles: string[] }>();

  function walk(dir: string): void {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (EXCLUDE_DIRS.includes(entry.name)) continue;

          const fullPath = path.join(dir, entry.name);
          const relativePath = path.relative(projectPath, fullPath);

          // Initialize directory entry
          if (!dirMap.has(relativePath)) {
            dirMap.set(relativePath, { sourceFiles: [], testFiles: [] });
          }

          walk(fullPath);
        } else if (entry.isFile()) {
          const dirRelativePath = path.relative(projectPath, dir);
          const fileRelativePath = path.relative(projectPath, path.join(dir, entry.name));

          if (!dirMap.has(dirRelativePath)) {
            dirMap.set(dirRelativePath, { sourceFiles: [], testFiles: [] });
          }

          const dirEntry = dirMap.get(dirRelativePath)!;

          if (isTestFile(entry.name)) {
            dirEntry.testFiles.push(fileRelativePath);
          } else if (isSourceFile(entry.name)) {
            dirEntry.sourceFiles.push(fileRelativePath);
          }
        }
      }
    } catch {
      // Directory not readable
    }
  }

  walk(projectPath);
  return dirMap;
}

// ============================================================================
// Coverage Report Parsing (Optional Enhancement)
// ============================================================================

interface CoverageReportData {
  found: boolean;
  type: 'istanbul' | 'lcov' | 'cobertura' | 'unknown';
  overallPercent?: number;
  fileCoverage?: Map<string, number>;
}

function findCoverageReport(projectPath: string): CoverageReportData {
  // Look for common coverage report locations
  const reportLocations = [
    'coverage/coverage-summary.json',  // Istanbul
    'coverage/lcov.info',              // LCOV
    'coverage.xml',                    // Cobertura
    '.nyc_output/coverage.json',       // NYC
  ];

  for (const loc of reportLocations) {
    const fullPath = path.join(projectPath, loc);
    if (fs.existsSync(fullPath)) {
      try {
        if (loc.endsWith('.json')) {
          const content = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));

          // Istanbul format
          if (content.total?.lines?.pct !== undefined) {
            return {
              found: true,
              type: 'istanbul',
              overallPercent: content.total.lines.pct,
            };
          }
        }
        // For other formats, just note we found one
        return { found: true, type: 'unknown' };
      } catch {
        // Parse error
      }
    }
  }

  return { found: false, type: 'unknown' };
}

// ============================================================================
// Main Scanner
// ============================================================================

export async function scanCoverage(input: CoverageScanInput): Promise<CoverageScanResult> {
  const startTime = Date.now();
  const minCoverage = input.thresholds?.minCoveragePercent ?? 70;

  const findings: CoverageFinding[] = [];
  const directoryCoverage: DirectoryCoverage[] = [];

  // Get directory-level analysis
  const dirMap = getDirectoryMap(input.projectPath);

  let totalSourceFiles = 0;
  let totalTestFiles = 0;
  let dirsWithNoTests = 0;
  let criticalUntested = 0;

  // Analyze each directory
  for (const [dirPath, files] of dirMap) {
    // Skip directories with no source files
    if (files.sourceFiles.length === 0) continue;

    totalSourceFiles += files.sourceFiles.length;
    totalTestFiles += files.testFiles.length;

    const coverageRatio = files.testFiles.length / files.sourceFiles.length;
    const hasTests = files.testFiles.length > 0;
    const isCritical = isCriticalPath(dirPath);

    directoryCoverage.push({
      directory: dirPath,
      sourceFiles: files.sourceFiles.length,
      testFiles: files.testFiles.length,
      coverageRatio,
      hasTests,
      isCritical,
    });

    // Generate findings for directories with issues
    if (!hasTests) {
      dirsWithNoTests++;

      if (isCritical) {
        criticalUntested++;
        findings.push({
          id: `no-tests-critical-${dirPath.replace(/\//g, '-')}`,
          category: 'coverage',
          severity: 'critical',
          type: 'untested_critical',
          title: `Critical path without tests: ${dirPath}`,
          description: `Directory "${dirPath}" appears to contain critical code (${files.sourceFiles.length} source files) but has no test files.`,
          directory: dirPath,
          suggestion: 'Add test files for critical authentication, payment, or security code paths.',
          metadata: {
            sourceFiles: files.sourceFiles.length,
            criticalPatternMatch: CRITICAL_PATH_PATTERNS.find(p => p.test(dirPath))?.source,
          },
        });
      } else if (files.sourceFiles.length > 3) {
        // Only report non-critical dirs if they have substantial code
        findings.push({
          id: `no-tests-${dirPath.replace(/\//g, '-')}`,
          category: 'coverage',
          severity: 'medium',
          type: 'no_tests',
          title: `No tests for ${dirPath}`,
          description: `Directory "${dirPath}" has ${files.sourceFiles.length} source files but no test files.`,
          directory: dirPath,
          suggestion: 'Consider adding test files to improve coverage.',
          metadata: { sourceFiles: files.sourceFiles.length },
        });
      }
    } else if (coverageRatio < 0.5 && files.sourceFiles.length > 5) {
      // Low test-to-source ratio for substantial directories
      findings.push({
        id: `low-ratio-${dirPath.replace(/\//g, '-')}`,
        category: 'coverage',
        severity: isCritical ? 'high' : 'low',
        type: 'low_coverage',
        title: `Low test coverage ratio: ${dirPath}`,
        description: `Only ${files.testFiles.length} test files for ${files.sourceFiles.length} source files (${Math.round(coverageRatio * 100)}% ratio).`,
        directory: dirPath,
        suggestion: 'Add more tests to improve the test-to-source ratio.',
        metadata: { coverageRatio, sourceFiles: files.sourceFiles.length, testFiles: files.testFiles.length },
      });
    }
  }

  // Check for coverage report
  const coverageReport = findCoverageReport(input.projectPath);
  if (coverageReport.found && coverageReport.overallPercent !== undefined) {
    if (coverageReport.overallPercent < minCoverage) {
      findings.push({
        id: 'low-overall-coverage',
        category: 'coverage',
        severity: coverageReport.overallPercent < 50 ? 'high' : 'medium',
        type: 'low_coverage',
        title: `Overall code coverage is ${coverageReport.overallPercent.toFixed(1)}%`,
        description: `Code coverage is below the ${minCoverage}% threshold.`,
        suggestion: 'Run your test suite with coverage enabled and add tests for uncovered code.',
        metadata: { actual: coverageReport.overallPercent, threshold: minCoverage },
      });
    }
  }

  // Calculate score
  let score = 100;

  // Penalize based on findings
  for (const finding of findings) {
    switch (finding.severity) {
      case 'critical': score -= 20; break;
      case 'high': score -= 10; break;
      case 'medium': score -= 5; break;
      case 'low': score -= 2; break;
    }
  }

  // Bonus points for having coverage report
  if (coverageReport.found && coverageReport.overallPercent !== undefined) {
    if (coverageReport.overallPercent >= minCoverage) {
      score = Math.min(100, score + 10);
    }
  }

  score = Math.max(0, score);

  const overallCoverageRatio = totalSourceFiles > 0 ? totalTestFiles / totalSourceFiles : 0;

  return {
    findings,
    score,
    directories: directoryCoverage.sort((a, b) => {
      // Sort by: critical first, then by source file count
      if (a.isCritical !== b.isCritical) return a.isCritical ? -1 : 1;
      return b.sourceFiles - a.sourceFiles;
    }),
    summary: {
      totalSourceFiles,
      totalTestFiles,
      overallCoverageRatio,
      directoriesWithNoTests: dirsWithNoTests,
      criticalPathsUntested: criticalUntested,
    },
    scanDuration: Date.now() - startTime,
  };
}
