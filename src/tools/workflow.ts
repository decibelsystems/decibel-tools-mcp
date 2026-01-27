// ============================================================================
// Workflow Domain Tools
// ============================================================================
// High-level workflow tools that chain existing Decibel tools.
// These are the primary interface for AI assistants.
// ============================================================================

import path from 'path';
import { resolveProjectPaths, ResolvedProjectPaths } from '../projectRegistry.js';
import { listRepoIssues, listEpics } from './sentinel.js';
import { getRoadmapHealth } from './roadmap.js';
import { listFriction } from './friction.js';
import { nextActions } from './oracle.js';
import { listLearnings } from './learnings.js';
import { scanData } from './sentinel-scan-data.js';
import { auditorTriage, auditorLogHealth, auditorHealthHistory, isAuditorError } from './auditor.js';
import {
  gitLogRecent,
  gitStatus,
  isGitErrorResult,
  GitCommit,
} from './git.js';

// ============================================================================
// Types
// ============================================================================

export interface WorkflowStatusInput {
  projectId?: string;
}

export interface WorkflowStatusOutput {
  project: string;
  timestamp: string;
  git: {
    branch: string;
    hasChanges: boolean;
    ahead: number;
    behind: number;
  };
  issues: {
    open: number;
    inProgress: number;
    blocked: number;
    recentlyUpdated: Array<{ id: string; title: string; status: string }>;
  };
  health: {
    score: number;
    atRisk: string[];
    behind: string[];
  };
  friction: {
    total: number;
    topBySignal: Array<{ context: string; signal: number }>;
  };
  codeQuality?: {
    godFiles: number;
    highSeverity: number;
    mediumSeverity: number;
  };
  recommendations: string[];
}

export interface WorkflowPreflightInput {
  projectId?: string;
  strict?: boolean;  // Fail on warnings (default: false)
}

export interface WorkflowPreflightOutput {
  passed: boolean;
  timestamp: string;
  checks: Array<{
    name: string;
    status: 'pass' | 'warn' | 'fail';
    message: string;
    details?: string[];
  }>;
  summary: string;
  healthSnapshot?: {
    logged: boolean;
    reason: string;  // "recorded" | "skipped (recent)" | "skipped (error)"
  };
}

export interface WorkflowShipInput {
  projectId?: string;
  dryRun?: boolean;
}

export interface WorkflowShipOutput {
  ready: boolean;
  timestamp: string;
  blockers: string[];
  warnings: string[];
  checklist: Array<{
    item: string;
    status: 'done' | 'pending' | 'blocked';
  }>;
  nextSteps: string[];
  healthSnapshot?: {
    logged: boolean;
    reason: string;
  };
}

export interface WorkflowInvestigateInput {
  projectId?: string;
  context?: string;  // What broke? Optional hint
}

export interface WorkflowInvestigateOutput {
  timestamp: string;
  recentCommits: GitCommit[];
  recentIssues: Array<{ id: string; title: string; status: string; updated: string }>;
  relatedFriction: Array<{ context: string; description: string }>;
  recentLearnings: Array<{ date: string; content: string }>;
  suggestions: string[];
}

export interface WorkflowError {
  error: string;
  details?: string;
}

// ============================================================================
// Helpers
// ============================================================================

function makeError(message: string, details?: string): WorkflowError {
  return { error: message, details };
}

function isError<T>(result: T | WorkflowError): result is WorkflowError {
  return typeof result === 'object' && result !== null && 'error' in result;
}

// Minimum interval between automatic health snapshots (4 hours in ms)
const HEALTH_SNAPSHOT_MIN_INTERVAL_MS = 4 * 60 * 60 * 1000;

/**
 * Check if enough time has passed since the last health snapshot.
 * Returns true if a new snapshot should be taken.
 */
async function shouldLogHealthSnapshot(projectId?: string): Promise<boolean> {
  try {
    const historyResult = await auditorHealthHistory({ projectId, limit: 1 });
    if ('error' in historyResult) {
      // No history exists, should create first snapshot
      return true;
    }

    if (historyResult.entries.length === 0) {
      return true;
    }

    const lastTimestamp = new Date(historyResult.entries[historyResult.entries.length - 1].timestamp);
    const now = new Date();
    const elapsed = now.getTime() - lastTimestamp.getTime();

    return elapsed >= HEALTH_SNAPSHOT_MIN_INTERVAL_MS;
  } catch {
    // If we can't check, don't log (fail safe)
    return false;
  }
}

// ============================================================================
// workflow_status
// ============================================================================

export async function workflowStatus(
  input: WorkflowStatusInput
): Promise<WorkflowStatusOutput | WorkflowError> {
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.projectId);
  } catch {
    return makeError('Failed to resolve project path');
  }

  const timestamp = new Date().toISOString();
  const projectId = resolved.id || path.basename(resolved.projectPath);

  // Git status
  const gitResult = await gitStatus({ projectId: input.projectId });
  const git = isGitErrorResult(gitResult)
    ? { branch: 'unknown', hasChanges: false, ahead: 0, behind: 0 }
    : {
        branch: gitResult.branch,
        hasChanges: gitResult.hasChanges,
        ahead: gitResult.ahead,
        behind: gitResult.behind,
      };

  // Issues
  const issuesResult = await listRepoIssues({ projectId: input.projectId });
  const issues = {
    open: 0,
    inProgress: 0,
    blocked: 0,
    recentlyUpdated: [] as Array<{ id: string; title: string; status: string }>,
  };

  if (!('error' in issuesResult)) {
    for (const issue of issuesResult.issues) {
      if (issue.status === 'open') issues.open++;
      if (issue.status === 'in_progress') issues.inProgress++;
      if (issue.status === 'blocked') issues.blocked++;
    }
    issues.recentlyUpdated = issuesResult.issues
      .slice(0, 5)
      .map(i => ({ id: i.id, title: i.title, status: i.status }));
  }

  // Health
  const healthResult = await getRoadmapHealth({ projectId: input.projectId || projectId });
  const health = {
    score: 0,
    atRisk: [] as string[],
    behind: [] as string[],
  };

  if (!('error' in healthResult) && healthResult.epics) {
    const epics = healthResult.epics as Array<{ health_score?: number; epic_id: string }>;
    const scores = epics
      .filter((e) => e.health_score !== undefined)
      .map((e) => e.health_score as number);
    health.score = scores.length > 0
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      : 100;
    health.atRisk = epics
      .filter((e) => e.health_score !== undefined && e.health_score < 70)
      .map((e) => e.epic_id);
  }

  // Friction
  const frictionResult = await listFriction({ projectId: input.projectId });
  const friction = {
    total: 0,
    topBySignal: [] as Array<{ context: string; signal: number }>,
  };

  if (!('error' in frictionResult)) {
    friction.total = frictionResult.friction.length;
    friction.topBySignal = frictionResult.friction
      .sort((a, b) => (b.signal_count || 0) - (a.signal_count || 0))
      .slice(0, 3)
      .map(f => ({ context: f.context, signal: f.signal_count || 1 }));
  }

  // Code Quality (via Auditor)
  let codeQuality: WorkflowStatusOutput['codeQuality'];
  const auditResult = await auditorTriage({ projectId: input.projectId });
  if (!isAuditorError(auditResult)) {
    codeQuality = {
      godFiles: auditResult.issues.filter(i => i.smell === 'god_file').length,
      highSeverity: auditResult.summary.high,
      mediumSeverity: auditResult.summary.medium,
    };
  }

  // Recommendations
  const oracleResult = await nextActions({ projectId: input.projectId });
  const recommendations = !('error' in oracleResult)
    ? oracleResult.actions.slice(0, 3).map(a => a.description)
    : [];

  return {
    project: projectId,
    timestamp,
    git,
    issues,
    health,
    friction,
    codeQuality,
    recommendations,
  };
}

// ============================================================================
// workflow_preflight
// ============================================================================

export async function workflowPreflight(
  input: WorkflowPreflightInput
): Promise<WorkflowPreflightOutput | WorkflowError> {
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.projectId);
  } catch {
    return makeError('Failed to resolve project path');
  }

  const timestamp = new Date().toISOString();
  const checks: WorkflowPreflightOutput['checks'] = [];
  const strict = input.strict ?? false;

  // Check 1: Git status (uncommitted changes)
  const gitResult = await gitStatus({ projectId: input.projectId });
  if (isGitErrorResult(gitResult)) {
    checks.push({
      name: 'Git Status',
      status: 'warn',
      message: 'Could not check git status',
    });
  } else if (gitResult.hasChanges) {
    checks.push({
      name: 'Git Status',
      status: 'warn',
      message: `Uncommitted changes: ${gitResult.staged} staged, ${gitResult.modified} modified, ${gitResult.untracked} untracked`,
    });
  } else {
    checks.push({
      name: 'Git Status',
      status: 'pass',
      message: 'Working directory clean',
    });
  }

  // Check 2: Sentinel scan
  const scanResult = await scanData({
    projectId: input.projectId || resolved.id,
    flags: ['orphans', 'stale', 'invalid'],
  });

  if ('error' in scanResult) {
    checks.push({
      name: 'Data Validation',
      status: 'warn',
      message: 'Could not run sentinel scan',
    });
  } else {
    const orphanCount = (scanResult.orphans?.epics?.length || 0) + (scanResult.orphans?.issues?.length || 0);
    const staleCount = (scanResult.stale?.epics?.length || 0) + (scanResult.stale?.issues?.length || 0);
    const hasIssues = orphanCount > 0 || staleCount > 0;
    checks.push({
      name: 'Data Validation',
      status: hasIssues ? 'warn' : 'pass',
      message: hasIssues
        ? `Found ${orphanCount} orphans, ${staleCount} stale items`
        : 'All data validated',
      details: [
        ...(scanResult.orphans?.epics || []).map((o: string) => `Orphan epic: ${o}`),
        ...(scanResult.orphans?.issues || []).map((o: string) => `Orphan issue: ${o}`),
        ...(scanResult.stale?.epics || []).map((s: string) => `Stale epic: ${s}`),
        ...(scanResult.stale?.issues || []).map((s: string) => `Stale issue: ${s}`),
      ],
    });
  }

  // Check 3: Code Quality (via Auditor)
  const auditResult = await auditorTriage({ projectId: input.projectId });

  if (isAuditorError(auditResult)) {
    checks.push({
      name: 'Code Quality',
      status: 'warn',
      message: 'Could not run code audit',
    });
  } else {
    const godFiles = auditResult.issues.filter(i => i.smell === 'god_file');
    const highSeverity = auditResult.summary.high;

    if (highSeverity > 0) {
      checks.push({
        name: 'Code Quality',
        status: 'warn',
        message: `${highSeverity} high-severity code issues`,
        details: auditResult.issues
          .filter(i => i.severity === 'high')
          .slice(0, 5)
          .map(i => `${i.file}: ${i.message}`),
      });
    } else if (godFiles.length > 0) {
      checks.push({
        name: 'Code Quality',
        status: 'warn',
        message: `${godFiles.length} files over 400 lines`,
        details: godFiles.slice(0, 5).map(i => i.file),
      });
    } else {
      checks.push({
        name: 'Code Quality',
        status: 'pass',
        message: 'No major code quality issues',
      });
    }
  }

  // Check 4: Blocked issues
  const issuesResult = await listRepoIssues({ projectId: input.projectId, status: 'blocked' as any });
  const blockedCount = !('error' in issuesResult) ? issuesResult.issues.length : 0;

  checks.push({
    name: 'Blocked Issues',
    status: blockedCount > 0 ? 'warn' : 'pass',
    message: blockedCount > 0
      ? `${blockedCount} blocked issues`
      : 'No blocked issues',
  });

  // Calculate overall status
  const hasFail = checks.some(c => c.status === 'fail');
  const hasWarn = checks.some(c => c.status === 'warn');
  const passed = !hasFail && (!strict || !hasWarn);

  // Automatic health snapshot (if enough time has passed)
  let healthSnapshot: WorkflowPreflightOutput['healthSnapshot'];
  try {
    const shouldLog = await shouldLogHealthSnapshot(input.projectId);
    if (shouldLog) {
      const logResult = await auditorLogHealth({ projectId: input.projectId });
      if ('error' in logResult) {
        healthSnapshot = { logged: false, reason: `skipped (${logResult.error})` };
      } else {
        healthSnapshot = { logged: true, reason: 'recorded' };
      }
    } else {
      healthSnapshot = { logged: false, reason: 'skipped (recent snapshot exists)' };
    }
  } catch {
    healthSnapshot = { logged: false, reason: 'skipped (error)' };
  }

  return {
    passed,
    timestamp,
    checks,
    summary: passed
      ? 'All checks passed'
      : hasFail
        ? 'Preflight failed - fix issues before committing'
        : 'Preflight passed with warnings',
    healthSnapshot,
  };
}

// ============================================================================
// workflow_ship
// ============================================================================

export async function workflowShip(
  input: WorkflowShipInput
): Promise<WorkflowShipOutput | WorkflowError> {
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.projectId);
  } catch {
    return makeError('Failed to resolve project path');
  }

  const timestamp = new Date().toISOString();
  const blockers: string[] = [];
  const warnings: string[] = [];
  const checklist: WorkflowShipOutput['checklist'] = [];

  // Run preflight first
  const preflightResult = await workflowPreflight({ projectId: input.projectId, strict: true });

  if (isError(preflightResult)) {
    blockers.push('Preflight check failed to run');
  } else {
    for (const check of preflightResult.checks) {
      if (check.status === 'fail') {
        blockers.push(`${check.name}: ${check.message}`);
      } else if (check.status === 'warn') {
        warnings.push(`${check.name}: ${check.message}`);
      }
    }
    checklist.push({
      item: 'Preflight checks',
      status: preflightResult.passed ? 'done' : 'blocked',
    });
  }

  // Check roadmap health
  const healthResult = await getRoadmapHealth({ projectId: input.projectId || resolved.id });
  if (!('error' in healthResult)) {
    const epics = (healthResult.epics || []) as Array<{ health_score?: number }>;
    const unhealthy = epics.filter(
      (e) => e.health_score !== undefined && e.health_score < 50
    );

    if (unhealthy.length > 0) {
      warnings.push(`${unhealthy.length} epics with health < 50%`);
    }
    checklist.push({
      item: 'Roadmap health review',
      status: unhealthy.length === 0 ? 'done' : 'pending',
    });
  }

  // Check for open blockers
  const issuesResult = await listRepoIssues({ projectId: input.projectId, status: 'blocked' as any });
  if (!('error' in issuesResult) && issuesResult.issues.length > 0) {
    blockers.push(`${issuesResult.issues.length} blocked issues must be resolved`);
    checklist.push({
      item: 'Resolve blocked issues',
      status: 'blocked',
    });
  } else {
    checklist.push({
      item: 'No blocked issues',
      status: 'done',
    });
  }

  // Git status
  const gitResult = await gitStatus({ projectId: input.projectId });
  if (!isGitErrorResult(gitResult)) {
    if (gitResult.hasChanges) {
      warnings.push('Uncommitted changes in working directory');
      checklist.push({
        item: 'Commit all changes',
        status: 'pending',
      });
    } else {
      checklist.push({
        item: 'All changes committed',
        status: 'done',
      });
    }

    if (gitResult.ahead > 0) {
      checklist.push({
        item: `Push ${gitResult.ahead} commit(s)`,
        status: 'pending',
      });
    }
  }

  const ready = blockers.length === 0;
  const nextSteps: string[] = [];

  if (ready) {
    nextSteps.push('Run final tests: npm test');
    nextSteps.push('Create release tag: git tag -a vX.Y.Z -m "Release X.Y.Z"');
    nextSteps.push('Push with tags: git push origin main --tags');
  } else {
    nextSteps.push('Fix blockers before shipping');
    for (const blocker of blockers) {
      nextSteps.push(`→ ${blocker}`);
    }
  }

  // Automatic health snapshot on ship (always log if ready, respects interval otherwise)
  let healthSnapshot: WorkflowShipOutput['healthSnapshot'];
  try {
    // For ship, we always log if ready (this is a significant milestone)
    // Otherwise, respect the minimum interval
    const shouldLog = ready || await shouldLogHealthSnapshot(input.projectId);
    if (shouldLog) {
      const logResult = await auditorLogHealth({ projectId: input.projectId });
      if ('error' in logResult) {
        healthSnapshot = { logged: false, reason: `skipped (${logResult.error})` };
      } else {
        healthSnapshot = { logged: true, reason: ready ? 'recorded (ship milestone)' : 'recorded' };
      }
    } else {
      healthSnapshot = { logged: false, reason: 'skipped (recent snapshot exists)' };
    }
  } catch {
    healthSnapshot = { logged: false, reason: 'skipped (error)' };
  }

  return {
    ready,
    timestamp,
    blockers,
    warnings,
    checklist,
    nextSteps,
    healthSnapshot,
  };
}

// ============================================================================
// workflow_investigate
// ============================================================================

export async function workflowInvestigate(
  input: WorkflowInvestigateInput
): Promise<WorkflowInvestigateOutput | WorkflowError> {
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.projectId);
  } catch {
    return makeError('Failed to resolve project path');
  }

  const timestamp = new Date().toISOString();

  // Recent commits
  const gitLogResult = await gitLogRecent({
    projectId: input.projectId,
    count: 15,
    grep: input.context,  // If context provided, search commit messages
  });

  const recentCommits = isGitErrorResult(gitLogResult)
    ? []
    : gitLogResult.commits;

  // Recent issues (IssueSummary doesn't have timestamps, so just take first 10)
  const issuesResult = await listRepoIssues({ projectId: input.projectId });
  const recentIssues = ('error' in issuesResult)
    ? []
    : issuesResult.issues
        .slice(0, 10)
        .map(i => ({
          id: i.id,
          title: i.title,
          status: i.status,
          updated: '',  // Not available in IssueSummary
        }));

  // Related friction
  const frictionResult = await listFriction({ projectId: input.projectId });
  const relatedFriction = ('error' in frictionResult)
    ? []
    : frictionResult.friction
        .filter(f => !input.context ||
          f.context.toLowerCase().includes(input.context.toLowerCase()) ||
          f.description.toLowerCase().includes(input.context.toLowerCase()))
        .slice(0, 5)
        .map(f => ({ context: f.context, description: f.description }));

  // Recent learnings
  const learningsResult = await listLearnings({ projectId: input.projectId });
  const recentLearnings = ('error' in learningsResult)
    ? []
    : (learningsResult.entries || [])
        .slice(0, 5)
        .map((l: { timestamp?: string; title?: string; content?: string }) => ({
          date: l.timestamp || '',
          content: l.title || l.content || '',
        }));

  // Generate suggestions based on findings
  const suggestions: string[] = [];

  if (recentCommits.length > 0) {
    suggestions.push(`Review recent commits - last change: "${recentCommits[0].message}"`);
  }

  if (relatedFriction.length > 0) {
    suggestions.push(`Check friction points - ${relatedFriction.length} related issues found`);
  }

  if (recentIssues.some(i => i.status === 'blocked')) {
    suggestions.push('Blocked issues may be related to the problem');
  }

  suggestions.push('Use git_find_removal to search for removed code');
  suggestions.push('Use git_blame_context to check recent changes to specific files');

  return {
    timestamp,
    recentCommits,
    recentIssues,
    relatedFriction,
    recentLearnings,
    suggestions,
  };
}

// ============================================================================
// Exports
// ============================================================================

export function isWorkflowError(result: unknown): result is WorkflowError {
  return typeof result === 'object' && result !== null && 'error' in result;
}
