import fs from 'fs/promises';
import path from 'path';
import { log } from '../config.js';
import { resolvePath, ensureDir } from '../dataRoot.js';

/**
 * Crit - Early creative feedback before decisions crystallize
 * 
 * Use for:
 * - Gut reactions ("this feels sluggish")
 * - Observations ("4-up runs at 45fps")
 * - Questions ("should we use video fallback?")
 * - Hunches ("spring physics might be overkill")
 * 
 * NOT for:
 * - Final decisions (use designer_record_design_decision)
 * - Bugs/issues (use sentinel_create_issue)
 * - Learnings after the fact (use learnings_append)
 */

export type CritSentiment = 'positive' | 'negative' | 'neutral' | 'question';

export interface LogCritInput {
  project_id: string;
  area: string;           // e.g., "3D", "motion", "layout", "ux"
  observation: string;    // The crit itself
  sentiment?: CritSentiment;
  context?: string;       // What were you testing/looking at?
  tags?: string[];
}

export interface LogCritOutput {
  id: string;
  timestamp: string;
  path: string;
  sentiment: CritSentiment;
}

export interface ListCritsInput {
  project_id: string;
  area?: string;
  sentiment?: CritSentiment;
  limit?: number;
}

export interface CritEntry {
  timestamp: string;
  area: string;
  observation: string;
  sentiment: CritSentiment;
  context?: string;
  tags?: string[];
}

export interface ListCritsOutput {
  path: string;
  entries: CritEntry[];
  total_count: number;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 30);
}

function sentimentEmoji(sentiment: CritSentiment): string {
  switch (sentiment) {
    case 'positive': return '✓';
    case 'negative': return '✗';
    case 'question': return '?';
    default: return '•';
  }
}

/**
 * Log a crit observation
 */
export async function logCrit(input: LogCritInput): Promise<LogCritOutput> {
  const now = new Date();
  const timestamp = now.toISOString();
  const sentiment = input.sentiment || 'neutral';

  // Store crits in a single markdown file per project (like learnings)
  const baseDir = resolvePath('designer-global');
  const dirPath = path.join(baseDir, 'crits');
  ensureDir(dirPath);

  const filePath = path.join(dirPath, `${input.project_id}.md`);
  const id = `${slugify(input.area)}-${Date.now()}`;

  // Build the entry
  const emoji = sentimentEmoji(sentiment);
  const tagsStr = input.tags?.length ? ` [${input.tags.join(', ')}]` : '';
  const contextStr = input.context ? `\n  > Context: ${input.context}` : '';

  const entry = `
## ${emoji} ${input.area} — ${timestamp.split('T')[0]}${tagsStr}

${input.observation}${contextStr}

---
`;

  // Append to file (create if doesn't exist)
  try {
    await fs.access(filePath);
    await fs.appendFile(filePath, entry, 'utf-8');
  } catch {
    // File doesn't exist, create with header
    const header = `# Crits: ${input.project_id}

Early observations, gut reactions, and questions before decisions crystallize.

---
`;
    await fs.writeFile(filePath, header + entry, 'utf-8');
  }

  log(`Crit: Logged observation to ${filePath}`);

  return {
    id,
    timestamp,
    path: filePath,
    sentiment,
  };
}

/**
 * List crits for a project
 */
export async function listCrits(input: ListCritsInput): Promise<ListCritsOutput> {
  const baseDir = resolvePath('designer-global');
  const filePath = path.join(baseDir, 'crits', `${input.project_id}.md`);

  try {
    await fs.access(filePath);
  } catch {
    return {
      path: filePath,
      entries: [],
      total_count: 0,
    };
  }

  const content = await fs.readFile(filePath, 'utf-8');
  const entries: CritEntry[] = [];

  // Parse entries (simple regex-based parsing)
  const entryPattern = /## ([✓✗?•]) (.+?) — (\d{4}-\d{2}-\d{2})(?:\s*\[([^\]]+)\])?\n\n([\s\S]*?)(?=\n---|\n## |$)/g;
  let match;

  while ((match = entryPattern.exec(content)) !== null) {
    const [, emoji, area, date, tagsStr, body] = match;
    
    let sentiment: CritSentiment = 'neutral';
    if (emoji === '✓') sentiment = 'positive';
    else if (emoji === '✗') sentiment = 'negative';
    else if (emoji === '?') sentiment = 'question';

    // Extract context if present
    const contextMatch = body.match(/>\s*Context:\s*(.+)/);
    const context = contextMatch ? contextMatch[1].trim() : undefined;
    const observation = body.replace(/>\s*Context:\s*.+/, '').trim();

    const tags = tagsStr ? tagsStr.split(',').map((t) => t.trim()) : undefined;

    entries.push({
      timestamp: date,
      area: area.trim(),
      observation,
      sentiment,
      context,
      tags,
    });
  }

  // Apply filters
  let filtered = entries;

  if (input.area) {
    filtered = filtered.filter((e) => 
      e.area.toLowerCase().includes(input.area!.toLowerCase())
    );
  }

  if (input.sentiment) {
    filtered = filtered.filter((e) => e.sentiment === input.sentiment);
  }

  // Most recent first
  filtered.reverse();

  // Apply limit
  if (input.limit) {
    filtered = filtered.slice(0, input.limit);
  }

  return {
    path: filePath,
    entries: filtered,
    total_count: entries.length,
  };
}
