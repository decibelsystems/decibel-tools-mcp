import fs from 'fs/promises';
import path from 'path';
import { log } from '../config.js';
import { resolvePath, ensureDir, hasProjectLocal } from '../dataRoot.js';

export interface RecordArchDecisionInput {
  system_id: string;
  change: string;
  rationale: string;
  impact?: string;
}

export interface RecordArchDecisionOutput {
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

// Known global system IDs (ADRs about the tooling itself)
const GLOBAL_SYSTEMS = [
  'decibel-tools-mcp',
  'decibel-tools',
  'decibel-ecosystem',
  'mcp',
];

export async function recordArchDecision(
  input: RecordArchDecisionInput
): Promise<RecordArchDecisionOutput> {
  const now = new Date();
  const timestamp = now.toISOString();
  const fileTimestamp = formatTimestampForFilename(now);
  const slug = slugify(input.change);
  const filename = `${fileTimestamp}-${slug}.md`;

  // Determine if this is a global ADR (about tooling) or project ADR
  const isGlobalSystem = GLOBAL_SYSTEMS.includes(input.system_id.toLowerCase());
  
  let dirPath: string;
  let location: 'project' | 'global';

  if (isGlobalSystem) {
    // Always use global for tooling ADRs
    const baseDir = resolvePath('architect-global');
    dirPath = path.join(baseDir, input.system_id);
    location = 'global';
  } else if (hasProjectLocal()) {
    // Use project-local for project-specific ADRs
    const baseDir = resolvePath('architect-project');
    dirPath = path.join(baseDir, input.system_id);
    location = 'project';
  } else {
    // Fallback to global with system_id namespace
    const baseDir = resolvePath('architect-global');
    dirPath = path.join(baseDir, input.system_id);
    location = 'global';
  }

  const filePath = path.join(dirPath, filename);
  ensureDir(dirPath);

  // Build ADR-style markdown content
  const frontmatter = [
    '---',
    `system_id: ${input.system_id}`,
    `change: ${input.change}`,
    `timestamp: ${timestamp}`,
    `location: ${location}`,
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

  await fs.writeFile(filePath, content, 'utf-8');
  log(`Architect: Recorded architecture decision to ${filePath} (${location})`);

  return {
    id: filename,
    timestamp,
    path: filePath,
    location,
  };
}
