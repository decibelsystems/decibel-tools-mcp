import fs from 'fs/promises';
import path from 'path';
import { getConfig, log } from '../config.js';

export type Priority = 'low' | 'med' | 'high';

export interface NextActionsInput {
  project_id: string;
  focus?: string;
}

export interface Action {
  description: string;
  source: string;
  priority: Priority;
  domain?: 'designer' | 'architect' | 'sentinel' | 'friction';
}

export interface NextActionsOutput {
  actions: Action[];
  friction_summary?: {
    total_open: number;
    high_signal: number;
    blocking: number;
  };
}

interface FileInfo {
  filename: string;
  path: string;
  timestamp: Date;
  type: 'designer' | 'architect' | 'sentinel';
  summary?: string;
  severity?: string;
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
  type: FileInfo['type']
): Promise<FileInfo[]> {
  const files: FileInfo[] = [];

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.md')) {
        const filePath = path.join(dirPath, entry.name);
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
        });
      }
    }
  } catch (error) {
    // Directory might not exist, that's OK
    log(`Oracle: Could not read ${dirPath}:`, error);
  }

  return files;
}

async function getFrictionFiles(rootDir: string): Promise<FrictionInfo[]> {
  const frictionDir = path.join(rootDir, 'friction');
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
  projectId: string,
  rootDir: string
): Promise<FileInfo[]> {
  const allFiles: FileInfo[] = [];

  // Designer files
  const designerDir = path.join(rootDir, 'designer', projectId);
  const designerFiles = await getFilesFromDir(designerDir, 'designer');
  allFiles.push(...designerFiles);

  // Architect files (system_id might match project_id)
  const architectDir = path.join(rootDir, 'architect', projectId);
  const architectFiles = await getFilesFromDir(architectDir, 'architect');
  allFiles.push(...architectFiles);

  // Sentinel issues (repo might match project_id)
  const sentinelDir = path.join(rootDir, 'sentinel', projectId, 'issues');
  const sentinelFiles = await getFilesFromDir(sentinelDir, 'sentinel');
  allFiles.push(...sentinelFiles);

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
): Promise<NextActionsOutput> {
  const config = getConfig();

  log(`Oracle: Getting next actions for project ${input.project_id}`);

  const recentFiles = await collectRecentFiles(input.project_id, config.rootDir);
  const allFriction = await getFrictionFiles(config.rootDir);
  
  // Filter friction by project context (or include all if no specific match)
  const projectFriction = allFriction.filter(
    f => f.context === input.project_id || 
         f.context.toLowerCase().includes(input.project_id.toLowerCase())
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

  if (recentFiles.length === 0 && relevantFriction.length === 0) {
    return {
      actions: [{
        description: `No recent activity found for project ${input.project_id}. Start by recording design decisions or architecture changes.`,
        source: 'oracle',
        priority: 'low',
      }],
      friction_summary: frictionSummary,
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
    });
  }

  // Add architect decisions
  for (const file of architectFiles.slice(0, 2)) {
    actions.push({
      description: generateActionDescription(file),
      source: file.path,
      priority: inferPriority(file),
      domain: 'architect',
    });
  }

  // Add designer decisions
  for (const file of designerFiles.slice(0, 2)) {
    actions.push({
      description: generateActionDescription(file),
      source: file.path,
      priority: inferPriority(file),
      domain: 'designer',
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
  };
}
