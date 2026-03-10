// ============================================================================
// Corpus Domain Logic
// ============================================================================
// Search decibel-corpus for patterns, playbooks, and field notes.
// Enables cross-project knowledge sharing without submodules.
// ============================================================================

import { readdir, readFile, writeFile } from 'fs/promises';
import { join, basename, resolve, relative } from 'path';
import { homedir } from 'os';
import { existsSync } from 'fs';
import { log } from '../config.js';
import { ensureDir } from '../dataRoot.js';
import { emitCreateProvenance } from './provenance.js';

// ============================================================================
// Types
// ============================================================================

export type CorpusContentType = 'pattern' | 'playbook' | 'field-note';

export interface CorpusSearchInput {
  query: string;
  type?: CorpusContentType | 'all';
  limit?: number;
}

export interface CorpusMatch {
  id: string;
  path: string;
  type: CorpusContentType;
  title: string;
  snippet: string;
  relevance: number;
}

export interface CorpusSearchResult {
  matches: CorpusMatch[];
  query: string;
  searched: number;
  corpus_path: string;
}

export interface AddPatternInput {
  id: string;
  title: string;
  content: string;
  category?: string;
  status?: string;
  severity?: string;
  source?: string;
  owner?: string;
  tags?: string[];
}

export interface AddFieldNoteInput {
  title: string;
  content: string;
  source?: string;
  owner?: string;
  status?: string;
  tags?: string[];
}

export interface AddPlaybookInput {
  title: string;
  content: string;
  owner?: string;
  status?: string;
  tags?: string[];
}

export interface CorpusWriteResult {
  id: string;
  path: string;
  absolute_path: string;
  title: string;
}

// ============================================================================
// Configuration
// ============================================================================

// Corpus location - configurable via environment
const CORPUS_PATH = process.env.DECIBEL_CORPUS_PATH
  || join(homedir(), 'Documents/GitHub/decibel-corpus');

// Map content types to directory paths within corpus
const TYPE_PATHS: Record<CorpusContentType, string> = {
  'pattern': 'primitives/patterns',
  'playbook': 'playbooks',
  'field-note': 'field-notes',
};

const VALID_TYPES: (CorpusContentType | 'all')[] = ['pattern', 'playbook', 'field-note', 'all'];

// ============================================================================
// Helpers
// ============================================================================

/**
 * Recursively find all markdown files in a directory
 */
async function findMarkdownFiles(dir: string): Promise<string[]> {
  const results: string[] = [];

  try {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...await findMarkdownFiles(fullPath));
      } else if (entry.name.endsWith('.md') && !entry.name.startsWith('.')) {
        results.push(fullPath);
      }
    }
  } catch {
    // Directory doesn't exist, skip silently
  }

  return results;
}

/**
 * Extract title from markdown content
 * Tries YAML frontmatter first, then first H1
 */
function extractTitle(content: string): string | null {
  // Try YAML frontmatter title
  const frontmatterMatch = content.match(/^---\n[\s\S]*?title:\s*["']?(.+?)["']?\s*\n[\s\S]*?---/);
  if (frontmatterMatch) return frontmatterMatch[1].trim();

  // Try first H1
  const h1Match = content.match(/^#\s+(.+)$/m);
  if (h1Match) return h1Match[1].trim();

  return null;
}

/**
 * Extract a snippet around the first match of a term
 */
function extractSnippet(content: string, term: string): string {
  const lowerContent = content.toLowerCase();
  const idx = lowerContent.indexOf(term.toLowerCase());

  if (idx === -1) {
    // Just return first 200 chars after frontmatter
    const afterFrontmatter = content.replace(/^---\n[\s\S]*?---\n/, '');
    const cleaned = afterFrontmatter.replace(/^#+\s+.+\n/, '').trim();
    return cleaned.slice(0, 200).trim() + (cleaned.length > 200 ? '...' : '');
  }

  // Return ~100 chars around the match
  const start = Math.max(0, idx - 50);
  const end = Math.min(content.length, idx + 150);
  let snippet = content.slice(start, end).trim();

  // Clean up newlines for better display
  snippet = snippet.replace(/\n+/g, ' ');

  if (start > 0) snippet = '...' + snippet;
  if (end < content.length) snippet = snippet + '...';

  return snippet;
}

/**
 * Calculate relevance score based on term matches
 * Weights title matches higher than body matches
 */
function calculateRelevance(
  content: string,
  title: string | null,
  searchTerms: string[]
): number {
  const lowerContent = content.toLowerCase();
  const lowerTitle = (title || '').toLowerCase();
  let relevance = 0;

  for (const term of searchTerms) {
    // Title matches worth 3x
    const titleMatches = (lowerTitle.match(new RegExp(term, 'g')) || []).length;
    relevance += titleMatches * 3;

    // Body matches
    const bodyMatches = (lowerContent.match(new RegExp(term, 'g')) || []).length;
    relevance += bodyMatches;
  }

  return relevance;
}

// ============================================================================
// Main Search Function
// ============================================================================

/**
 * Search the decibel-corpus for patterns, playbooks, and field notes
 */
export async function corpusSearch(input: CorpusSearchInput): Promise<CorpusSearchResult> {
  const { query, type = 'all', limit = 5 } = input;

  if (!query || query.trim().length === 0) {
    throw new Error('Query cannot be empty');
  }

  if (!VALID_TYPES.includes(type)) {
    throw new Error(`Invalid type: ${type}. Must be one of: ${VALID_TYPES.join(', ')}`);
  }

  const searchTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 1);
  const matches: CorpusMatch[] = [];

  const typesToSearch: CorpusContentType[] = type === 'all'
    ? (Object.keys(TYPE_PATHS) as CorpusContentType[])
    : [type as CorpusContentType];

  let searched = 0;

  for (const t of typesToSearch) {
    const dirPath = join(CORPUS_PATH, TYPE_PATHS[t]);
    const files = await findMarkdownFiles(dirPath);

    for (const file of files) {
      searched++;

      try {
        const content = await readFile(file, 'utf-8');
        const title = extractTitle(content) || basename(file, '.md');
        const relevance = calculateRelevance(content, title, searchTerms);

        if (relevance > 0) {
          const snippet = extractSnippet(content, searchTerms[0]);

          matches.push({
            id: basename(file, '.md'),
            path: file.replace(CORPUS_PATH + '/', ''),
            type: t,
            title,
            snippet,
            relevance,
          });
        }
      } catch (err) {
        log(`Corpus: Error reading ${file}: ${err}`);
      }
    }
  }

  // Sort by relevance descending, take top N
  matches.sort((a, b) => b.relevance - a.relevance);

  log(`Corpus: Searched ${searched} files, found ${matches.length} matches for "${query}"`);

  return {
    matches: matches.slice(0, limit),
    query,
    searched,
    corpus_path: CORPUS_PATH,
  };
}

/**
 * Get the corpus path for display/debugging
 */
export function getCorpusPath(): string {
  return CORPUS_PATH;
}

/**
 * Check if corpus exists at the configured path
 */
export async function corpusExists(): Promise<boolean> {
  try {
    await readdir(CORPUS_PATH);
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Write Helpers
// ============================================================================

const PATTERN_ID_RE = /^[A-Z]+-\d{3,}$/;

/**
 * Slugify text for use in filenames.
 * Lowercases, replaces non-alphanumeric with dashes, trims dashes, max 80 chars.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/**
 * Build YAML frontmatter block from key-value pairs.
 * Handles arrays (tags) as YAML lists.
 */
function buildFrontmatter(fields: Record<string, string | string[] | undefined>): string {
  const lines: string[] = ['---'];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) {
        lines.push(`  - ${item}`);
      }
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  lines.push('---');
  return lines.join('\n');
}

/**
 * Validate that a target path is within CORPUS_PATH (prevents directory traversal).
 */
function validateCorpusWritePath(targetPath: string): void {
  const resolved = resolve(targetPath);
  const corpusResolved = resolve(CORPUS_PATH);
  if (!resolved.startsWith(corpusResolved + '/')) {
    throw new Error(
      `Path traversal rejected: target "${relative(corpusResolved, resolved)}" escapes corpus root`
    );
  }
}

/**
 * Validate that a category string has no traversal characters.
 */
function validateCategory(category: string): void {
  if (/[\/\\.]/.test(category)) {
    throw new Error(
      `Invalid category "${category}": must not contain slashes, backslashes, or dots`
    );
  }
}

// ============================================================================
// Write Functions
// ============================================================================

/**
 * Add a pattern to decibel-corpus.
 * Writes to primitives/patterns/{category?}/{id}-{slug}.md
 */
export async function addPattern(input: AddPatternInput): Promise<CorpusWriteResult> {
  if (!await corpusExists()) {
    throw new Error(
      `Corpus not found at ${CORPUS_PATH}. ` +
      'Clone decibel-corpus or set DECIBEL_CORPUS_PATH.'
    );
  }

  if (!PATTERN_ID_RE.test(input.id)) {
    throw new Error(
      `Invalid pattern id "${input.id}": must match PREFIX-NNNN format (e.g., DBS-0004)`
    );
  }

  const slug = slugify(input.title);
  const filename = `${input.id}-${slug}.md`;

  let targetDir = join(CORPUS_PATH, TYPE_PATHS['pattern']);
  if (input.category) {
    validateCategory(input.category);
    targetDir = join(targetDir, input.category);
  }
  ensureDir(targetDir);

  const targetPath = join(targetDir, filename);
  validateCorpusWritePath(targetPath);

  if (existsSync(targetPath)) {
    throw new Error(
      `Pattern already exists at ${relative(CORPUS_PATH, targetPath)}. ` +
      'Will not overwrite — edit the file directly if an update is needed.'
    );
  }

  const frontmatter = buildFrontmatter({
    id: input.id,
    title: input.title,
    status: input.status || 'draft',
    severity: input.severity,
    category: input.category,
    source: input.source,
    owner: input.owner,
    tags: input.tags,
    created: new Date().toISOString().slice(0, 10),
  });

  const fileContent = `${frontmatter}\n\n# ${input.title}\n\n${input.content}\n`;
  await writeFile(targetPath, fileContent, 'utf-8');

  const relPath = relative(CORPUS_PATH, targetPath);
  log(`Corpus: Added pattern ${input.id} at ${relPath}`);

  // Best-effort provenance
  try {
    await emitCreateProvenance(`corpus:pattern:${input.id}`, fileContent, `Added pattern ${input.id}: ${input.title}`);
  } catch {
    // No project context — that's fine for corpus
  }

  return {
    id: input.id,
    path: relPath,
    absolute_path: targetPath,
    title: input.title,
  };
}

/**
 * Add a field note to decibel-corpus.
 * Writes to field-notes/YYYY-MM-DD-{slug}.md
 */
export async function addFieldNote(input: AddFieldNoteInput): Promise<CorpusWriteResult> {
  if (!await corpusExists()) {
    throw new Error(
      `Corpus not found at ${CORPUS_PATH}. ` +
      'Clone decibel-corpus or set DECIBEL_CORPUS_PATH.'
    );
  }

  const slug = slugify(input.title);
  const date = new Date().toISOString().slice(0, 10);
  const filename = `${date}-${slug}.md`;

  const targetDir = join(CORPUS_PATH, TYPE_PATHS['field-note']);
  ensureDir(targetDir);

  const targetPath = join(targetDir, filename);
  validateCorpusWritePath(targetPath);

  if (existsSync(targetPath)) {
    throw new Error(
      `Field note already exists at ${relative(CORPUS_PATH, targetPath)}. ` +
      'Will not overwrite — edit the file directly if an update is needed.'
    );
  }

  const frontmatter = buildFrontmatter({
    title: input.title,
    status: input.status || 'draft',
    source: input.source,
    owner: input.owner,
    tags: input.tags,
    created: date,
  });

  const fileContent = `${frontmatter}\n\n# ${input.title}\n\n${input.content}\n`;
  await writeFile(targetPath, fileContent, 'utf-8');

  const relPath = relative(CORPUS_PATH, targetPath);
  const id = basename(filename, '.md');
  log(`Corpus: Added field note at ${relPath}`);

  try {
    await emitCreateProvenance(`corpus:field-note:${id}`, fileContent, `Added field note: ${input.title}`);
  } catch {
    // No project context — that's fine for corpus
  }

  return {
    id,
    path: relPath,
    absolute_path: targetPath,
    title: input.title,
  };
}

/**
 * Add a playbook to decibel-corpus.
 * Writes to playbooks/{slug}.md
 */
export async function addPlaybook(input: AddPlaybookInput): Promise<CorpusWriteResult> {
  if (!await corpusExists()) {
    throw new Error(
      `Corpus not found at ${CORPUS_PATH}. ` +
      'Clone decibel-corpus or set DECIBEL_CORPUS_PATH.'
    );
  }

  const slug = slugify(input.title);
  const filename = `${slug}.md`;

  const targetDir = join(CORPUS_PATH, TYPE_PATHS['playbook']);
  ensureDir(targetDir);

  const targetPath = join(targetDir, filename);
  validateCorpusWritePath(targetPath);

  if (existsSync(targetPath)) {
    throw new Error(
      `Playbook already exists at ${relative(CORPUS_PATH, targetPath)}. ` +
      'Will not overwrite — edit the file directly if an update is needed.'
    );
  }

  const frontmatter = buildFrontmatter({
    title: input.title,
    status: input.status || 'draft',
    owner: input.owner,
    tags: input.tags,
    created: new Date().toISOString().slice(0, 10),
  });

  const fileContent = `${frontmatter}\n\n# ${input.title}\n\n${input.content}\n`;
  await writeFile(targetPath, fileContent, 'utf-8');

  const relPath = relative(CORPUS_PATH, targetPath);
  log(`Corpus: Added playbook at ${relPath}`);

  try {
    await emitCreateProvenance(`corpus:playbook:${slug}`, fileContent, `Added playbook: ${input.title}`);
  } catch {
    // No project context — that's fine for corpus
  }

  return {
    id: slug,
    path: relPath,
    absolute_path: targetPath,
    title: input.title,
  };
}
