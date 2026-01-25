// ============================================================================
// Velocity Domain Logic
// ============================================================================
// Velocity tracking captures contributor metrics across time periods.
// Aggregates data from git commits (with line counts) and Sentinel issues.
// DOJO-PROP-0006 Implementation
// ============================================================================

import fs from 'fs/promises';
import path from 'path';
import { log } from '../config.js';
import { ensureDir } from '../dataRoot.js';
import { resolveProjectPaths, validateWritePath, ResolvedProjectPaths } from '../projectRegistry.js';
import { gitLogWithStats, isGitErrorResult, GitCommitWithStats } from './git.js';
import { emitCreateProvenance } from './provenance.js';
import YAML from 'yaml';

// ============================================================================
// Types
// ============================================================================

export type VelocityPeriod = 'daily' | 'weekly' | 'quarterly';

export interface ContributorMetrics {
  id: string;
  commits: number;
  linesAdded: number;
  linesDeleted: number;
  issuesClosed: number;
  issuesOpened: number;
}

export interface VelocitySnapshot {
  period: VelocityPeriod;
  date: string;
  range: {
    start: string;
    end: string;
  };
  contributors: ContributorMetrics[];
  projectTotals: {
    commits: number;
    linesAdded: number;
    linesDeleted: number;
    issuesClosed: number;
    issuesOpened: number;
  };
  capturedAt: string;
}

export interface VelocitySnapshotInput {
  projectId?: string;
  period: VelocityPeriod;
  referenceDate?: string;  // ISO date, defaults to now
}

export interface VelocitySnapshotOutput {
  snapshotId: string;
  path: string;
  period: VelocityPeriod;
  date: string;
  range: { start: string; end: string };
  contributorCount: number;
  totals: {
    commits: number;
    linesAdded: number;
    linesDeleted: number;
  };
}

export interface VelocityListInput {
  projectId?: string;
  period?: VelocityPeriod;
  limit?: number;
}

export interface VelocityListOutput {
  snapshots: Array<{
    id: string;
    period: VelocityPeriod;
    date: string;
    contributorCount: number;
    commits: number;
    linesAdded: number;
    linesDeleted: number;
  }>;
  total: number;
}

export interface VelocityTrend {
  metric: string;
  direction: 'up' | 'down' | 'stable';
  changePercent: number;
  current: number;
  previous: number;
}

export interface VelocityTrendsInput {
  projectId?: string;
  period: VelocityPeriod;
  metric?: 'commits' | 'lines' | 'issues';
}

export interface VelocityTrendsOutput {
  period: VelocityPeriod;
  trends: VelocityTrend[];
  comparedSnapshots: {
    current: string;
    previous: string;
  } | null;
}

export interface VelocityContributorInput {
  projectId?: string;
  contributorId: string;
  period?: VelocityPeriod;
  limit?: number;
}

export interface VelocityContributorOutput {
  contributorId: string;
  snapshots: Array<{
    date: string;
    period: VelocityPeriod;
    commits: number;
    linesAdded: number;
    linesDeleted: number;
    issuesClosed: number;
    issuesOpened: number;
  }>;
  totals: {
    commits: number;
    linesAdded: number;
    linesDeleted: number;
    issuesClosed: number;
    issuesOpened: number;
  };
}

export interface VelocityError {
  error: string;
  message: string;
  hint?: string;
}

// ============================================================================
// Helpers
// ============================================================================

function makeProjectResolutionError(operation: string): VelocityError {
  return {
    error: 'project_resolution_failed',
    message: `Cannot ${operation}: No project context available.`,
    hint: 'Either specify projectId parameter, set DECIBEL_PROJECT_ROOT env var, or run from a directory containing .decibel/',
  };
}

function makeError(error: string, message: string, hint?: string): VelocityError {
  return { error, message, hint };
}

/**
 * Calculate the date range for a given period.
 */
function getDateRange(period: VelocityPeriod, referenceDate?: Date): { start: Date; end: Date } {
  const ref = referenceDate || new Date();

  switch (period) {
    case 'daily': {
      const start = new Date(ref);
      start.setHours(0, 0, 0, 0);
      const end = new Date(ref);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }
    case 'weekly': {
      // Week starts on Monday
      const dayOfWeek = ref.getDay();
      const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      const start = new Date(ref);
      start.setDate(ref.getDate() - daysToMonday);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }
    case 'quarterly': {
      const quarter = Math.floor(ref.getMonth() / 3);
      const start = new Date(ref.getFullYear(), quarter * 3, 1, 0, 0, 0, 0);
      const end = new Date(ref.getFullYear(), quarter * 3 + 3, 0, 23, 59, 59, 999);
      return { start, end };
    }
  }
}

/**
 * Format a date for snapshot filename.
 */
function formatDateForFilename(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Build contributor ID from git commit info.
 */
function buildContributorId(author: string, email: string): string {
  if (email) {
    return `human:${author} <${email}>`;
  }
  return `human:${author}`;
}

/**
 * Parse a snapshot YAML file.
 */
async function parseSnapshotFile(filePath: string): Promise<VelocitySnapshot | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const data = YAML.parse(content);
    if (!data.period || !data.date) return null;
    return data as VelocitySnapshot;
  } catch {
    return null;
  }
}

/**
 * Get sentinel issues for a date range (simplified - reads issue files).
 */
async function getIssuesInRange(
  resolved: ResolvedProjectPaths,
  start: Date,
  end: Date
): Promise<{ opened: Map<string, number>; closed: Map<string, number> }> {
  const opened = new Map<string, number>();
  const closed = new Map<string, number>();

  const issuesDir = resolved.subPath('sentinel', 'issues');

  try {
    const files = await fs.readdir(issuesDir);
    for (const file of files) {
      if (!file.endsWith('.yml') && !file.endsWith('.yaml')) continue;

      const filePath = path.join(issuesDir, file);
      const content = await fs.readFile(filePath, 'utf-8');
      const data = YAML.parse(content);

      // Check created_at for opened issues
      if (data.created_at) {
        const createdDate = new Date(data.created_at);
        if (createdDate >= start && createdDate <= end) {
          // Default to unknown contributor if not specified
          const creator = data.creator || 'unknown';
          opened.set(creator, (opened.get(creator) || 0) + 1);
        }
      }

      // Check closed_at for closed issues
      if (data.closed_at && data.status === 'done') {
        const closedDate = new Date(data.closed_at);
        if (closedDate >= start && closedDate <= end) {
          const closer = data.assignee || data.creator || 'unknown';
          closed.set(closer, (closed.get(closer) || 0) + 1);
        }
      }
    }
  } catch {
    // Issues directory might not exist
  }

  return { opened, closed };
}

// ============================================================================
// velocity_snapshot - Capture a velocity snapshot
// ============================================================================

export async function captureSnapshot(
  input: VelocitySnapshotInput
): Promise<VelocitySnapshotOutput | VelocityError> {
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.projectId);
  } catch {
    return makeProjectResolutionError('capture velocity snapshot');
  }

  const refDate = input.referenceDate ? new Date(input.referenceDate) : new Date();
  const { start, end } = getDateRange(input.period, refDate);

  // Get git commits with stats
  const gitResult = await gitLogWithStats({
    projectId: input.projectId,
    since: start.toISOString(),
    until: end.toISOString(),
    count: 1000, // High limit to capture all in range
  });

  if (isGitErrorResult(gitResult)) {
    return makeError('git_error', `Failed to get git log: ${gitResult.error}`);
  }

  // Aggregate by contributor
  const contributorMap = new Map<string, ContributorMetrics>();

  for (const commit of gitResult.commits) {
    const id = buildContributorId(commit.author, commit.email);

    if (!contributorMap.has(id)) {
      contributorMap.set(id, {
        id,
        commits: 0,
        linesAdded: 0,
        linesDeleted: 0,
        issuesClosed: 0,
        issuesOpened: 0,
      });
    }

    const metrics = contributorMap.get(id)!;
    metrics.commits++;
    metrics.linesAdded += commit.linesAdded;
    metrics.linesDeleted += commit.linesDeleted;
  }

  // Get issue metrics
  const issueMetrics = await getIssuesInRange(resolved, start, end);

  // Merge issue metrics into contributor map
  for (const [creator, count] of issueMetrics.opened) {
    const id = creator.startsWith('human:') ? creator : `human:${creator}`;
    if (!contributorMap.has(id)) {
      contributorMap.set(id, {
        id,
        commits: 0,
        linesAdded: 0,
        linesDeleted: 0,
        issuesClosed: 0,
        issuesOpened: 0,
      });
    }
    contributorMap.get(id)!.issuesOpened += count;
  }

  for (const [closer, count] of issueMetrics.closed) {
    const id = closer.startsWith('human:') ? closer : `human:${closer}`;
    if (!contributorMap.has(id)) {
      contributorMap.set(id, {
        id,
        commits: 0,
        linesAdded: 0,
        linesDeleted: 0,
        issuesClosed: 0,
        issuesOpened: 0,
      });
    }
    contributorMap.get(id)!.issuesClosed += count;
  }

  const contributors = Array.from(contributorMap.values());

  // Calculate totals
  const projectTotals = {
    commits: contributors.reduce((sum, c) => sum + c.commits, 0),
    linesAdded: contributors.reduce((sum, c) => sum + c.linesAdded, 0),
    linesDeleted: contributors.reduce((sum, c) => sum + c.linesDeleted, 0),
    issuesClosed: contributors.reduce((sum, c) => sum + c.issuesClosed, 0),
    issuesOpened: contributors.reduce((sum, c) => sum + c.issuesOpened, 0),
  };

  const capturedAt = new Date().toISOString();
  const dateStr = formatDateForFilename(refDate);

  const snapshot: VelocitySnapshot = {
    period: input.period,
    date: dateStr,
    range: {
      start: start.toISOString(),
      end: end.toISOString(),
    },
    contributors,
    projectTotals,
    capturedAt,
  };

  // Save snapshot
  const snapshotsDir = resolved.subPath('velocity', 'snapshots');
  ensureDir(snapshotsDir);

  const filename = `${dateStr}-${input.period}.yml`;
  const filePath = path.join(snapshotsDir, filename);

  const yamlContent = YAML.stringify(snapshot, { lineWidth: 0 });
  validateWritePath(filePath, resolved);
  await fs.writeFile(filePath, yamlContent, 'utf-8');

  log(`Velocity: Captured ${input.period} snapshot at ${filePath}`);

  // Emit provenance
  await emitCreateProvenance(
    `velocity:snapshot:${filename.replace('.yml', '')}`,
    yamlContent,
    `Captured ${input.period} velocity snapshot for ${dateStr}`,
    input.projectId
  );

  return {
    snapshotId: filename.replace('.yml', ''),
    path: filePath,
    period: input.period,
    date: dateStr,
    range: { start: start.toISOString(), end: end.toISOString() },
    contributorCount: contributors.length,
    totals: {
      commits: projectTotals.commits,
      linesAdded: projectTotals.linesAdded,
      linesDeleted: projectTotals.linesDeleted,
    },
  };
}

// ============================================================================
// velocity_list - List snapshots
// ============================================================================

export async function listSnapshots(
  input: VelocityListInput
): Promise<VelocityListOutput | VelocityError> {
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.projectId);
  } catch {
    return makeProjectResolutionError('list velocity snapshots');
  }

  const snapshotsDir = resolved.subPath('velocity', 'snapshots');
  const limit = input.limit || 20;
  const snapshots: VelocityListOutput['snapshots'] = [];

  try {
    const files = await fs.readdir(snapshotsDir);
    const ymlFiles = files.filter(f => f.endsWith('.yml'));

    for (const file of ymlFiles) {
      const filePath = path.join(snapshotsDir, file);
      const snapshot = await parseSnapshotFile(filePath);
      if (!snapshot) continue;

      // Apply period filter
      if (input.period && snapshot.period !== input.period) continue;

      snapshots.push({
        id: file.replace('.yml', ''),
        period: snapshot.period,
        date: snapshot.date,
        contributorCount: snapshot.contributors.length,
        commits: snapshot.projectTotals.commits,
        linesAdded: snapshot.projectTotals.linesAdded,
        linesDeleted: snapshot.projectTotals.linesDeleted,
      });
    }
  } catch {
    // Directory might not exist yet
  }

  // Sort by date descending
  snapshots.sort((a, b) => b.date.localeCompare(a.date));

  return {
    snapshots: snapshots.slice(0, limit),
    total: snapshots.length,
  };
}

// ============================================================================
// velocity_trends - Calculate trends
// ============================================================================

export async function getTrends(
  input: VelocityTrendsInput
): Promise<VelocityTrendsOutput | VelocityError> {
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.projectId);
  } catch {
    return makeProjectResolutionError('get velocity trends');
  }

  const snapshotsDir = resolved.subPath('velocity', 'snapshots');
  const allSnapshots: Array<{ id: string; snapshot: VelocitySnapshot }> = [];

  try {
    const files = await fs.readdir(snapshotsDir);

    for (const file of files) {
      if (!file.endsWith('.yml')) continue;
      if (!file.includes(`-${input.period}`)) continue;

      const filePath = path.join(snapshotsDir, file);
      const snapshot = await parseSnapshotFile(filePath);
      if (snapshot) {
        allSnapshots.push({ id: file.replace('.yml', ''), snapshot });
      }
    }
  } catch {
    // Directory might not exist
  }

  if (allSnapshots.length < 2) {
    return {
      period: input.period,
      trends: [],
      comparedSnapshots: null,
    };
  }

  // Sort by date descending
  allSnapshots.sort((a, b) => b.snapshot.date.localeCompare(a.snapshot.date));

  const current = allSnapshots[0];
  const previous = allSnapshots[1];

  const STABLE_THRESHOLD = 5; // 5% change considered stable

  function calculateTrend(metricName: string, currentVal: number, previousVal: number): VelocityTrend {
    if (previousVal === 0) {
      return {
        metric: metricName,
        direction: currentVal > 0 ? 'up' : 'stable',
        changePercent: currentVal > 0 ? 100 : 0,
        current: currentVal,
        previous: previousVal,
      };
    }

    const changePercent = ((currentVal - previousVal) / previousVal) * 100;
    let direction: 'up' | 'down' | 'stable' = 'stable';

    if (changePercent > STABLE_THRESHOLD) direction = 'up';
    else if (changePercent < -STABLE_THRESHOLD) direction = 'down';

    return {
      metric: metricName,
      direction,
      changePercent: Math.round(changePercent * 10) / 10,
      current: currentVal,
      previous: previousVal,
    };
  }

  const trends: VelocityTrend[] = [];

  // Always include commits
  if (!input.metric || input.metric === 'commits') {
    trends.push(calculateTrend(
      'commits',
      current.snapshot.projectTotals.commits,
      previous.snapshot.projectTotals.commits
    ));
  }

  // Lines metrics
  if (!input.metric || input.metric === 'lines') {
    trends.push(calculateTrend(
      'linesAdded',
      current.snapshot.projectTotals.linesAdded,
      previous.snapshot.projectTotals.linesAdded
    ));
    trends.push(calculateTrend(
      'linesDeleted',
      current.snapshot.projectTotals.linesDeleted,
      previous.snapshot.projectTotals.linesDeleted
    ));
  }

  // Issues metrics
  if (!input.metric || input.metric === 'issues') {
    trends.push(calculateTrend(
      'issuesClosed',
      current.snapshot.projectTotals.issuesClosed,
      previous.snapshot.projectTotals.issuesClosed
    ));
    trends.push(calculateTrend(
      'issuesOpened',
      current.snapshot.projectTotals.issuesOpened,
      previous.snapshot.projectTotals.issuesOpened
    ));
  }

  return {
    period: input.period,
    trends,
    comparedSnapshots: {
      current: current.id,
      previous: previous.id,
    },
  };
}

// ============================================================================
// velocity_contributor - Individual contributor report
// ============================================================================

export async function getContributorReport(
  input: VelocityContributorInput
): Promise<VelocityContributorOutput | VelocityError> {
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.projectId);
  } catch {
    return makeProjectResolutionError('get contributor velocity report');
  }

  const snapshotsDir = resolved.subPath('velocity', 'snapshots');
  const limit = input.limit || 10;
  const snapshots: VelocityContributorOutput['snapshots'] = [];

  let totalCommits = 0;
  let totalLinesAdded = 0;
  let totalLinesDeleted = 0;
  let totalIssuesClosed = 0;
  let totalIssuesOpened = 0;

  try {
    const files = await fs.readdir(snapshotsDir);

    for (const file of files) {
      if (!file.endsWith('.yml')) continue;

      // Apply period filter
      if (input.period && !file.includes(`-${input.period}`)) continue;

      const filePath = path.join(snapshotsDir, file);
      const snapshot = await parseSnapshotFile(filePath);
      if (!snapshot) continue;

      // Find contributor in this snapshot
      const contributor = snapshot.contributors.find(c =>
        c.id === input.contributorId ||
        c.id.includes(input.contributorId)
      );

      if (contributor) {
        snapshots.push({
          date: snapshot.date,
          period: snapshot.period,
          commits: contributor.commits,
          linesAdded: contributor.linesAdded,
          linesDeleted: contributor.linesDeleted,
          issuesClosed: contributor.issuesClosed,
          issuesOpened: contributor.issuesOpened,
        });

        totalCommits += contributor.commits;
        totalLinesAdded += contributor.linesAdded;
        totalLinesDeleted += contributor.linesDeleted;
        totalIssuesClosed += contributor.issuesClosed;
        totalIssuesOpened += contributor.issuesOpened;
      }
    }
  } catch {
    // Directory might not exist
  }

  // Sort by date descending
  snapshots.sort((a, b) => b.date.localeCompare(a.date));

  return {
    contributorId: input.contributorId,
    snapshots: snapshots.slice(0, limit),
    totals: {
      commits: totalCommits,
      linesAdded: totalLinesAdded,
      linesDeleted: totalLinesDeleted,
      issuesClosed: totalIssuesClosed,
      issuesOpened: totalIssuesOpened,
    },
  };
}

// ============================================================================
// Type Guard
// ============================================================================

export function isVelocityError(result: unknown): result is VelocityError {
  return typeof result === 'object' && result !== null && 'error' in result && !('snapshots' in result) && !('snapshotId' in result);
}
