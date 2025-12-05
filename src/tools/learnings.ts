import fs from 'fs/promises';
import path from 'path';
import { getConfig, log } from '../config.js';

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
): Promise<AppendLearningOutput> {
  const config = getConfig();
  const now = new Date();
  const timestamp = now.toISOString();

  const dirPath = path.join(config.rootDir, 'learnings');
  const filePath = path.join(dirPath, `${input.project_id}.md`);

  // Create directory if it doesn't exist
  await fs.mkdir(dirPath, { recursive: true });

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
  log(`Learnings: Appended entry to ${filePath}`);

  return {
    timestamp,
    path: filePath,
    entry_count: entryCount,
  };
}

export async function listLearnings(
  input: ListLearningsInput
): Promise<ListLearningsOutput> {
  const config = getConfig();
  const filePath = path.join(config.rootDir, 'learnings', `${input.project_id}.md`);

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
    };
  } catch {
    // File doesn't exist
    return {
      path: filePath,
      entries: [],
      total_count: 0,
    };
  }
}
