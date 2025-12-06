import fs from 'fs/promises';
import path from 'path';
import { stringify as stringifyYaml } from 'yaml';
import { resolveProjectRoot } from './projectPaths.js';
import { log } from './config.js';

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
// Helpers
// ============================================================================

/**
 * Get the ADRs directory for a project
 */
async function getAdrsDir(projectId: string): Promise<string> {
  const project = await resolveProjectRoot(projectId);
  return path.join(project.root, '.decibel', 'architect', 'adrs');
}

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
 * Get the next ADR number by scanning existing files
 */
async function getNextAdrNumber(adrsDir: string): Promise<number> {
  let maxNum = 0;

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
    // Directory doesn't exist, start from 0
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

  const adrsDir = await getAdrsDir(projectId);
  await ensureDir(adrsDir);

  // Get next ADR number
  const nextNum = await getNextAdrNumber(adrsDir);
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
