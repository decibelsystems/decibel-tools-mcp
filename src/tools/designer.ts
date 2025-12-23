import fs from 'fs/promises';
import path from 'path';
import { log } from '../config.js';
import { ensureDir } from '../dataRoot.js';
import { resolveProjectPaths, validateWritePath, ResolvedProjectPaths } from '../projectRegistry.js';
import { emitCreateProvenance } from './provenance.js';

// ============================================================================
// Project Resolution Error
// ============================================================================

export interface DesignerError {
  error: string;
  message: string;
  hint?: string;
}

function makeProjectError(operation: string): DesignerError {
  return {
    error: 'PROJECT_NOT_FOUND',
    message: `Cannot ${operation}: No project context available.`,
    hint: 'Specify projectId parameter, set DECIBEL_PROJECT_ROOT env var, or run from a directory with .decibel/',
  };
}

export function isDesignerError(result: unknown): result is DesignerError {
  return (
    typeof result === 'object' &&
    result !== null &&
    'error' in result &&
    'message' in result
  );
}

export interface RecordDesignDecisionInput {
  projectId?: string;  // optional, uses project resolution
  area: string;
  summary: string;
  details?: string;
}

export interface RecordDesignDecisionOutput {
  id: string;
  timestamp: string;
  path: string;
  location: 'project';
}

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
    .replace(/\.\d{3}Z$/, 'Z');
}

export async function recordDesignDecision(
  input: RecordDesignDecisionInput
): Promise<RecordDesignDecisionOutput | DesignerError> {
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.projectId);
  } catch {
    return makeProjectError('record design decision');
  }

  const now = new Date();
  const timestamp = now.toISOString();
  const fileTimestamp = formatTimestampForFilename(now);
  const slug = slugify(input.summary);
  const filename = `${fileTimestamp}-${slug}.md`;

  // Store in .decibel/designer/<area>/
  const dirPath = resolved.subPath('designer', input.area);
  ensureDir(dirPath);

  const filePath = path.join(dirPath, filename);

  // Build markdown content
  const frontmatter = [
    '---',
    `project_id: ${resolved.id}`,
    `area: ${input.area}`,
    `summary: ${input.summary}`,
    `timestamp: ${timestamp}`,
    `location: project`,
    '---',
  ].join('\n');

  const body = input.details || input.summary;
  const content = `${frontmatter}\n\n# ${input.summary}\n\n${body}\n`;

  validateWritePath(filePath, resolved);
  await fs.writeFile(filePath, content, 'utf-8');
  log(`Designer: Recorded design decision to ${filePath} (project: ${resolved.id})`);

  // Emit provenance event for this creation
  await emitCreateProvenance(
    `designer:decision:${filename}`,
    content,
    `Created design decision: ${input.summary}`,
    input.projectId
  );

  return {
    id: filename,
    timestamp,
    path: filePath,
    location: 'project',
  };
}
