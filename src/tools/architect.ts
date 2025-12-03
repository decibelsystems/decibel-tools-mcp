import fs from 'fs/promises';
import path from 'path';
import { getConfig, log } from '../config.js';

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

export async function recordArchDecision(
  input: RecordArchDecisionInput
): Promise<RecordArchDecisionOutput> {
  const config = getConfig();
  const now = new Date();
  const timestamp = now.toISOString();
  const fileTimestamp = formatTimestampForFilename(now);
  const slug = slugify(input.change);
  const filename = `${fileTimestamp}-${slug}.md`;

  const dirPath = path.join(config.rootDir, 'architect', input.system_id);
  const filePath = path.join(dirPath, filename);

  // Create directory if it doesn't exist
  await fs.mkdir(dirPath, { recursive: true });

  // Build ADR-style markdown content
  const frontmatter = [
    '---',
    `system_id: ${input.system_id}`,
    `change: ${input.change}`,
    `timestamp: ${timestamp}`,
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
  log(`Architect: Recorded architecture decision to ${filePath}`);

  return {
    id: filename,
    timestamp,
    path: filePath,
  };
}
