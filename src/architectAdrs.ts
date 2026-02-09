import fs from 'fs/promises';
import path from 'path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
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
        if (!file.endsWith('.yml') && !file.endsWith('.yaml')) continue;
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

  // Build filename
  const slug = slugify(title);
  const filename = `${id}-${slug}.yml`;
  const filePath = path.join(adrsDir, filename);

  // Build YAML content
  const now = new Date().toISOString();
  const yamlObj: Record<string, unknown> = {
    id,
    scope: 'project',
    project: projectId,
    title,
    status: 'accepted',
    created_at: now,
    updated_at: now,
    context,
    decision,
    consequences,
  };

  if (relatedIssues && relatedIssues.length > 0) {
    yamlObj.related_issues = relatedIssues;
  }

  if (relatedEpics && relatedEpics.length > 0) {
    yamlObj.related_epics = relatedEpics;
  }

  const yamlContent = stringifyYaml(yamlObj, {
    lineWidth: 0, // Don't wrap lines
  });

  // Write file
  await fs.writeFile(filePath, yamlContent, 'utf-8');
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
  const files = await readFilesFromBothPaths(projectId, ADRS_SUBPATH, ['.yml', '.yaml']);
  const adrs: Array<{ id: string; title: string; status: string; filename: string }> = [];

  for (const { filePath } of files) {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const parsed = parseYaml(content) as Record<string, unknown>;
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
  const files = await readFilesFromBothPaths(projectId, ADRS_SUBPATH, ['.yml', '.yaml']);
  const normalizedId = adrId.toUpperCase();

  for (const { filePath } of files) {
    const basename = path.basename(filePath).toUpperCase();
    if (basename.startsWith(normalizedId)) {
      const content = await fs.readFile(filePath, 'utf-8');
      return parseYaml(content) as Record<string, unknown>;
    }
  }

  return null;
}
