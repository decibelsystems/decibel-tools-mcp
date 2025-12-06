import fs from 'fs/promises';
import path from 'path';
import { log } from '../config.js';
import { resolvePath, ensureDir, hasProjectLocal } from '../dataRoot.js';

export interface RecordDesignDecisionInput {
  project_id: string;
  area: string;
  summary: string;
  details?: string;
}

export interface RecordDesignDecisionOutput {
  id: string;
  timestamp: string;
  path: string;
  location: 'project' | 'global';
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
    .replace(/\.\\d{3}Z$/, 'Z');
}

// Known global project IDs (design decisions about the tooling itself)
const GLOBAL_PROJECTS = [
  'decibel-tools-mcp',
  'decibel-tools',
  'decibel-ecosystem',
];

export async function recordDesignDecision(
  input: RecordDesignDecisionInput
): Promise<RecordDesignDecisionOutput> {
  const now = new Date();
  const timestamp = now.toISOString();
  const fileTimestamp = formatTimestampForFilename(now);
  const slug = slugify(input.summary);
  const filename = `${fileTimestamp}-${slug}.md`;

  // Determine if this is a global design decision or project-specific
  const isGlobalProject = GLOBAL_PROJECTS.includes(input.project_id.toLowerCase());

  let dirPath: string;
  let location: 'project' | 'global';

  if (isGlobalProject) {
    // Always use global for tooling design decisions
    const baseDir = resolvePath('designer-global');
    dirPath = path.join(baseDir, input.project_id);
    location = 'global';
  } else if (hasProjectLocal()) {
    // Use project-local for project-specific design decisions
    const baseDir = resolvePath('designer-project');
    dirPath = path.join(baseDir, input.area);
    location = 'project';
  } else {
    // Fallback to global with project_id namespace
    const baseDir = resolvePath('designer-global');
    dirPath = path.join(baseDir, input.project_id);
    location = 'global';
  }

  const filePath = path.join(dirPath, filename);
  ensureDir(dirPath);

  // Build markdown content
  const frontmatter = [
    '---',
    `project_id: ${input.project_id}`,
    `area: ${input.area}`,
    `summary: ${input.summary}`,
    `timestamp: ${timestamp}`,
    `location: ${location}`,
    '---',
  ].join('\n');

  const body = input.details || input.summary;
  const content = `${frontmatter}\n\n# ${input.summary}\n\n${body}\n`;

  await fs.writeFile(filePath, content, 'utf-8');
  log(`Designer: Recorded design decision to ${filePath} (${location})`);

  return {
    id: filename,
    timestamp,
    path: filePath,
    location,
  };
}
