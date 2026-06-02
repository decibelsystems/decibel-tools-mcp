import fs from 'fs/promises';
import path from 'path';
import { parse as parseYaml } from 'yaml';
import { log } from './config.js';
import { getWritePath, getAllReadPaths, readFilesFromBothPaths } from './decibelPaths.js';

// ============================================================================
// Types
// ============================================================================

export type AdrStatus = 'proposed' | 'accepted' | 'superseded' | 'deprecated';

export interface AdrInput {
  projectId: string;
  title: string;
  context: string;
  decision: string;
  consequences: string;
  relatedIssues?: string[];
  relatedEpics?: string[];
}

export interface AdrOutput {
  id: string;
  path: string;
}

// ============================================================================
// Constants
// ============================================================================

const ADRS_SUBPATH = 'architect/adrs';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Slugify a title for use in filename
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50);
}

/**
 * Extract numeric suffix from ADR ID (e.g., "ADR-0007" -> 7)
 */
function extractAdrNumber(id: string): number {
  const match = id.match(/^ADR-(\d+)$/i);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * Format ADR ID with zero-padding
 */
function formatAdrId(num: number): string {
  return `ADR-${num.toString().padStart(4, '0')}`;
}

/**
 * Ensure directory exists
 */
async function ensureDir(dirPath: string): Promise<void> {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch {
    // Directory already exists or other error
  }
}

/**
 * Get the next ADR number by scanning existing files in both paths
 */
async function getNextAdrNumber(projectId: string): Promise<number> {
  let maxNum = 0;

  // Check both .decibel/ and decibel/ paths
  const readPaths = await getAllReadPaths(projectId, ADRS_SUBPATH);

  for (const adrsDir of readPaths) {
    try {
      const files = await fs.readdir(adrsDir);
      for (const file of files) {
        if (!/\.(ya?ml|md)$/i.test(file)) continue;
        const match = file.match(/^ADR-(\d+)/i);
        if (match) {
          const num = parseInt(match[1], 10);
          if (num > maxNum) maxNum = num;
        }
      }
    } catch {
      // Directory doesn't exist, continue
    }
  }

  return maxNum + 1;
}

/**
 * Split a markdown body into its `## Section` → text map (lowercased keys).
 */
function parseSections(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  const parts = body.split(/^##\s+/m);
  for (let i = 1; i < parts.length; i++) {
    const seg = parts[i];
    const nl = seg.indexOf('\n');
    const name = (nl === -1 ? seg : seg.slice(0, nl)).trim().toLowerCase();
    out[name] = (nl === -1 ? '' : seg.slice(nl + 1)).trim();
  }
  return out;
}

/**
 * Parse an ADR file into a uniform record, handling BOTH the new markdown shape
 * (frontmatter + ## Context/## Decision/## Consequences) AND legacy .yml ADRs.
 * Exported so tests and external readers can assert against the canonical
 * uniform shape rather than having to know which on-disk format produced the file.
 */
export function parseAdrContent(filename: string, content: string): Record<string, unknown> {
  if (/\.ya?ml$/i.test(filename)) {
    return (parseYaml(content) as Record<string, unknown>) ?? {};
  }
  let fm: Record<string, unknown> = {};
  let body = content;
  const m = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (m) {
    try { fm = (parseYaml(m[1]) as Record<string, unknown>) ?? {}; } catch { fm = {}; }
    body = content.slice(m[0].length);
  }
  const heading = body.match(/^#\s+(.+)$/m);
  const sections = parseSections(body);
  const idFromName = path.basename(filename).match(/^ADR-\d+/i)?.[0];
  return {
    id: fm.id ?? idFromName ?? path.basename(filename, path.extname(filename)),
    scope: fm.scope ?? 'project',
    project: fm.project ?? fm.projectId,
    title: fm.title ?? (heading ? heading[1].trim() : '(untitled)'),
    status: fm.status ?? 'accepted',
    created_at: fm.created_at,
    updated_at: fm.updated_at,
    context: sections['context'] ?? '',
    decision: sections['decision'] ?? '',
    consequences: sections['consequences'] ?? '',
    related_issues: fm.related_issues,
    related_epics: fm.related_epics,
  };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Create a new project-level ADR
 */
export async function createProjectAdr(input: AdrInput): Promise<AdrOutput> {
  const {
    projectId,
    title,
    context,
    decision,
    consequences,
    relatedIssues,
    relatedEpics,
  } = input;

  // Always write to .decibel/ (primary path)
  const adrsDir = await getWritePath(projectId, ADRS_SUBPATH);
  await ensureDir(adrsDir);

  // Get next ADR number (checks both paths to avoid ID conflicts)
  const nextNum = await getNextAdrNumber(projectId);
  const id = formatAdrId(nextNum);

  // Build filename — unified .md (frontmatter metadata + ## prose sections).
  // Legacy ADR-*.yml stays readable (see parseAdrContent); new ADRs are markdown.
  const slug = slugify(title);
  const filename = `${id}-${slug}.md`;
  const filePath = path.join(adrsDir, filename);

  const now = new Date().toISOString();
  const fmLines = [
    '---',
    `id: ${id}`,
    `projectId: ${projectId}`,
    `status: accepted`,
    `created_at: ${now}`,
    `updated_at: ${now}`,
  ];
  if (relatedIssues && relatedIssues.length > 0) {
    fmLines.push(`related_issues: [${relatedIssues.join(', ')}]`);
  }
  if (relatedEpics && relatedEpics.length > 0) {
    fmLines.push(`related_epics: [${relatedEpics.join(', ')}]`);
  }
  fmLines.push('---');

  const body = [
    `# ${title}`,
    '',
    '## Context',
    '',
    context,
    '',
    '## Decision',
    '',
    decision,
    '',
    '## Consequences',
    '',
    consequences,
  ].join('\n');

  const content = `${fmLines.join('\n')}\n\n${body}\n`;

  await fs.writeFile(filePath, content, 'utf-8');
  log(`architectAdrs: Created ADR at ${filePath}`);

  return {
    id,
    path: filePath,
  };
}

/**
 * List ADRs for a project (ID + title + status)
 */
export async function listProjectAdrs(projectId: string): Promise<Array<{
  id: string;
  title: string;
  status: string;
  filename: string;
}>> {
  const files = await readFilesFromBothPaths(projectId, ADRS_SUBPATH, ['.yml', '.yaml', '.md']);
  const adrs: Array<{ id: string; title: string; status: string; filename: string }> = [];

  for (const { filePath } of files) {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const parsed = parseAdrContent(path.basename(filePath), content);
      adrs.push({
        id: (parsed.id as string) ?? path.basename(filePath, path.extname(filePath)),
        title: (parsed.title as string) ?? '(untitled)',
        status: (parsed.status as string) ?? 'unknown',
        filename: path.basename(filePath),
      });
    } catch {
      // Skip unparseable files
    }
  }

  adrs.sort((a, b) => extractAdrNumber(a.id) - extractAdrNumber(b.id));
  return adrs;
}

/**
 * Read a single ADR by ID (e.g., "ADR-0005") or partial match
 */
export async function readProjectAdr(
  projectId: string,
  adrId: string,
): Promise<Record<string, unknown> | null> {
  const files = await readFilesFromBothPaths(projectId, ADRS_SUBPATH, ['.yml', '.yaml', '.md']);
  const normalizedId = adrId.toUpperCase();

  for (const { filePath } of files) {
    const basename = path.basename(filePath).toUpperCase();
    if (basename.startsWith(normalizedId)) {
      const content = await fs.readFile(filePath, 'utf-8');
      return parseAdrContent(path.basename(filePath), content);
    }
  }

  return null;
}
