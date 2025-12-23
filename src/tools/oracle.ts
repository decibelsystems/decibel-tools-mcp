import fs from 'fs/promises';
import path from 'path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { log } from '../config.js';
import { resolveProjectPaths, ResolvedProjectPaths } from '../projectRegistry.js';

// ============================================================================
// Project Resolution Error
// ============================================================================

export interface OracleError {
  error: string;
  message: string;
  hint?: string;
}

function makeProjectError(operation: string): OracleError {
  return {
    error: 'PROJECT_NOT_FOUND',
    message: `Cannot ${operation}: No project context available.`,
    hint: 'Specify project_id parameter, set DECIBEL_PROJECT_ROOT env var, or run from a directory with .decibel/',
  };
}

export function isOracleError(result: unknown): result is OracleError {
  return (
    typeof result === 'object' &&
    result !== null &&
    'error' in result &&
    'message' in result
  );
}

export type Priority = 'low' | 'med' | 'high';

export interface NextActionsInput {
  projectId?: string;  // optional, uses project resolution
  focus?: string;
}

export interface Action {
  description: string;
  source: string;
  priority: Priority;
  domain?: 'designer' | 'architect' | 'sentinel' | 'friction';
  location?: 'project' | 'global';
}

export interface NextActionsOutput {
  actions: Action[];
  friction_summary?: {
    total_open: number;
    high_signal: number;
    blocking: number;
  };
  data_locations: {
    project_local: boolean;
    global: boolean;
  };
}

interface FileInfo {
  filename: string;
  path: string;
  timestamp: Date;
  type: 'designer' | 'architect' | 'sentinel';
  summary?: string;
  severity?: string;
  location: 'project' | 'global';
}

interface FrictionInfo {
  filename: string;
  path: string;
  context: string;
  description: string;
  impact: string;
  status: string;
  signal_count: number;
  last_reported: Date;
}

async function getFilesFromDir(
  dirPath: string,
  type: FileInfo['type'],
  location: 'project' | 'global',
  recursive: boolean = false
): Promise<FileInfo[]> {
  const files: FileInfo[] = [];

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      // Recursively scan subdirectories if enabled
      if (entry.isDirectory() && recursive) {
        const subFiles = await getFilesFromDir(fullPath, type, location, true);
        files.push(...subFiles);
        continue;
      }

      if (entry.isFile() && entry.name.endsWith('.md')) {
        const filePath = fullPath;
        const content = await fs.readFile(filePath, 'utf-8');

        // Parse timestamp from filename (YYYY-MM-DDTHH-mm-ssZ-slug.md)
        const timestampMatch = entry.name.match(/^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})/);
        let timestamp = new Date();
        if (timestampMatch) {
          const isoTimestamp = timestampMatch[1].replace(/-/g, (match, offset) => {
            // Only replace the hyphens after the date part (position > 10)
            if (offset > 10 && offset < 19) return ':';
            return match;
          });
          timestamp = new Date(isoTimestamp);
        }

        // Extract summary from frontmatter or first heading
        let summary: string | undefined;
        let severity: string | undefined;

        const summaryMatch = content.match(/^summary:\s*(.+)$/m);
        if (summaryMatch) summary = summaryMatch[1];

        const changeMatch = content.match(/^change:\s*(.+)$/m);
        if (changeMatch && !summary) summary = changeMatch[1];

        const titleMatch = content.match(/^#\s+(.+)$/m);
        if (titleMatch && !summary) summary = titleMatch[1];

        const severityMatch = content.match(/^severity:\s*(.+)$/m);
        if (severityMatch) severity = severityMatch[1];

        files.push({
          filename: entry.name,
          path: filePath,
          timestamp,
          type,
          summary,
          severity,
          location,
        });
      }
    }
  } catch (error) {
    // Directory might not exist, that's OK
    log(`Oracle: Could not read ${dirPath}:`, error);
  }

  return files;
}

async function getFrictionFiles(resolved: ResolvedProjectPaths): Promise<FrictionInfo[]> {
  // Friction is in project .decibel/friction/
  const frictionDir = resolved.subPath('friction');
  const frictionList: FrictionInfo[] = [];

  try {
    const entries = await fs.readdir(frictionDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.md')) {
        const filePath = path.join(frictionDir, entry.name);
        const content = await fs.readFile(filePath, 'utf-8');

        // Parse frontmatter
        const contextMatch = content.match(/^context:\s*(.+)$/m);
        const impactMatch = content.match(/^impact:\s*(.+)$/m);
        const statusMatch = content.match(/^status:\s*(.+)$/m);
        const signalMatch = content.match(/^signal_count:\s*(\d+)$/m);
        const lastReportedMatch = content.match(/^last_reported:\s*(.+)$/m);
        const titleMatch = content.match(/^#\s+(.+)$/m);

        const status = statusMatch?.[1] || 'open';
        
        // Only include open friction
        if (status !== 'open' && status !== 'acknowledged' && status !== 'solving') {
          continue;
        }

        frictionList.push({
          filename: entry.name,
          path: filePath,
          context: contextMatch?.[1] || 'unknown',
          description: titleMatch?.[1] || entry.name,
          impact: impactMatch?.[1] || 'medium',
          status,
          signal_count: parseInt(signalMatch?.[1] || '1', 10),
          last_reported: new Date(lastReportedMatch?.[1] || Date.now()),
        });
      }
    }
  } catch (error) {
    log(`Oracle: Could not read friction directory:`, error);
  }

  return frictionList;
}

async function collectRecentFiles(
  resolved: ResolvedProjectPaths
): Promise<FileInfo[]> {
  const allFiles: FileInfo[] = [];

  // Sentinel issues from project .decibel/sentinel/issues/
  const projectIssuesDir = resolved.subPath('sentinel', 'issues');
  const projectIssues = await getFilesFromDir(projectIssuesDir, 'sentinel', 'project');
  allFiles.push(...projectIssues);

  // Architect ADRs from project .decibel/architect/adrs/
  const projectArchitectDir = resolved.subPath('architect', 'adrs');
  const projectArchitect = await getFilesFromDir(projectArchitectDir, 'architect', 'project');
  allFiles.push(...projectArchitect);

  // Designer from project .decibel/designer/ (recursively scan area subdirectories)
  const projectDesignerDir = resolved.subPath('designer');
  const projectDesigner = await getFilesFromDir(projectDesignerDir, 'designer', 'project', true);
  allFiles.push(...projectDesigner);

  // Sort by timestamp descending and take last 10
  allFiles.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  return allFiles.slice(0, 10);
}

function inferPriority(file: FileInfo): Priority {
  // Sentinel issues with high/critical severity get high priority
  if (file.type === 'sentinel') {
    if (file.severity === 'critical' || file.severity === 'high') {
      return 'high';
    }
    if (file.severity === 'med') {
      return 'med';
    }
    return 'low';
  }

  // Architect decisions are typically medium-high priority
  if (file.type === 'architect') {
    return 'med';
  }

  // Designer decisions are typically medium-low priority
  return 'low';
}

function inferFrictionPriority(friction: FrictionInfo): Priority {
  // Blocking = always high
  if (friction.impact === 'blocking') return 'high';
  
  // High signal (3+) elevates priority
  if (friction.signal_count >= 3) {
    if (friction.impact === 'high') return 'high';
    return 'med';
  }
  
  // High impact with any signal
  if (friction.impact === 'high') return 'med';
  
  // Medium signal (2) with medium impact
  if (friction.signal_count >= 2 && friction.impact === 'medium') return 'med';
  
  return 'low';
}

function generateActionDescription(file: FileInfo): string {
  const prefix = {
    designer: 'Review design decision',
    architect: 'Implement architecture change',
    sentinel: 'Address issue',
  };

  const summary = file.summary || file.filename;
  return `${prefix[file.type]}: ${summary}`;
}

export async function nextActions(
  input: NextActionsInput
): Promise<NextActionsOutput | OracleError> {
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.projectId);
  } catch {
    return makeProjectError('get next actions');
  }

  log(`Oracle: Getting next actions for project ${resolved.id}`);

  const recentFiles = await collectRecentFiles(resolved);
  const allFriction = await getFrictionFiles(resolved);

  // Filter friction by project context (or include all if no specific match)
  const projectFriction = allFriction.filter(
    f => f.context === resolved.id ||
         f.context.toLowerCase().includes(resolved.id.toLowerCase())
  );

  // Also get high-signal friction from any context
  const highSignalFriction = allFriction.filter(
    f => f.signal_count >= 3 || f.impact === 'blocking'
  );

  // Combine and dedupe
  const relevantFriction = Array.from(
    new Map([...projectFriction, ...highSignalFriction].map(f => [f.filename, f])).values()
  );

  // Build friction summary
  const frictionSummary = {
    total_open: allFriction.length,
    high_signal: allFriction.filter(f => f.signal_count >= 3).length,
    blocking: allFriction.filter(f => f.impact === 'blocking').length,
  };

  const dataLocations = {
    project_local: true,
    global: false,
  };

  if (recentFiles.length === 0 && relevantFriction.length === 0) {
    return {
      actions: [{
        description: `No recent activity found for project ${resolved.id}. Start by recording design decisions or architecture changes.`,
        source: 'oracle',
        priority: 'low',
      }],
      friction_summary: frictionSummary,
      data_locations: dataLocations,
    };
  }

  // Generate actions based on recent files
  const actions: Action[] = [];

  // Filter by focus if provided
  let filesToProcess = recentFiles;
  if (input.focus) {
    const focusLower = input.focus.toLowerCase();
    filesToProcess = recentFiles.filter(
      f => f.type === focusLower ||
           f.summary?.toLowerCase().includes(focusLower) ||
           f.filename.toLowerCase().includes(focusLower)
    );

    // If no matches, fall back to all files
    if (filesToProcess.length === 0) {
      filesToProcess = recentFiles;
    }
  }

  // Add friction actions FIRST (they're often the most actionable)
  const sortedFriction = relevantFriction.sort((a, b) => {
    // Sort by: blocking first, then signal count, then impact
    if (a.impact === 'blocking' && b.impact !== 'blocking') return -1;
    if (b.impact === 'blocking' && a.impact !== 'blocking') return 1;
    if (b.signal_count !== a.signal_count) return b.signal_count - a.signal_count;
    const impactOrder: Record<string, number> = { blocking: 4, high: 3, medium: 2, low: 1 };
    return (impactOrder[b.impact] || 0) - (impactOrder[a.impact] || 0);
  });

  for (const friction of sortedFriction.slice(0, 2)) {
    actions.push({
      description: `Resolve friction (signal: ${friction.signal_count}): ${friction.description}`,
      source: friction.path,
      priority: inferFrictionPriority(friction),
      domain: 'friction',
      location: 'project',
    });
  }

  // Prioritize sentinel issues first
  const sentinelFiles = filesToProcess.filter(f => f.type === 'sentinel');
  const architectFiles = filesToProcess.filter(f => f.type === 'architect');
  const designerFiles = filesToProcess.filter(f => f.type === 'designer');

  // Add sentinel issues (high priority items first)
  for (const file of sentinelFiles.slice(0, 3)) {
    actions.push({
      description: generateActionDescription(file),
      source: file.path,
      priority: inferPriority(file),
      domain: 'sentinel',
      location: file.location,
    });
  }

  // Add architect decisions
  for (const file of architectFiles.slice(0, 2)) {
    actions.push({
      description: generateActionDescription(file),
      source: file.path,
      priority: inferPriority(file),
      domain: 'architect',
      location: file.location,
    });
  }

  // Add designer decisions
  for (const file of designerFiles.slice(0, 2)) {
    actions.push({
      description: generateActionDescription(file),
      source: file.path,
      priority: inferPriority(file),
      domain: 'designer',
      location: file.location,
    });
  }

  // Ensure we have at least 3 and at most 7 actions
  if (actions.length < 3 && filesToProcess.length > actions.length) {
    for (const file of filesToProcess) {
      if (actions.length >= 7) break;
      if (!actions.find(a => a.source === file.path)) {
        actions.push({
          description: generateActionDescription(file),
          source: file.path,
          priority: inferPriority(file),
          domain: file.type,
          location: file.location,
        });
      }
    }
  }

  // Sort by priority (high > med > low)
  const priorityOrder = { high: 0, med: 1, low: 2 };
  actions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  return {
    actions: actions.slice(0, 7),
    friction_summary: frictionSummary,
    data_locations: dataLocations,
  };
}

// ============================================================================
// Roadmap Progress Types
// ============================================================================

export interface RoadmapInput {
  projectId?: string;
  dryRun?: boolean;
  noSignals?: boolean;
}

export interface MilestoneProgress {
  id: string;
  label: string;
  target_date: string;
  epics_total: number;
  epics_completed: number;
  epics_in_progress: number;
  epics_blocked: number;
  progress_percent: number;
  status: 'on_track' | 'at_risk' | 'behind' | 'completed';
  days_remaining: number;
}

export interface ObjectiveProgress {
  id: string;
  title: string;
  timeframe: string;
  key_results: Array<{
    metric: string;
    target: string;
    current?: string;
    progress_percent?: number;
  }>;
  overall_progress: number;
}

export interface EpicStatus {
  epic_id: string;
  status: 'not_started' | 'in_progress' | 'completed' | 'blocked';
  issue_count: number;
  open_issues: number;
  health_score?: number;
  risk_flags?: string[];
}

export interface RoadmapOutput {
  project_id: string;
  evaluated_at: string;
  milestones: MilestoneProgress[];
  objectives: ObjectiveProgress[];
  epics: EpicStatus[];
  signals?: {
    blocking_issues: number;
    high_severity_issues: number;
    friction_points: number;
  };
  summary: {
    total_milestones: number;
    on_track: number;
    at_risk: number;
    behind: number;
    completed: number;
  };
  progress_file?: string;
}

// ============================================================================
// Roadmap Progress Implementation
// ============================================================================

interface Roadmap {
  objectives: Array<{
    id: string;
    title: string;
    timeframe: string;
    key_results?: Array<{
      metric: string;
      target: string;
      current?: string;
    }>;
  }>;
  themes: Array<{
    id: string;
    label: string;
  }>;
  milestones: Array<{
    id: string;
    label: string;
    target_date: string;
    epics?: string[];
  }>;
  epic_context: Record<string, {
    epic_id: string;
    theme?: string;
    objectives?: string[];
    milestone?: string;
    work_type: string;
  }>;
}

interface SentinelIssue {
  id: string;
  epic_id?: string;
  status: string;
  severity: string;
}

async function loadRoadmap(resolved: ResolvedProjectPaths): Promise<Roadmap | null> {
  const roadmapPath = resolved.subPath('architect', 'roadmap', 'roadmap.yaml');

  try {
    const content = await fs.readFile(roadmapPath, 'utf-8');
    return parseYaml(content) as Roadmap;
  } catch {
    return null;
  }
}

async function loadSentinelIssues(resolved: ResolvedProjectPaths): Promise<SentinelIssue[]> {
  const issuesDir = resolved.subPath('sentinel', 'issues');
  const issues: SentinelIssue[] = [];

  try {
    const entries = await fs.readdir(issuesDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isFile() && (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml'))) {
        const filePath = path.join(issuesDir, entry.name);
        const content = await fs.readFile(filePath, 'utf-8');
        const data = parseYaml(content) as Record<string, unknown>;

        issues.push({
          id: (data.id as string) || entry.name.replace(/\.(yaml|yml)$/, ''),
          epic_id: data.epic_id as string | undefined,
          status: (data.status as string) || 'open',
          severity: (data.severity as string) || 'medium',
        });
      }
    }
  } catch {
    // Issues directory might not exist
  }

  return issues;
}

async function loadEpicStatuses(resolved: ResolvedProjectPaths): Promise<Map<string, string>> {
  const epicsDir = resolved.subPath('sentinel', 'epics');
  const statuses = new Map<string, string>();

  try {
    const entries = await fs.readdir(epicsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isFile() && (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml') || entry.name.endsWith('.md'))) {
        const filePath = path.join(epicsDir, entry.name);
        const content = await fs.readFile(filePath, 'utf-8');

        // Try YAML first
        if (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml')) {
          const data = parseYaml(content) as Record<string, unknown>;
          const epicId = (data.id as string) || (data.epic_id as string) || entry.name.replace(/\.(yaml|yml)$/, '');
          const status = (data.status as string) || 'not_started';
          statuses.set(epicId, status);
        } else {
          // Try to parse frontmatter from markdown
          const statusMatch = content.match(/^status:\s*(.+)$/m);
          const idMatch = content.match(/^(?:id|epic_id):\s*(.+)$/m);
          const epicId = idMatch?.[1] || entry.name.replace(/\.md$/, '');
          const status = statusMatch?.[1] || 'not_started';
          statuses.set(epicId, status);
        }
      }
    }
  } catch {
    // Epics directory might not exist
  }

  return statuses;
}

function calculateMilestoneStatus(
  milestone: { target_date: string },
  epicsCompleted: number,
  epicsTotal: number,
  epicsBlocked: number
): 'on_track' | 'at_risk' | 'behind' | 'completed' {
  if (epicsTotal > 0 && epicsCompleted === epicsTotal) {
    return 'completed';
  }

  const targetDate = new Date(milestone.target_date);
  const now = new Date();
  const daysRemaining = Math.ceil((targetDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (daysRemaining < 0) {
    return 'behind';
  }

  const progressPercent = epicsTotal > 0 ? (epicsCompleted / epicsTotal) * 100 : 0;

  // If we have blocked epics or low progress with little time, we're at risk
  if (epicsBlocked > 0) {
    return 'at_risk';
  }

  // Calculate expected progress based on time
  const totalDays = 90; // Assume 90 day milestones as baseline
  const expectedProgress = Math.min(100, ((totalDays - daysRemaining) / totalDays) * 100);

  if (progressPercent < expectedProgress - 20) {
    return 'behind';
  }

  if (progressPercent < expectedProgress - 10) {
    return 'at_risk';
  }

  return 'on_track';
}

export async function roadmapProgress(
  input: RoadmapInput
): Promise<RoadmapOutput | OracleError> {
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.projectId);
  } catch {
    return makeProjectError('evaluate roadmap progress');
  }

  log(`Oracle: Evaluating roadmap progress for project ${resolved.id}`);

  // Load roadmap
  const roadmap = await loadRoadmap(resolved);
  if (!roadmap) {
    return {
      error: 'ROADMAP_NOT_FOUND',
      message: 'No roadmap.yaml found in .decibel/architect/roadmap/',
      hint: 'Initialize a roadmap with roadmap_init tool or create roadmap.yaml manually',
    };
  }

  // Load epic statuses and issues
  const epicStatuses = await loadEpicStatuses(resolved);
  const issues = input.noSignals ? [] : await loadSentinelIssues(resolved);

  // Build epic status list
  const epics: EpicStatus[] = [];
  for (const [epicId, context] of Object.entries(roadmap.epic_context)) {
    const statusStr = epicStatuses.get(epicId) || 'not_started';
    const epicIssues = issues.filter(i => i.epic_id === epicId);
    const openIssues = epicIssues.filter(i => i.status === 'open' || i.status === 'in_progress');

    let status: EpicStatus['status'] = 'not_started';
    if (statusStr === 'completed' || statusStr === 'done') {
      status = 'completed';
    } else if (statusStr === 'blocked') {
      status = 'blocked';
    } else if (statusStr === 'in_progress' || statusStr === 'active') {
      status = 'in_progress';
    }

    epics.push({
      epic_id: epicId,
      status,
      issue_count: epicIssues.length,
      open_issues: openIssues.length,
    });
  }

  // Calculate milestone progress
  const milestones: MilestoneProgress[] = roadmap.milestones.map(ms => {
    const msEpics = ms.epics || [];
    const epicStatusList = msEpics.map(eid => epics.find(e => e.epic_id === eid));

    const total = msEpics.length;
    const completed = epicStatusList.filter(e => e?.status === 'completed').length;
    const inProgress = epicStatusList.filter(e => e?.status === 'in_progress').length;
    const blocked = epicStatusList.filter(e => e?.status === 'blocked').length;

    const targetDate = new Date(ms.target_date);
    const now = new Date();
    const daysRemaining = Math.ceil((targetDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    return {
      id: ms.id,
      label: ms.label,
      target_date: ms.target_date,
      epics_total: total,
      epics_completed: completed,
      epics_in_progress: inProgress,
      epics_blocked: blocked,
      progress_percent: total > 0 ? Math.round((completed / total) * 100) : 0,
      status: calculateMilestoneStatus(ms, completed, total, blocked),
      days_remaining: daysRemaining,
    };
  });

  // Calculate objective progress (simplified - just count linked epics)
  const objectives: ObjectiveProgress[] = roadmap.objectives.map(obj => {
    const linkedEpics = Object.values(roadmap.epic_context)
      .filter(ec => ec.objectives?.includes(obj.id));
    const completedEpics = linkedEpics.filter(ec =>
      epics.find(e => e.epic_id === ec.epic_id)?.status === 'completed'
    );

    return {
      id: obj.id,
      title: obj.title,
      timeframe: obj.timeframe,
      key_results: obj.key_results || [],
      overall_progress: linkedEpics.length > 0
        ? Math.round((completedEpics.length / linkedEpics.length) * 100)
        : 0,
    };
  });

  // Build signals summary
  const signals = input.noSignals ? undefined : {
    blocking_issues: issues.filter(i => i.severity === 'critical' || i.severity === 'blocking').length,
    high_severity_issues: issues.filter(i => i.severity === 'high').length,
    friction_points: 0, // Would need to load friction files
  };

  // Summary
  const summary = {
    total_milestones: milestones.length,
    on_track: milestones.filter(m => m.status === 'on_track').length,
    at_risk: milestones.filter(m => m.status === 'at_risk').length,
    behind: milestones.filter(m => m.status === 'behind').length,
    completed: milestones.filter(m => m.status === 'completed').length,
  };

  const output: RoadmapOutput = {
    project_id: resolved.id,
    evaluated_at: new Date().toISOString(),
    milestones,
    objectives,
    epics,
    signals,
    summary,
  };

  // Save progress file unless dry run
  if (!input.dryRun) {
    const progressDir = resolved.subPath('oracle');
    const progressPath = path.join(progressDir, 'progress.yaml');

    try {
      await fs.mkdir(progressDir, { recursive: true });
      await fs.writeFile(progressPath, stringifyYaml(output), 'utf-8');
      output.progress_file = progressPath;
      log(`Oracle: Saved progress to ${progressPath}`);
    } catch (err) {
      log(`Oracle: Could not save progress file:`, err);
    }
  }

  return output;
}
