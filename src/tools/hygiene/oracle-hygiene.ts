// ============================================================================
// Oracle Hygiene Report - Drift Correlation Analysis
// ============================================================================
// Correlates hygiene findings with Vector run history to identify files that
// cause agent struggles. Generates prioritized hotspots for remediation.
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { resolveProjectPaths } from '../../projectRegistry.js';
import { scanCodebase } from './codebase-scanner.js';
import { scanCoverage } from './coverage-scanner.js';
import { scanConfig } from './config-scanner.js';

// ============================================================================
// Types
// ============================================================================

export interface DriftCorrelation {
  appearsInFailedRuns: number;
  totalRunsWithFile: number;
  correlationScore: number; // 0-1
  insight?: string;
}

export interface HygieneHotspot {
  file: string;
  findingCount: number;
  driftFrequency: number; // 0-1
  priority: number;
  topFindings: string[];
}

export interface HygieneFinding {
  id: string;
  category: 'structural' | 'coverage' | 'config' | 'operational';
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  file?: string;
  directory?: string;
  line?: number;
  suggestion?: string;
  driftCorrelation?: DriftCorrelation;
}

export interface HygieneScore {
  overall: number;
  breakdown: {
    structural: number;
    coverage: number;
    config: number;
    operational: number;
  };
  trend: 'improving' | 'stable' | 'degrading';
  lastScan: string;
}

export interface HygieneSummary {
  totalFindings: number;
  bySeverity: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  byCategory: {
    structural: number;
    coverage: number;
    config: number;
    operational: number;
  };
}

export interface HygieneReportInput {
  projectId?: string;
  runLimit?: number;      // How many recent runs to analyze (default: 50)
  correlateWithDrift?: boolean; // Default: true
}

export interface HygieneReportResult {
  score: HygieneScore;
  findings: HygieneFinding[];
  hotspots: HygieneHotspot[];
  summary: HygieneSummary;
  projectPath: string;
  projectId?: string;
  runsAnalyzed: number;
  scanDuration: number;
}

// ============================================================================
// Run Analysis Types
// ============================================================================

interface VectorEvent {
  ts: string;
  run_id: string;
  type: string;
  payload?: Record<string, unknown>;
}

interface RunAnalysis {
  runId: string;
  success: boolean;
  filesTouched: string[];
  hasBacktracks: boolean;
  hasErrors: boolean;
  hasCorrections: boolean;
}

// ============================================================================
// Run History Analysis
// ============================================================================

function parseEventsFile(eventsPath: string): VectorEvent[] {
  try {
    const content = fs.readFileSync(eventsPath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    return lines.map(line => JSON.parse(line) as VectorEvent);
  } catch {
    return [];
  }
}

function analyzeRun(runDir: string): RunAnalysis | null {
  const eventsPath = path.join(runDir, 'events.jsonl');
  if (!fs.existsSync(eventsPath)) return null;

  const events = parseEventsFile(eventsPath);
  if (events.length === 0) return null;

  const runId = path.basename(runDir);
  const filesTouched: Set<string> = new Set();
  let hasBacktracks = false;
  let hasErrors = false;
  let hasCorrections = false;
  let success = true; // Assume success unless we find otherwise

  for (const event of events) {
    switch (event.type) {
      case 'file_touched':
        if (event.payload?.file) {
          filesTouched.add(String(event.payload.file));
        }
        if (event.payload?.path) {
          filesTouched.add(String(event.payload.path));
        }
        break;
      case 'backtrack':
        hasBacktracks = true;
        break;
      case 'error':
        hasErrors = true;
        break;
      case 'user_correction':
        hasCorrections = true;
        break;
      case 'run_completed':
        success = event.payload?.success !== false;
        break;
    }
  }

  return {
    runId,
    success,
    filesTouched: Array.from(filesTouched),
    hasBacktracks,
    hasErrors,
    hasCorrections,
  };
}

function loadRunHistory(runsDir: string, limit: number): RunAnalysis[] {
  const runs: RunAnalysis[] = [];

  if (!fs.existsSync(runsDir)) {
    return runs;
  }

  try {
    const entries = fs.readdirSync(runsDir, { withFileTypes: true });
    const runDirs = entries
      .filter(e => e.isDirectory() && e.name.startsWith('RUN-'))
      .map(e => e.name)
      .sort()
      .reverse() // Most recent first
      .slice(0, limit);

    for (const runId of runDirs) {
      const runDir = path.join(runsDir, runId);
      const analysis = analyzeRun(runDir);
      if (analysis) {
        runs.push(analysis);
      }
    }
  } catch {
    // Directory not readable
  }

  return runs;
}

// ============================================================================
// Drift Correlation
// ============================================================================

interface FileStats {
  totalRuns: number;
  failedRuns: number;
  runsWithBacktracks: number;
  runsWithErrors: number;
  runsWithCorrections: number;
}

function calculateFileStats(runs: RunAnalysis[]): Map<string, FileStats> {
  const stats = new Map<string, FileStats>();

  for (const run of runs) {
    for (const file of run.filesTouched) {
      if (!stats.has(file)) {
        stats.set(file, {
          totalRuns: 0,
          failedRuns: 0,
          runsWithBacktracks: 0,
          runsWithErrors: 0,
          runsWithCorrections: 0,
        });
      }

      const fileStats = stats.get(file)!;
      fileStats.totalRuns++;

      if (!run.success) fileStats.failedRuns++;
      if (run.hasBacktracks) fileStats.runsWithBacktracks++;
      if (run.hasErrors) fileStats.runsWithErrors++;
      if (run.hasCorrections) fileStats.runsWithCorrections++;
    }
  }

  return stats;
}

function calculateDriftCorrelation(file: string, stats: Map<string, FileStats>): DriftCorrelation | undefined {
  const fileStats = stats.get(file);
  if (!fileStats || fileStats.totalRuns === 0) {
    return undefined;
  }

  // Calculate correlation score based on multiple factors
  const failureRate = fileStats.failedRuns / fileStats.totalRuns;
  const backtrackRate = fileStats.runsWithBacktracks / fileStats.totalRuns;
  const errorRate = fileStats.runsWithErrors / fileStats.totalRuns;
  const correctionRate = fileStats.runsWithCorrections / fileStats.totalRuns;

  // Weighted correlation score
  const correlationScore = Math.min(1,
    (failureRate * 0.4) +
    (backtrackRate * 0.3) +
    (errorRate * 0.2) +
    (correctionRate * 0.1)
  );

  // Generate insight
  let insight: string | undefined;
  if (failureRate > 0.5) {
    insight = `This file appears in ${Math.round(failureRate * 100)}% of failed runs`;
  } else if (backtrackRate > 0.5) {
    insight = `Agents backtrack in ${Math.round(backtrackRate * 100)}% of sessions touching this file`;
  } else if (correlationScore > 0.3) {
    insight = `This file correlates with agent struggles (${Math.round(correlationScore * 100)}% correlation)`;
  }

  return {
    appearsInFailedRuns: fileStats.failedRuns,
    totalRunsWithFile: fileStats.totalRuns,
    correlationScore,
    insight,
  };
}

// ============================================================================
// Hotspot Generation
// ============================================================================

function generateHotspots(
  findings: HygieneFinding[],
  fileStats: Map<string, FileStats>,
  totalRuns: number
): HygieneHotspot[] {
  // Group findings by file
  const fileFindings = new Map<string, HygieneFinding[]>();

  for (const finding of findings) {
    const file = finding.file || finding.directory;
    if (!file) continue;

    if (!fileFindings.has(file)) {
      fileFindings.set(file, []);
    }
    fileFindings.get(file)!.push(finding);
  }

  const hotspots: HygieneHotspot[] = [];

  for (const [file, fileFindingsList] of fileFindings) {
    const stats = fileStats.get(file);
    const driftFrequency = stats
      ? (stats.failedRuns + stats.runsWithBacktracks) / Math.max(1, stats.totalRuns)
      : 0;

    // Priority = findings severity + drift frequency
    const severityScore = fileFindingsList.reduce((sum, f) => {
      switch (f.severity) {
        case 'critical': return sum + 4;
        case 'high': return sum + 3;
        case 'medium': return sum + 2;
        case 'low': return sum + 1;
        default: return sum;
      }
    }, 0);

    const priority = (severityScore / 4) + (driftFrequency * 10);

    hotspots.push({
      file,
      findingCount: fileFindingsList.length,
      driftFrequency,
      priority,
      topFindings: fileFindingsList
        .sort((a, b) => {
          const sevOrder = { critical: 0, high: 1, medium: 2, low: 3 };
          return sevOrder[a.severity] - sevOrder[b.severity];
        })
        .slice(0, 3)
        .map(f => f.title),
    });
  }

  // Sort by priority (descending)
  return hotspots.sort((a, b) => b.priority - a.priority).slice(0, 20);
}

// ============================================================================
// Main Report Generator
// ============================================================================

export async function generateHygieneReport(input: HygieneReportInput): Promise<HygieneReportResult> {
  const startTime = Date.now();

  // Resolve project
  const resolved = resolveProjectPaths(input.projectId);

  const projectPath = resolved.projectPath;
  const runLimit = input.runLimit || 50;
  const correlate = input.correlateWithDrift !== false;

  // Run all scanners
  const [codebaseResult, coverageResult, configResult] = await Promise.all([
    scanCodebase({ projectPath }),
    scanCoverage({ projectPath }),
    scanConfig({ projectPath }),
  ]);

  // Load run history for correlation
  const runsDir = resolved.subPath('runs');
  const runs = correlate ? loadRunHistory(runsDir, runLimit) : [];
  const fileStats = correlate ? calculateFileStats(runs) : new Map();

  // Combine and enrich findings
  const allFindings: HygieneFinding[] = [];

  // Add codebase findings
  for (const f of codebaseResult.findings) {
    const finding: HygieneFinding = {
      id: f.id,
      category: 'structural',
      severity: f.severity,
      title: f.title,
      description: f.description,
      file: f.file,
      line: f.line,
      suggestion: f.suggestion,
    };

    if (correlate && f.file) {
      finding.driftCorrelation = calculateDriftCorrelation(f.file, fileStats);
    }

    allFindings.push(finding);
  }

  // Add coverage findings
  for (const f of coverageResult.findings) {
    const finding: HygieneFinding = {
      id: f.id,
      category: 'coverage',
      severity: f.severity,
      title: f.title,
      description: f.description,
      directory: f.directory,
      suggestion: f.suggestion,
    };

    allFindings.push(finding);
  }

  // Add config findings
  for (const f of configResult.findings) {
    const finding: HygieneFinding = {
      id: f.id,
      category: 'config',
      severity: f.severity,
      title: f.title,
      description: f.description,
      file: f.file,
      line: f.line,
      suggestion: f.suggestion,
    };

    if (correlate && f.file) {
      finding.driftCorrelation = calculateDriftCorrelation(f.file, fileStats);
    }

    allFindings.push(finding);
  }

  // Generate hotspots
  const hotspots = generateHotspots(allFindings, fileStats, runs.length);

  // Calculate combined score
  const structuralScore = codebaseResult.score;
  const coverageScore = coverageResult.score;
  const configScore = configResult.score;
  const operationalScore = 100; // TODO: Implement operational scanning

  const overallScore = Math.round(
    (structuralScore * 0.35) +
    (coverageScore * 0.25) +
    (configScore * 0.25) +
    (operationalScore * 0.15)
  );

  // Calculate summary
  const summary: HygieneSummary = {
    totalFindings: allFindings.length,
    bySeverity: {
      critical: allFindings.filter(f => f.severity === 'critical').length,
      high: allFindings.filter(f => f.severity === 'high').length,
      medium: allFindings.filter(f => f.severity === 'medium').length,
      low: allFindings.filter(f => f.severity === 'low').length,
    },
    byCategory: {
      structural: allFindings.filter(f => f.category === 'structural').length,
      coverage: allFindings.filter(f => f.category === 'coverage').length,
      config: allFindings.filter(f => f.category === 'config').length,
      operational: allFindings.filter(f => f.category === 'operational').length,
    },
  };

  return {
    score: {
      overall: overallScore,
      breakdown: {
        structural: structuralScore,
        coverage: coverageScore,
        config: configScore,
        operational: operationalScore,
      },
      trend: 'stable', // TODO: Implement trend calculation from historical data
      lastScan: new Date().toISOString(),
    },
    findings: allFindings,
    hotspots,
    summary,
    projectPath,
    projectId: input.projectId,
    runsAnalyzed: runs.length,
    scanDuration: Date.now() - startTime,
  };
}
