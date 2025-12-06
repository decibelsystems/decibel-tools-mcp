import fs from 'fs/promises';
import path from 'path';
import { log } from '../config.js';
import { resolvePath, ensureDir, hasProjectLocal } from '../dataRoot.js';

export type LearningCategory = 'debug' | 'integration' | 'architecture' | 'tooling' | 'process' | 'other';

export interface AppendLearningInput {
  project_id: string;
  category: LearningCategory;
  title: string;
  content: string;
  tags?: string[];
}

export interface AppendLearningOutput {
  timestamp: string;
  path: string;
  entry_count: number;
  location: 'project' | 'global';
}

export interface ListLearningsInput {
  project_id: string;
  category?: LearningCategory;
  limit?: number;
}

export interface LearningEntry {
  timestamp: string;
  category: LearningCategory;
  title: string;
  content: string;
  tags: string[];
}

export interface ListLearningsOutput {
  path: string;
  entries: LearningEntry[];
  total_count: number;
  location: 'project' | 'global';
}

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

function formatTime(date: Date): string {
  return date.toISOString().split('T')[1].replace('Z', '').split('.')[0];
}

function parseEntry(block: string): LearningEntry | null {
  const lines = block.trim().split('\n');
  if (lines.length < 3) return null;

  const headerMatch = lines[0].match(/^### \[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\] (.+)$/);
  if (!headerMatch) return null;

  const timestamp = headerMatch[1];
  const title = headerMatch[2];

  const metaMatch = lines[1].match(/^\*\*Category:\*\* (\w+)(?:\s+\|\s+\*\*Tags:\*\* (.+))?$/);
  if (!metaMatch) return null;

  const category = metaMatch[1] as LearningCategory;
  const tags = metaMatch[2] ? metaMatch[2].split(',').map(t => t.trim().replace(/^`|`$/g, '')) : [];

  const content = lines.slice(3).join('\n').trim();

  return { timestamp, category, title, content, tags };
}

// Known global project IDs (learnings about the tooling itself)
const GLOBAL_PROJECTS = [
  'decibel-tools-mcp',
  'decibel-tools',
  'decibel-ecosystem',
  'mcp',
];

export async function appendLearning(
  input: AppendLearningInput
): Promise<AppendLearningOutput> {
  const now = new Date();
  const timestamp = now.toISOString();

  // Determine if this is global (tooling) or project-specific
  const isGlobalProject = GLOBAL_PROJECTS.includes(input.project_id.toLowerCase());

  let dirPath: string;
  let location: 'project' | 'global';

  if (isGlobalProject) {
    // Always use global for tooling learnings
    dirPath = resolvePath('learnings-global');
    location = 'global';
  } else if (hasProjectLocal()) {
    // Use project-local for project-specific learnings
    dirPath = resolvePath('learnings-project');
    location = 'project';
  } else {
    // Fallback to global
    dirPath = resolvePath('learnings-global');
    location = 'global';
  }

  const filePath = path.join(dirPath, `${input.project_id}.md`);
  ensureDir(dirPath);

  // Check if file exists, create with header if not
  let existingContent = '';
  let entryCount = 0;
  try {
    existingContent = await fs.readFile(filePath, 'utf-8');
    // Count existing entries
    const matches = existingContent.match(/^### \[/gm);
    entryCount = matches ? matches.length : 0;
  } catch {
    // File doesn't exist, create with header
    existingContent = `# Technical Learnings: ${input.project_id}\n\n> A living document of lessons learned, gotchas, and insights.\n\n---\n\n`;
  }

  // Format the new entry
  const dateStr = formatDate(now);
  const timeStr = formatTime(now);
  const tagsStr = input.tags && input.tags.length > 0 
    ? ` | **Tags:** ${input.tags.map(t => `\`${t}\``).join(', ')}`
    : '';

  const entry = [
    `### [${dateStr} ${timeStr}] ${input.title}`,
    `**Category:** ${input.category}${tagsStr}`,
    '',
    input.content,
    '',
    '---',
    '',
  ].join('\n');

  // Append to file
  const newContent = existingContent + entry;
  await fs.writeFile(filePath, newContent, 'utf-8');
  
  entryCount++;
  log(`Learnings: Appended entry to ${filePath} (${location})`);

  return {
    timestamp,
    path: filePath,
    entry_count: entryCount,
    location,
  };
}

export async function listLearnings(
  input: ListLearningsInput
): Promise<ListLearningsOutput> {
  // Determine location based on project_id
  const isGlobalProject = GLOBAL_PROJECTS.includes(input.project_id.toLowerCase());

  let dirPath: string;
  let location: 'project' | 'global';

  if (isGlobalProject) {
    dirPath = resolvePath('learnings-global');
    location = 'global';
  } else if (hasProjectLocal()) {
    dirPath = resolvePath('learnings-project');
    location = 'project';
  } else {
    dirPath = resolvePath('learnings-global');
    location = 'global';
  }

  const filePath = path.join(dirPath, `${input.project_id}.md`);

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    
    // Split by entry headers
    const blocks = content.split(/(?=^### \[)/m).filter(b => b.startsWith('### ['));
    
    let entries: LearningEntry[] = [];
    for (const block of blocks) {
      const entry = parseEntry(block);
      if (entry) {
        // Filter by category if specified
        if (input.category && entry.category !== input.category) {
          continue;
        }
        entries.push(entry);
      }
    }

    const totalCount = entries.length;

    // Apply limit (most recent first)
    entries = entries.reverse();
    if (input.limit && input.limit > 0) {
      entries = entries.slice(0, input.limit);
    }

    log(`Learnings: Listed ${entries.length} entries from ${filePath}`);

    return {
      path: filePath,
      entries,
      total_count: totalCount,
      location,
    };
  } catch {
    // File doesn't exist
    return {
      path: filePath,
      entries: [],
      total_count: 0,
      location,
    };
  }
}
