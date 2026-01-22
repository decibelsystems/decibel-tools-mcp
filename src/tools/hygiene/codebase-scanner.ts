// ============================================================================
// Codebase Scanner - Structural Code Analysis
// ============================================================================
// Detects structural technical debt: god scripts, rule sprawl, duplication,
// hardcoded values. Part of the Hygiene Scanner suite.
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Types
// ============================================================================

export interface CodebaseFinding {
  id: string;
  category: 'structural';
  severity: 'critical' | 'high' | 'medium' | 'low';
  type: 'god_script' | 'rule_sprawl' | 'duplication' | 'hardcoded_value' | 'deep_nesting';
  title: string;
  description: string;
  file: string;
  line?: number;
  suggestion?: string;
  metadata?: Record<string, unknown>;
}

export interface CodebaseScanInput {
  projectPath: string;
  thresholds?: {
    godScriptLines?: number;     // Default: 500
    ruleSprawlChains?: number;   // Default: 10
    nestingDepth?: number;       // Default: 5
  };
  includePatterns?: string[];    // Default: ['**/*.ts', '**/*.js', '**/*.py', '**/*.tsx', '**/*.jsx']
  excludePatterns?: string[];    // Default: ['node_modules/**', 'dist/**', '.git/**']
}

export interface CodebaseScanResult {
  findings: CodebaseFinding[];
  score: number; // 0-100, higher = healthier
  summary: {
    totalFiles: number;
    totalLines: number;
    godScripts: number;
    ruleSprawl: number;
    duplications: number;
    hardcodedValues: number;
    deepNesting: number;
  };
  scanDuration: number; // ms
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_THRESHOLDS = {
  godScriptLines: 500,
  ruleSprawlChains: 10,
  nestingDepth: 5,
};

const DEFAULT_INCLUDE = ['**/*.ts', '**/*.js', '**/*.py', '**/*.tsx', '**/*.jsx', '**/*.go', '**/*.rs'];
const DEFAULT_EXCLUDE = ['node_modules/**', 'dist/**', 'build/**', '.git/**', '**/*.min.js', '**/*.bundle.js', 'vendor/**', '__pycache__/**'];

// Patterns for hardcoded values that should be env vars or config
const HARDCODED_PATTERNS = [
  // API keys and secrets (various formats)
  { pattern: /['"](?:sk|pk|api|key|secret|token|auth)[-_]?[a-zA-Z0-9]{20,}['"]/gi, type: 'api_key', severity: 'critical' as const },
  // AWS keys
  { pattern: /['"]AKIA[A-Z0-9]{16}['"]/g, type: 'aws_key', severity: 'critical' as const },
  // Private keys
  { pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g, type: 'private_key', severity: 'critical' as const },
  // JWT tokens
  { pattern: /['"]eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+['"]/g, type: 'jwt', severity: 'high' as const },
  // Database connection strings
  { pattern: /['"](?:postgres|mysql|mongodb|redis):\/\/[^'"]+['"]/gi, type: 'db_connection', severity: 'high' as const },
  // Hardcoded URLs that look like prod/staging (not localhost)
  { pattern: /['"]https?:\/\/(?!localhost|127\.0\.0\.1)[a-zA-Z0-9.-]+\.(?:com|io|net|org|co)[^'"]*['"]/gi, type: 'hardcoded_url', severity: 'medium' as const },
  // Hardcoded IPs (not localhost)
  { pattern: /['"](?!127\.0\.0\.1|0\.0\.0\.0)\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}['"]/g, type: 'hardcoded_ip', severity: 'medium' as const },
];

// ============================================================================
// File Discovery
// ============================================================================

function shouldIncludeFile(filePath: string, include: string[], exclude: string[]): boolean {
  const relativePath = filePath;

  // Check excludes first
  for (const pattern of exclude) {
    if (matchGlob(relativePath, pattern)) {
      return false;
    }
  }

  // Check includes
  for (const pattern of include) {
    if (matchGlob(relativePath, pattern)) {
      return true;
    }
  }

  return false;
}

function matchGlob(filePath: string, pattern: string): boolean {
  // Simple glob matching (supports ** and *)
  const regexPattern = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '<<<GLOBSTAR>>>')
    .replace(/\*/g, '[^/]*')
    .replace(/<<<GLOBSTAR>>>/g, '.*');

  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(filePath);
}

function walkDirectory(dir: string, baseDir: string, include: string[], exclude: string[]): string[] {
  const files: string[] = [];

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(baseDir, fullPath);

      if (entry.isDirectory()) {
        // Check if directory should be excluded
        let skipDir = false;
        for (const pattern of exclude) {
          if (matchGlob(relativePath + '/', pattern) || matchGlob(relativePath, pattern.replace('/**', ''))) {
            skipDir = true;
            break;
          }
        }

        if (!skipDir) {
          files.push(...walkDirectory(fullPath, baseDir, include, exclude));
        }
      } else if (entry.isFile()) {
        if (shouldIncludeFile(relativePath, include, exclude)) {
          files.push(fullPath);
        }
      }
    }
  } catch {
    // Directory not readable, skip
  }

  return files;
}

// ============================================================================
// Detection Functions
// ============================================================================

function detectGodScript(filePath: string, content: string, threshold: number): CodebaseFinding | null {
  const lines = content.split('\n');
  const lineCount = lines.length;

  if (lineCount > threshold) {
    return {
      id: `god-script-${path.basename(filePath)}`,
      category: 'structural',
      severity: lineCount > threshold * 2 ? 'high' : 'medium',
      type: 'god_script',
      title: `God script detected: ${lineCount} lines`,
      description: `File exceeds ${threshold} line threshold. Large files are harder to maintain and test.`,
      file: filePath,
      suggestion: 'Consider breaking this file into smaller, focused modules with single responsibilities.',
      metadata: { lineCount, threshold },
    };
  }

  return null;
}

function detectRuleSprawl(filePath: string, content: string, threshold: number): CodebaseFinding[] {
  const findings: CodebaseFinding[] = [];
  const lines = content.split('\n');

  // Track consecutive elif/else if chains
  let chainStart = -1;
  let chainLength = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Detect if/elif chains (Python, JS, TS)
    const isElif = /^(?:elif|else\s+if|}\s*else\s+if)/.test(trimmed);
    const isIf = /^if\s*\(|^if\s+/.test(trimmed);

    if (isIf && chainStart === -1) {
      chainStart = i;
      chainLength = 1;
    } else if (isElif && chainStart !== -1) {
      chainLength++;
    } else if (chainStart !== -1 && !isElif) {
      // Chain ended
      if (chainLength >= threshold) {
        findings.push({
          id: `rule-sprawl-${path.basename(filePath)}-${chainStart}`,
          category: 'structural',
          severity: chainLength > threshold * 1.5 ? 'high' : 'medium',
          type: 'rule_sprawl',
          title: `Rule sprawl: ${chainLength} chained conditions`,
          description: `Found ${chainLength} consecutive elif/else-if statements. This pattern is hard to maintain and often indicates missing abstraction.`,
          file: filePath,
          line: chainStart + 1,
          suggestion: 'Consider using a lookup table, strategy pattern, or polymorphism instead of long conditional chains.',
          metadata: { chainLength, threshold },
        });
      }
      chainStart = -1;
      chainLength = 0;
    }

    // Also detect switch statements with many cases
    if (/^switch\s*\(/.test(trimmed)) {
      const switchCases = countSwitchCases(lines, i);
      if (switchCases >= threshold) {
        findings.push({
          id: `switch-sprawl-${path.basename(filePath)}-${i}`,
          category: 'structural',
          severity: switchCases > threshold * 1.5 ? 'high' : 'medium',
          type: 'rule_sprawl',
          title: `Large switch statement: ${switchCases} cases`,
          description: `Switch with ${switchCases} cases. Consider using a lookup object or map instead.`,
          file: filePath,
          line: i + 1,
          suggestion: 'Replace with a lookup object: const handlers = { case1: fn1, case2: fn2, ... }',
          metadata: { caseCount: switchCases },
        });
      }
    }
  }

  return findings;
}

function countSwitchCases(lines: string[], startLine: number): number {
  let caseCount = 0;
  let braceDepth = 0;
  let inSwitch = false;

  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i];

    if (line.includes('{')) {
      braceDepth += (line.match(/{/g) || []).length;
      inSwitch = true;
    }
    if (line.includes('}')) {
      braceDepth -= (line.match(/}/g) || []).length;
    }

    if (inSwitch && /^\s*case\s+/.test(line)) {
      caseCount++;
    }

    if (inSwitch && braceDepth <= 0) {
      break;
    }
  }

  return caseCount;
}

function detectDeepNesting(filePath: string, content: string, threshold: number): CodebaseFinding[] {
  const findings: CodebaseFinding[] = [];
  const lines = content.split('\n');

  // Track brace depth and indentation
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Count leading spaces/tabs to estimate nesting
    const leadingWhitespace = line.match(/^(\s*)/)?.[1] || '';
    const indentLevel = Math.floor(leadingWhitespace.replace(/\t/g, '    ').length / 2);

    // Also count actual braces up to this point for more accuracy
    const contentUpToLine = lines.slice(0, i + 1).join('\n');
    const openBraces = (contentUpToLine.match(/{/g) || []).length;
    const closeBraces = (contentUpToLine.match(/}/g) || []).length;
    const braceDepth = openBraces - closeBraces;

    const effectiveDepth = Math.max(indentLevel, braceDepth);

    if (effectiveDepth > threshold && line.trim().length > 0) {
      // Only report once per deep section
      const existingFinding = findings.find(f =>
        Math.abs((f.line || 0) - (i + 1)) < 10
      );

      if (!existingFinding) {
        findings.push({
          id: `deep-nesting-${path.basename(filePath)}-${i}`,
          category: 'structural',
          severity: effectiveDepth > threshold + 3 ? 'high' : 'medium',
          type: 'deep_nesting',
          title: `Deep nesting: ${effectiveDepth} levels`,
          description: `Code nested ${effectiveDepth} levels deep. Deep nesting reduces readability and indicates complex logic that should be extracted.`,
          file: filePath,
          line: i + 1,
          suggestion: 'Extract inner logic into separate functions, use early returns, or apply the "guard clause" pattern.',
          metadata: { depth: effectiveDepth, threshold },
        });
      }
    }
  }

  return findings;
}

function detectHardcodedValues(filePath: string, content: string): CodebaseFinding[] {
  const findings: CodebaseFinding[] = [];
  const lines = content.split('\n');

  for (const { pattern, type, severity } of HARDCODED_PATTERNS) {
    // Reset regex lastIndex for global patterns
    pattern.lastIndex = 0;

    let match;
    while ((match = pattern.exec(content)) !== null) {
      // Find line number
      const upToMatch = content.substring(0, match.index);
      const lineNumber = upToMatch.split('\n').length;

      // Skip if it's in a comment
      const line = lines[lineNumber - 1] || '';
      if (line.trim().startsWith('//') || line.trim().startsWith('#') || line.trim().startsWith('*')) {
        continue;
      }

      // Mask the sensitive value for display
      const maskedValue = match[0].substring(0, 10) + '...' + match[0].substring(match[0].length - 3);

      findings.push({
        id: `hardcoded-${type}-${path.basename(filePath)}-${lineNumber}`,
        category: 'structural',
        severity,
        type: 'hardcoded_value',
        title: `Hardcoded ${type.replace('_', ' ')} detected`,
        description: `Found what appears to be a hardcoded ${type.replace('_', ' ')}: ${maskedValue}`,
        file: filePath,
        line: lineNumber,
        suggestion: 'Move to environment variable or secure configuration. Use process.env or a secrets manager.',
        metadata: { valueType: type },
      });

      // Prevent duplicate findings for overlapping matches
      pattern.lastIndex = match.index + match[0].length;
    }
  }

  return findings;
}

// Simple duplication detection (content hash based)
function detectDuplication(files: Map<string, string>): CodebaseFinding[] {
  const findings: CodebaseFinding[] = [];
  const blockHashes = new Map<string, { file: string; line: number }[]>();

  const BLOCK_SIZE = 6; // Minimum lines to consider as a "block"

  for (const [filePath, content] of files) {
    const lines = content.split('\n');

    // Create sliding window of normalized blocks
    for (let i = 0; i <= lines.length - BLOCK_SIZE; i++) {
      const block = lines.slice(i, i + BLOCK_SIZE)
        .map(l => l.trim())
        .filter(l => l.length > 0 && !l.startsWith('//') && !l.startsWith('#'))
        .join('\n');

      // Skip blocks that are mostly whitespace or comments
      if (block.length < 50) continue;

      // Simple hash
      const hash = simpleHash(block);

      if (!blockHashes.has(hash)) {
        blockHashes.set(hash, []);
      }
      blockHashes.get(hash)!.push({ file: filePath, line: i + 1 });
    }
  }

  // Find duplicates
  for (const [, locations] of blockHashes) {
    if (locations.length > 1) {
      // Group by file to avoid reporting same-file duplicates too aggressively
      const fileGroups = new Map<string, number[]>();
      for (const loc of locations) {
        if (!fileGroups.has(loc.file)) {
          fileGroups.set(loc.file, []);
        }
        fileGroups.get(loc.file)!.push(loc.line);
      }

      // Only report if duplicates span multiple files
      if (fileGroups.size > 1) {
        const firstLoc = locations[0];
        const otherFiles = Array.from(fileGroups.keys()).filter(f => f !== firstLoc.file);

        findings.push({
          id: `duplication-${path.basename(firstLoc.file)}-${firstLoc.line}`,
          category: 'structural',
          severity: locations.length > 3 ? 'high' : 'medium',
          type: 'duplication',
          title: `Duplicated code block (${locations.length} occurrences)`,
          description: `Similar code block found in ${fileGroups.size} files. Duplicated code increases maintenance burden.`,
          file: firstLoc.file,
          line: firstLoc.line,
          suggestion: `Extract shared logic into a reusable function. Also found in: ${otherFiles.slice(0, 3).map(f => path.basename(f)).join(', ')}`,
          metadata: { occurrences: locations.length, files: Array.from(fileGroups.keys()) },
        });
      }
    }
  }

  return findings;
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString(16);
}

// ============================================================================
// Main Scanner
// ============================================================================

export async function scanCodebase(input: CodebaseScanInput): Promise<CodebaseScanResult> {
  const startTime = Date.now();

  const thresholds = { ...DEFAULT_THRESHOLDS, ...input.thresholds };
  const include = input.includePatterns || DEFAULT_INCLUDE;
  const exclude = input.excludePatterns || DEFAULT_EXCLUDE;

  // Discover files
  const filePaths = walkDirectory(input.projectPath, input.projectPath, include, exclude);

  const findings: CodebaseFinding[] = [];
  const fileContents = new Map<string, string>();
  let totalLines = 0;

  // Scan each file
  for (const filePath of filePaths) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const relativePath = path.relative(input.projectPath, filePath);
      fileContents.set(relativePath, content);
      totalLines += content.split('\n').length;

      // Run detectors
      const godScript = detectGodScript(relativePath, content, thresholds.godScriptLines);
      if (godScript) findings.push(godScript);

      const ruleSprawl = detectRuleSprawl(relativePath, content, thresholds.ruleSprawlChains);
      findings.push(...ruleSprawl);

      const deepNesting = detectDeepNesting(relativePath, content, thresholds.nestingDepth);
      findings.push(...deepNesting);

      const hardcoded = detectHardcodedValues(relativePath, content);
      findings.push(...hardcoded);
    } catch {
      // File not readable, skip
    }
  }

  // Run cross-file analysis
  const duplications = detectDuplication(fileContents);
  findings.push(...duplications);

  // Calculate summary
  const summary = {
    totalFiles: filePaths.length,
    totalLines,
    godScripts: findings.filter(f => f.type === 'god_script').length,
    ruleSprawl: findings.filter(f => f.type === 'rule_sprawl').length,
    duplications: findings.filter(f => f.type === 'duplication').length,
    hardcodedValues: findings.filter(f => f.type === 'hardcoded_value').length,
    deepNesting: findings.filter(f => f.type === 'deep_nesting').length,
  };

  // Calculate score (0-100, higher = healthier)
  // Deduct points based on findings
  let score = 100;
  for (const finding of findings) {
    switch (finding.severity) {
      case 'critical': score -= 15; break;
      case 'high': score -= 10; break;
      case 'medium': score -= 5; break;
      case 'low': score -= 2; break;
    }
  }
  score = Math.max(0, score);

  return {
    findings,
    score,
    summary,
    scanDuration: Date.now() - startTime,
  };
}
