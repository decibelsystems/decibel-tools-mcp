import fs from 'fs/promises';
import path from 'path';
import { log } from '../config.js';
import { ensureDir } from '../dataRoot.js';
import { resolveProjectPaths, validateWritePath, ResolvedProjectPaths } from '../projectRegistry.js';

// ============================================================================
// Project Resolution Error
// ============================================================================

export interface ProjectResolutionError {
  error: 'project_resolution_failed';
  message: string;
  hint: string;
}

function makeProjectResolutionError(operation: string): ProjectResolutionError {
  return {
    error: 'project_resolution_failed',
    message: `Cannot ${operation}: No project context available.`,
    hint:
      'Either specify projectId parameter, set DECIBEL_PROJECT_ROOT env var, or run from a directory containing .decibel/',
  };
}

// ============================================================================
// Types
// ============================================================================

export interface RecordArchDecisionInput {
  projectId?: string;  // optional project ID, uses default if not specified
  change: string;
  rationale: string;
  impact?: string;
}

export interface RecordArchDecisionOutput {
  id: string;
  timestamp: string;
  path: string;
  location: 'project';  // Always project-local now
}

// ============================================================================
// Helpers
// ============================================================================

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50);
}

function formatTimestampForFilename(date: Date): string {
  // Format: YYYY-MM-DDTHH-mm-ssZ
  const iso = date.toISOString();
  return iso
    .replace(/:/g, '-')
    .replace(/\.\\d{3}Z$/, 'Z');
}

// ============================================================================
// Functions
// ============================================================================

export async function recordArchDecision(
  input: RecordArchDecisionInput
): Promise<RecordArchDecisionOutput | ProjectResolutionError> {
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.projectId);
  } catch (err) {
    return makeProjectResolutionError('record architecture decision');
  }

  const now = new Date();
  const timestamp = now.toISOString();
  const fileTimestamp = formatTimestampForFilename(now);
  const slug = slugify(input.change);
  const filename = `${fileTimestamp}-${slug}.md`;

  // Always use project-local storage under .decibel/architect/adrs/
  const dirPath = resolved.subPath('architect', 'adrs');
  const filePath = path.join(dirPath, filename);

  ensureDir(dirPath);

  // Build ADR-style markdown content
  const frontmatter = [
    '---',
    `projectId: ${resolved.id}`,
    `change: ${input.change}`,
    `timestamp: ${timestamp}`,
    `location: project`,
    '---',
  ].join('\n');

  const sections = [
    `# ADR: ${input.change}`,
    '',
    '## Change',
    '',
    input.change,
    '',
    '## Rationale',
    '',
    input.rationale,
    '',
    '## Impact',
    '',
    input.impact || 'No specific impact documented.',
  ].join('\n');

  const content = `${frontmatter}\n\n${sections}\n`;

  validateWritePath(filePath, resolved);
  await fs.writeFile(filePath, content, 'utf-8');
  log(`Architect: Recorded architecture decision to ${filePath} (project: ${resolved.id})`);

  return {
    id: filename,
    timestamp,
    path: filePath,
    location: 'project',
  };
}
