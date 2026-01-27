// ============================================================================
// Auditor Domain Tools
// ============================================================================
// Code health assessment: smell detection, naming audits, health dashboards.
// These tools analyze actual source code, complementing Sentinel's work tracking.
// ============================================================================

import fs from 'fs/promises';
import path from 'path';
import YAML from 'yaml';
import { resolveProjectPaths, ResolvedProjectPaths } from '../projectRegistry.js';
import { ensureDir } from '../dataRoot.js';

// ============================================================================
// Types
// ============================================================================

export type SmellType =
  | 'god_file'
  | 'rule_sprawl'
  | 'dip_violation'
  | 'duplicate_code'
  | 'hidden_rules'
  | 'buried_legacy'
  | 'naming_drift'
  | 'missing_tests'
  | 'hidden_side_effects'
  | 'hardcoded_values';

export type SmellSeverity = 'high' | 'medium' | 'low';

export interface CodeSmell {
  file: string;
  line?: number;
  smell: SmellType;
  severity: SmellSeverity;
  message: string;
  suggestion?: string;
}

export interface AuditorTriageInput {
  projectId?: string;
  path?: string;           // Specific file or directory
  checks?: SmellType[];    // Which checks to run (default: all)
  extensions?: string[];   // File extensions to scan (auto-detected if not provided)
}

export interface AuditorTriageOutput {
  scanned: number;
  issues: CodeSmell[];
  summary: {
    high: number;
    medium: number;
    low: number;
  };
}

export interface AuditorNamingInput {
  projectId?: string;
  conventions?: string;    // Path to naming-conventions.yml (auto-detect if not provided)
  extensions?: string[];   // File extensions to scan (auto-detected if not provided)
}

export interface NamingViolation {
  file: string;
  line: number;
  found: string;
  expected: string;
  category: 'variable' | 'function' | 'class' | 'file' | 'constant';
}

export interface AuditorNamingOutput {
  violations: NamingViolation[];
  stats: {
    checked: number;
    passed: number;
    violations: number;
  };
}

export interface RefactorCandidate {
  file: string;
  score: number;           // 0-100, higher = more urgent
  factors: {
    lines: number;
    complexity: number;
    smellCount: number;
    testCoverage?: number;
    lastModified?: string;
    changeFrequency?: number;
  };
  recommendation: 'split' | 'extract' | 'simplify' | 'delete' | 'refactor';
}

export interface AuditorRefactorInput {
  projectId?: string;
  limit?: number;          // Max candidates to return (default: 10)
  extensions?: string[];   // File extensions to scan (auto-detected if not provided)
}

export interface AuditorRefactorOutput {
  candidates: RefactorCandidate[];
  totalFiles: number;
}

export interface CodeHealthMetrics {
  totalFiles: number;
  totalLines: number;
  godFiles: number;
  avgFileSize: number;
  maxFileSize: number;
  namingViolations: number;
  smellCount: {
    high: number;
    medium: number;
    low: number;
  };
}

export interface AuditorHealthInput {
  projectId?: string;
  extensions?: string[];   // File extensions to scan (auto-detected if not provided)
}

export interface AuditorHealthOutput {
  timestamp: string;
  project: string;
  metrics: CodeHealthMetrics;
  trends?: {
    godFiles: 'improving' | 'stable' | 'degrading';
    smells: 'improving' | 'stable' | 'degrading';
  };
  topOffenders: Array<{
    file: string;
    issues: number;
  }>;
}

export interface AuditorInitInput {
  projectId?: string;
}

export interface AuditorInitOutput {
  path: string;
  created: boolean;
}

// ============================================================================
// Health Tracking Types
// ============================================================================

export interface HealthSnapshot {
  timestamp: string;
  metrics: CodeHealthMetrics;
  commit?: string;  // Git commit SHA at time of snapshot
}

export interface AuditorLogHealthInput {
  projectId?: string;
  commit?: string;  // Optional: include current git commit SHA
}

export interface AuditorLogHealthOutput {
  logged: boolean;
  path: string;
  snapshot: HealthSnapshot;
  entryCount: number;  // Total entries in log after this one
}

export interface AuditorHealthHistoryInput {
  projectId?: string;
  limit?: number;  // Max entries to return (default: 10)
}

export interface AuditorHealthHistoryOutput {
  entries: HealthSnapshot[];
  trends: {
    godFiles: 'improving' | 'stable' | 'degrading';
    smells: 'improving' | 'stable' | 'degrading';
    totalLines: 'growing' | 'stable' | 'shrinking';
  };
  summary: {
    oldestEntry: string;
    newestEntry: string;
    totalSnapshots: number;
  };
}

export interface AuditorError {
  error: string;
  details?: string;
}

// ============================================================================
// Constants
// ============================================================================

const GOD_FILE_THRESHOLD = 400;  // Lines
const NESTING_THRESHOLD = 4;     // Levels
const FUNCTION_LENGTH_THRESHOLD = 50;  // Lines
const MAGIC_NUMBER_PATTERN = /(?<![a-zA-Z_])(?:0x[a-fA-F0-9]+|\d{4,})(?![a-zA-Z_])/g;
const HARDCODED_URL_PATTERN = /(['"`])(https?:\/\/[^'"`]+)\1/g;
const TODO_PATTERN = /\/\/\s*(TODO|FIXME|HACK|XXX)/gi;
const COMMENTED_CODE_PATTERN = /\/\/\s*(const|let|var|function|class|if|for|while|return)\s/g;

const DEFAULT_CHECKS: SmellType[] = [
  'god_file',
  'rule_sprawl',
  'hidden_rules',
  'buried_legacy',
  'hardcoded_values',
];

// ============================================================================
// Helpers
// ============================================================================

function makeError(message: string, details?: string): AuditorError {
  return { error: message, details };
}

// Extension sets by project type
const EXTENSION_SETS = {
  typescript: ['.ts', '.tsx', '.js', '.jsx'],
  javascript: ['.js', '.jsx', '.mjs', '.cjs'],
  python: ['.py'],
  go: ['.go'],
  rust: ['.rs'],
  all: ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs'],
};

/**
 * Auto-detect project type based on config files present.
 * Returns the appropriate file extensions to scan.
 */
async function detectProjectExtensions(projectPath: string): Promise<string[]> {
  const checks = [
    { file: 'package.json', extensions: EXTENSION_SETS.typescript },
    { file: 'tsconfig.json', extensions: EXTENSION_SETS.typescript },
    { file: 'pyproject.toml', extensions: EXTENSION_SETS.python },
    { file: 'requirements.txt', extensions: EXTENSION_SETS.python },
    { file: 'setup.py', extensions: EXTENSION_SETS.python },
    { file: 'go.mod', extensions: EXTENSION_SETS.go },
    { file: 'Cargo.toml', extensions: EXTENSION_SETS.rust },
  ];

  for (const check of checks) {
    try {
      await fs.access(path.join(projectPath, check.file));
      return check.extensions;
    } catch {
      // File doesn't exist, try next
    }
  }

  // Default to TypeScript/JavaScript if no config found
  return EXTENSION_SETS.typescript;
}

async function getSourceFiles(dir: string, extensions: string[]): Promise<string[]> {
  const files: string[] = [];

  async function scan(currentDir: string): Promise<void> {
    try {
      const entries = await fs.readdir(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);

        // Skip common non-source directories
        if (entry.isDirectory()) {
          if (entry.name.startsWith('.') ||
              entry.name === 'node_modules' ||
              entry.name === 'dist' ||
              entry.name === 'build' ||
              entry.name === 'coverage' ||
              entry.name === '__pycache__' ||
              entry.name === '.venv' ||
              entry.name === 'venv' ||
              entry.name === 'env' ||
              entry.name === 'target') {
            continue;
          }
          await scan(fullPath);
        } else if (entry.isFile() && extensions.some(ext => entry.name.endsWith(ext))) {
          files.push(fullPath);
        }
      }
    } catch {
      // Directory doesn't exist or can't be read
    }
  }

  await scan(dir);
  return files;
}

function countNestingDepth(content: string): number {
  let maxDepth = 0;
  let currentDepth = 0;

  for (const char of content) {
    if (char === '{') {
      currentDepth++;
      maxDepth = Math.max(maxDepth, currentDepth);
    } else if (char === '}') {
      currentDepth = Math.max(0, currentDepth - 1);
    }
  }

  return maxDepth;
}

function findLongFunctions(content: string, filePath: string): CodeSmell[] {
  const issues: CodeSmell[] = [];
  const functionPattern = /(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>|(\w+)\s*\([^)]*\)\s*\{)/g;

  let match;
  while ((match = functionPattern.exec(content)) !== null) {
    const funcName = match[1] || match[2] || match[3] || 'anonymous';
    const startIndex = match.index;
    const lineNumber = content.substring(0, startIndex).split('\n').length;

    // Find the function body (simplified: count braces)
    let braceCount = 0;
    let started = false;
    let endIndex = startIndex;

    for (let i = startIndex; i < content.length; i++) {
      if (content[i] === '{') {
        braceCount++;
        started = true;
      } else if (content[i] === '}') {
        braceCount--;
        if (started && braceCount === 0) {
          endIndex = i;
          break;
        }
      }
    }

    const funcBody = content.substring(startIndex, endIndex);
    const funcLines = funcBody.split('\n').length;

    if (funcLines > FUNCTION_LENGTH_THRESHOLD) {
      issues.push({
        file: filePath,
        line: lineNumber,
        smell: 'god_file',  // Using god_file for long functions too
        severity: funcLines > 100 ? 'high' : 'medium',
        message: `Function '${funcName}' is ${funcLines} lines (threshold: ${FUNCTION_LENGTH_THRESHOLD})`,
        suggestion: 'Consider breaking this function into smaller, focused functions',
      });
    }
  }

  return issues;
}

// ============================================================================
// Triage (Code Smell Detection)
// ============================================================================

export async function auditorTriage(
  input: AuditorTriageInput
): Promise<AuditorTriageOutput | AuditorError> {
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.projectId);
  } catch {
    return makeError('Failed to resolve project path');
  }

  // Auto-detect source path: try common patterns if not specified
  let scanPath: string;
  if (input.path) {
    scanPath = path.isAbsolute(input.path) ? input.path : path.join(resolved.projectPath, input.path);
  } else {
    // Try common source directories, fall back to project root
    const candidates = ['src', 'lib', 'app', resolved.id || path.basename(resolved.projectPath)];
    scanPath = resolved.projectPath; // default to project root
    for (const candidate of candidates) {
      try {
        const candidatePath = path.join(resolved.projectPath, candidate);
        const stat = await fs.stat(candidatePath);
        if (stat.isDirectory()) {
          scanPath = candidatePath;
          break;
        }
      } catch {
        // Try next candidate
      }
    }
  }

  // Auto-detect extensions or use provided
  const extensions = input.extensions || await detectProjectExtensions(resolved.projectPath);

  const checks = input.checks || DEFAULT_CHECKS;
  const issues: CodeSmell[] = [];

  // Get all source files
  const files = await getSourceFiles(scanPath, extensions);

  for (const filePath of files) {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n');
      const lineCount = lines.length;
      const relativePath = path.relative(resolved.projectPath, filePath);

      // Check: God File (file too large)
      if (checks.includes('god_file') && lineCount > GOD_FILE_THRESHOLD) {
        issues.push({
          file: relativePath,
          smell: 'god_file',
          severity: lineCount > 600 ? 'high' : 'medium',
          message: `File has ${lineCount} lines (threshold: ${GOD_FILE_THRESHOLD})`,
          suggestion: 'Consider splitting into smaller, focused modules',
        });

        // Also check for long functions within god files
        const longFuncs = findLongFunctions(content, relativePath);
        issues.push(...longFuncs);
      }

      // Check: Rule Sprawl (deep nesting)
      if (checks.includes('rule_sprawl')) {
        const depth = countNestingDepth(content);
        if (depth > NESTING_THRESHOLD) {
          issues.push({
            file: relativePath,
            smell: 'rule_sprawl',
            severity: depth > 6 ? 'high' : 'medium',
            message: `Nesting depth of ${depth} (threshold: ${NESTING_THRESHOLD})`,
            suggestion: 'Consider extracting nested logic into separate functions',
          });
        }
      }

      // Regex match variable for all pattern checks
      let match: RegExpExecArray | null;

      // Check: Hidden Rules (magic numbers, hardcoded URLs)
      if (checks.includes('hidden_rules')) {
        // Magic numbers
        while ((match = MAGIC_NUMBER_PATTERN.exec(content)) !== null) {
          const lineNum = content.substring(0, match.index).split('\n').length;
          // Skip common safe numbers
          if (!['1000', '1024', '2048', '3000', '8080'].includes(match[0])) {
            issues.push({
              file: relativePath,
              line: lineNum,
              smell: 'hidden_rules',
              severity: 'low',
              message: `Magic number: ${match[0]}`,
              suggestion: 'Extract to a named constant with documentation',
            });
          }
        }

        // Hardcoded URLs
        while ((match = HARDCODED_URL_PATTERN.exec(content)) !== null) {
          const lineNum = content.substring(0, match.index).split('\n').length;
          issues.push({
            file: relativePath,
            line: lineNum,
            smell: 'hidden_rules',
            severity: 'medium',
            message: `Hardcoded URL: ${match[2].substring(0, 50)}...`,
            suggestion: 'Move to environment variable or config file',
          });
        }
      }

      // Check: Hardcoded Values
      if (checks.includes('hardcoded_values')) {
        // Look for common hardcoded patterns
        const apiKeyPattern = /['"`](sk-|api[_-]?key|secret)[^'"`]*['"`]/gi;
        while ((match = apiKeyPattern.exec(content)) !== null) {
          const lineNum = content.substring(0, match.index).split('\n').length;
          issues.push({
            file: relativePath,
            line: lineNum,
            smell: 'hardcoded_values',
            severity: 'high',
            message: 'Potential hardcoded API key or secret',
            suggestion: 'Move to environment variable',
          });
        }
      }

      // Check: Buried Legacy (TODOs, commented code)
      if (checks.includes('buried_legacy')) {
        while ((match = TODO_PATTERN.exec(content)) !== null) {
          const lineNum = content.substring(0, match.index).split('\n').length;
          issues.push({
            file: relativePath,
            line: lineNum,
            smell: 'buried_legacy',
            severity: 'low',
            message: `${match[1].toUpperCase()} comment found`,
            suggestion: 'Create an issue to track this, or resolve it',
          });
        }

        while ((match = COMMENTED_CODE_PATTERN.exec(content)) !== null) {
          const lineNum = content.substring(0, match.index).split('\n').length;
          issues.push({
            file: relativePath,
            line: lineNum,
            smell: 'buried_legacy',
            severity: 'low',
            message: 'Commented-out code detected',
            suggestion: 'Remove dead code or restore if needed',
          });
        }
      }

    } catch {
      // File read failed, skip
    }
  }

  // Calculate summary
  const summary = {
    high: issues.filter(i => i.severity === 'high').length,
    medium: issues.filter(i => i.severity === 'medium').length,
    low: issues.filter(i => i.severity === 'low').length,
  };

  return {
    scanned: files.length,
    issues,
    summary,
  };
}

// ============================================================================
// Health Dashboard
// ============================================================================

export async function auditorHealth(
  input: AuditorHealthInput
): Promise<AuditorHealthOutput | AuditorError> {
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.projectId);
  } catch {
    return makeError('Failed to resolve project path');
  }

  const projectId = resolved.id || path.basename(resolved.projectPath);

  // Auto-detect extensions or use provided
  const extensions = input.extensions || await detectProjectExtensions(resolved.projectPath);

  // Auto-detect source path, fall back to project root
  let srcPath = resolved.projectPath;
  const candidates = ['src', 'lib', 'app', projectId];
  for (const candidate of candidates) {
    try {
      const candidatePath = path.join(resolved.projectPath, candidate);
      const stat = await fs.stat(candidatePath);
      if (stat.isDirectory()) {
        srcPath = candidatePath;
        break;
      }
    } catch {
      // Try next candidate
    }
  }

  // Get all source files
  const files = await getSourceFiles(srcPath, extensions);

  let totalLines = 0;
  let maxFileSize = 0;
  let godFiles = 0;
  const fileIssues: Map<string, number> = new Map();

  for (const filePath of files) {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lineCount = content.split('\n').length;
      const relativePath = path.relative(resolved.projectPath, filePath);

      totalLines += lineCount;
      maxFileSize = Math.max(maxFileSize, lineCount);

      if (lineCount > GOD_FILE_THRESHOLD) {
        godFiles++;
        fileIssues.set(relativePath, (fileIssues.get(relativePath) || 0) + 1);
      }

      // Count other issues
      const depth = countNestingDepth(content);
      if (depth > NESTING_THRESHOLD) {
        fileIssues.set(relativePath, (fileIssues.get(relativePath) || 0) + 1);
      }

      const todoMatches = content.match(TODO_PATTERN);
      if (todoMatches) {
        fileIssues.set(relativePath, (fileIssues.get(relativePath) || 0) + todoMatches.length);
      }
    } catch {
      // Skip unreadable files
    }
  }

  // Run triage to get smell counts (pass extensions so it doesn't re-detect)
  const triageResult = await auditorTriage({ projectId: input.projectId, extensions });
  const smellCount = 'error' in triageResult
    ? { high: 0, medium: 0, low: 0 }
    : triageResult.summary;

  // Get top offenders
  const topOffenders = Array.from(fileIssues.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([file, issues]) => ({ file, issues }));

  // Try to compute trends from history
  let trends: AuditorHealthOutput['trends'];
  try {
    const healthLogPath = path.join(resolved.subPath('auditor'), HEALTH_LOG_FILENAME);
    const content = await fs.readFile(healthLogPath, 'utf-8');
    const parsed = YAML.parse(content);
    if (Array.isArray(parsed) && parsed.length >= 2) {
      const entries = parsed as HealthSnapshot[];
      const godFilesValues = entries.map(e => e.metrics.godFiles);
      const smellsValues = entries.map(e =>
        e.metrics.smellCount.high + e.metrics.smellCount.medium + e.metrics.smellCount.low
      );

      // Compare first half average to second half average
      const computeSmellTrend = (values: number[]): 'improving' | 'stable' | 'degrading' => {
        const midpoint = Math.floor(values.length / 2);
        const firstAvg = values.slice(0, midpoint).reduce((a, b) => a + b, 0) / midpoint;
        const secondAvg = values.slice(midpoint).reduce((a, b) => a + b, 0) / (values.length - midpoint);
        const change = (secondAvg - firstAvg) / (firstAvg || 1);
        if (change < -0.1) return 'improving';
        if (change > 0.1) return 'degrading';
        return 'stable';
      };

      trends = {
        godFiles: computeSmellTrend(godFilesValues),
        smells: computeSmellTrend(smellsValues),
      };
    }
  } catch {
    // No history available, trends will be undefined
  }

  return {
    timestamp: new Date().toISOString(),
    project: projectId,
    metrics: {
      totalFiles: files.length,
      totalLines,
      godFiles,
      avgFileSize: files.length > 0 ? Math.round(totalLines / files.length) : 0,
      maxFileSize,
      namingViolations: 0,  // Would require naming audit
      smellCount,
    },
    trends,
    topOffenders,
  };
}

// ============================================================================
// Refactor Score
// ============================================================================

export async function auditorRefactorScore(
  input: AuditorRefactorInput
): Promise<AuditorRefactorOutput | AuditorError> {
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.projectId);
  } catch {
    return makeError('Failed to resolve project path');
  }

  const limit = input.limit || 10;
  const projectId = resolved.id || path.basename(resolved.projectPath);

  // Auto-detect extensions or use provided
  const extensions = input.extensions || await detectProjectExtensions(resolved.projectPath);

  // Auto-detect source path, fall back to project root
  let srcPath = resolved.projectPath;
  const candidates_paths = ['src', 'lib', 'app', projectId];
  for (const candidate of candidates_paths) {
    try {
      const candidatePath = path.join(resolved.projectPath, candidate);
      const stat = await fs.stat(candidatePath);
      if (stat.isDirectory()) {
        srcPath = candidatePath;
        break;
      }
    } catch {
      // Try next candidate
    }
  }

  const files = await getSourceFiles(srcPath, extensions);

  const candidates: RefactorCandidate[] = [];

  for (const filePath of files) {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lineCount = content.split('\n').length;
      const relativePath = path.relative(resolved.projectPath, filePath);
      const complexity = countNestingDepth(content);

      // Count smells in this file
      let smellCount = 0;
      if (lineCount > GOD_FILE_THRESHOLD) smellCount++;
      if (complexity > NESTING_THRESHOLD) smellCount++;

      const todoMatches = content.match(TODO_PATTERN);
      if (todoMatches) smellCount += todoMatches.length;

      // Calculate score (higher = more urgent to refactor)
      // Formula: (lines/100) * 3 + complexity * 2 + smellCount * 5
      const score = Math.min(100, Math.round(
        (lineCount / 100) * 3 +
        complexity * 2 +
        smellCount * 5
      ));

      // Determine recommendation
      let recommendation: RefactorCandidate['recommendation'] = 'refactor';
      if (lineCount > 600) recommendation = 'split';
      else if (complexity > 6) recommendation = 'simplify';
      else if (smellCount > 5) recommendation = 'extract';

      if (score > 20) {  // Only include files that need attention
        candidates.push({
          file: relativePath,
          score,
          factors: {
            lines: lineCount,
            complexity,
            smellCount,
          },
          recommendation,
        });
      }
    } catch {
      // Skip unreadable files
    }
  }

  // Sort by score descending and limit
  candidates.sort((a, b) => b.score - a.score);

  return {
    candidates: candidates.slice(0, limit),
    totalFiles: files.length,
  };
}

// ============================================================================
// Init (Create naming conventions scaffold)
// ============================================================================

export async function auditorInit(
  input: AuditorInitInput
): Promise<AuditorInitOutput | AuditorError> {
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.projectId);
  } catch {
    return makeError('Failed to resolve project path');
  }

  const conventionsPath = path.join(resolved.projectPath, 'naming-conventions.yml');

  // Check if already exists
  try {
    await fs.access(conventionsPath);
    return { path: conventionsPath, created: false };
  } catch {
    // File doesn't exist, create it
  }

  const scaffold = `# Naming Conventions
# Generated by Decibel Auditor
# Customize this file to match your project's conventions

entities:
  # Define naming conventions for your core entities
  # user:
  #   variable: user, currentUser
  #   function_prefix: get_user, create_user, update_user
  #   class: User, UserProfile, UserService
  #   table: users
  #   api_field: user_id, user_email

patterns:
  collections: plural (users, orders, items)
  single_item: singular (user, order, item)
  booleans: is_, has_, can_, should_ prefix
  async_functions: async_ prefix or _async suffix (pick one)
  private: _ prefix for internal methods
  constants: UPPER_SNAKE_CASE

anti_patterns:
  - data, info, manager, handler, utils (too vague)
  - temp, tmp, foo, bar (temporary names)
  - abbreviations (ok: id, url, api | bad: usr, ord, cfg)

file_naming:
  components: PascalCase (UserProfile.tsx)
  utilities: camelCase (formatDate.ts)
  constants: UPPER_SNAKE_CASE or kebab-case
  tests: *.test.ts or *.spec.ts
`;

  await fs.writeFile(conventionsPath, scaffold, 'utf-8');

  return { path: conventionsPath, created: true };
}

// ============================================================================
// Naming Audit (Placeholder - would need AST parsing for full implementation)
// ============================================================================

export async function auditorNamingAudit(
  input: AuditorNamingInput
): Promise<AuditorNamingOutput | AuditorError> {
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.projectId);
  } catch {
    return makeError('Failed to resolve project path');
  }

  const projectId = resolved.id || path.basename(resolved.projectPath);

  // Auto-detect extensions or use provided
  const extensions = input.extensions || await detectProjectExtensions(resolved.projectPath);

  // Auto-detect source path, fall back to project root
  let srcPath = resolved.projectPath;
  const srcCandidates = ['src', 'lib', 'app', projectId];
  for (const candidate of srcCandidates) {
    try {
      const candidatePath = path.join(resolved.projectPath, candidate);
      const stat = await fs.stat(candidatePath);
      if (stat.isDirectory()) {
        srcPath = candidatePath;
        break;
      }
    } catch {
      // Try next candidate
    }
  }

  // For now, do basic file naming checks
  const files = await getSourceFiles(srcPath, extensions);
  const violations: NamingViolation[] = [];

  // Common anti-patterns in file names
  const antiPatterns = ['utils', 'helpers', 'misc', 'stuff', 'temp'];

  for (const filePath of files) {
    const fileName = path.basename(filePath, path.extname(filePath));
    const relativePath = path.relative(resolved.projectPath, filePath);

    for (const pattern of antiPatterns) {
      if (fileName.toLowerCase() === pattern || fileName.toLowerCase().includes(pattern)) {
        violations.push({
          file: relativePath,
          line: 0,
          found: fileName,
          expected: 'More specific name describing the file\'s purpose',
          category: 'file',
        });
      }
    }
  }

  return {
    violations,
    stats: {
      checked: files.length,
      passed: files.length - violations.length,
      violations: violations.length,
    },
  };
}

// ============================================================================
// Health Tracking - Log Health Snapshot
// ============================================================================

const HEALTH_LOG_FILENAME = 'health-log.yaml';

export async function auditorLogHealth(
  input: AuditorLogHealthInput
): Promise<AuditorLogHealthOutput | AuditorError> {
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.projectId);
  } catch {
    return makeError('Failed to resolve project path');
  }

  // Get current health metrics
  const healthResult = await auditorHealth({ projectId: input.projectId });
  if ('error' in healthResult) {
    return healthResult;
  }

  // Create snapshot
  const snapshot: HealthSnapshot = {
    timestamp: healthResult.timestamp,
    metrics: healthResult.metrics,
    commit: input.commit,
  };

  // Ensure auditor directory exists
  const auditorDir = resolved.subPath('auditor');
  await ensureDir(auditorDir);

  const healthLogPath = path.join(auditorDir, HEALTH_LOG_FILENAME);

  // Read existing log or create new one
  let existingLog: HealthSnapshot[] = [];
  try {
    const content = await fs.readFile(healthLogPath, 'utf-8');
    const parsed = YAML.parse(content);
    if (Array.isArray(parsed)) {
      existingLog = parsed;
    }
  } catch {
    // File doesn't exist or is invalid, start fresh
  }

  // Append new snapshot
  existingLog.push(snapshot);

  // Write back
  await fs.writeFile(healthLogPath, YAML.stringify(existingLog), 'utf-8');

  return {
    logged: true,
    path: healthLogPath,
    snapshot,
    entryCount: existingLog.length,
  };
}

// ============================================================================
// Health Tracking - Get Health History
// ============================================================================

function computeTrend(values: number[]): 'improving' | 'stable' | 'degrading' {
  if (values.length < 2) return 'stable';

  // Compare first half average to second half average
  const midpoint = Math.floor(values.length / 2);
  const firstHalf = values.slice(0, midpoint);
  const secondHalf = values.slice(midpoint);

  const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
  const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

  const change = (secondAvg - firstAvg) / (firstAvg || 1);

  // More than 10% change is considered significant
  if (change < -0.1) return 'improving';
  if (change > 0.1) return 'degrading';
  return 'stable';
}

function computeGrowthTrend(values: number[]): 'growing' | 'stable' | 'shrinking' {
  if (values.length < 2) return 'stable';

  const midpoint = Math.floor(values.length / 2);
  const firstHalf = values.slice(0, midpoint);
  const secondHalf = values.slice(midpoint);

  const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
  const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

  const change = (secondAvg - firstAvg) / (firstAvg || 1);

  if (change > 0.1) return 'growing';
  if (change < -0.1) return 'shrinking';
  return 'stable';
}

export async function auditorHealthHistory(
  input: AuditorHealthHistoryInput
): Promise<AuditorHealthHistoryOutput | AuditorError> {
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.projectId);
  } catch {
    return makeError('Failed to resolve project path');
  }

  const limit = input.limit || 10;
  const healthLogPath = path.join(resolved.subPath('auditor'), HEALTH_LOG_FILENAME);

  // Read log
  let allEntries: HealthSnapshot[] = [];
  try {
    const content = await fs.readFile(healthLogPath, 'utf-8');
    const parsed = YAML.parse(content);
    if (Array.isArray(parsed)) {
      allEntries = parsed;
    }
  } catch {
    return makeError('No health history found', 'Use auditor_log_health to record snapshots first');
  }

  if (allEntries.length === 0) {
    return makeError('Health log is empty', 'Use auditor_log_health to record snapshots first');
  }

  // Get most recent entries up to limit
  const entries = allEntries.slice(-limit);

  // Compute trends from all entries (not just limited)
  const godFilesValues = allEntries.map(e => e.metrics.godFiles);
  const smellsValues = allEntries.map(e =>
    e.metrics.smellCount.high + e.metrics.smellCount.medium + e.metrics.smellCount.low
  );
  const linesValues = allEntries.map(e => e.metrics.totalLines);

  const trends = {
    godFiles: computeTrend(godFilesValues),
    smells: computeTrend(smellsValues),
    totalLines: computeGrowthTrend(linesValues),
  };

  return {
    entries,
    trends,
    summary: {
      oldestEntry: allEntries[0].timestamp,
      newestEntry: allEntries[allEntries.length - 1].timestamp,
      totalSnapshots: allEntries.length,
    },
  };
}

// ============================================================================
// Exports
// ============================================================================

export function isAuditorError(result: unknown): result is AuditorError {
  return typeof result === 'object' && result !== null && 'error' in result;
}
