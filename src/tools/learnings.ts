import fs from 'fs/promises';
import path from 'path';
import { log } from '../config.js';
import { ensureDir } from '../dataRoot.js';
import { resolveProjectPaths, validateWritePath, ResolvedProjectPaths } from '../projectRegistry.js';
import { emitCreateProvenance } from './provenance.js';

// ============================================================================
// Project Resolution Error
// ============================================================================

export interface LearningsError {
  error: string;
  message: string;
  hint?: string;
}

function makeProjectError(operation: string): LearningsError {
  return {
    error: 'PROJECT_NOT_FOUND',
    message: `Cannot ${operation}: No project context available.`,
    hint: 'Specify projectId parameter, set DECIBEL_PROJECT_ROOT env var, or run from a directory with .decibel/',
  };
}

export function isLearningsError(result: unknown): result is LearningsError {
  return (
    typeof result === 'object' &&
    result !== null &&
    'error' in result &&
    'message' in result
  );
}

export type LearningCategory = 'debug' | 'integration' | 'architecture' | 'tooling' | 'process' | 'other';

export interface AppendLearningInput {
  projectId?: string;  // optional, uses project resolution
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
  projectId?: string;  // optional, uses project resolution
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

export async function appendLearning(
  input: AppendLearningInput
): Promise<AppendLearningOutput | LearningsError> {
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.projectId);
  } catch {
    return makeProjectError('append learning');
  }

  const now = new Date();
  const timestamp = now.toISOString();

  // Store in .decibel/oracle/learnings/
  const dirPath = resolved.subPath('oracle', 'learnings');
  ensureDir(dirPath);

  const filePath = path.join(dirPath, 'learnings.md');

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
    existingContent = `# Technical Learnings: ${resolved.id}\n\n> A living document of lessons learned, gotchas, and insights.\n\n---\n\n`;
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
  validateWritePath(filePath, resolved);
  await fs.writeFile(filePath, newContent, 'utf-8');

  entryCount++;
  log(`Learnings: Appended entry to ${filePath} (project: ${resolved.id})`);

  // Emit provenance event for this creation
  await emitCreateProvenance(
    `learnings:entry:${resolved.id}:${entryCount}`,
    entry,
    `Appended learning: ${input.title}`,
    input.projectId
  );

  return {
    timestamp,
    path: filePath,
    entry_count: entryCount,
    location: 'project',
  };
}

export async function listLearnings(
  input: ListLearningsInput
): Promise<ListLearningsOutput | LearningsError> {
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.projectId);
  } catch {
    return makeProjectError('list learnings');
  }

  const dirPath = resolved.subPath('oracle', 'learnings');
  const filePath = path.join(dirPath, 'learnings.md');

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
      location: 'project',
    };
  } catch {
    // File doesn't exist
    return {
      path: filePath,
      entries: [],
      total_count: 0,
      location: 'project',
    };
  }
}
