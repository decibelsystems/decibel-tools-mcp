import fs from 'fs/promises';
import path from 'path';
import { getConfig, log } from '../config.js';

export type Severity = 'low' | 'med' | 'high' | 'critical';

export interface CreateIssueInput {
  repo: string;
  severity: Severity;
  title: string;
  details: string;
}

export interface CreateIssueOutput {
  id: string;
  timestamp: string;
  path: string;
  status: string;
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

export async function createIssue(
  input: CreateIssueInput
): Promise<CreateIssueOutput> {
  const config = getConfig();
  const now = new Date();
  const timestamp = now.toISOString();
  const fileTimestamp = formatTimestampForFilename(now);
  const slug = slugify(input.title);
  const filename = `${fileTimestamp}-${slug}.md`;

  const dirPath = path.join(config.rootDir, 'sentinel', input.repo, 'issues');
  const filePath = path.join(dirPath, filename);

  // Create directory if it doesn't exist
  await fs.mkdir(dirPath, { recursive: true });

  // Build markdown content with frontmatter
  const frontmatter = [
    '---',
    `repo: ${input.repo}`,
    `severity: ${input.severity}`,
    `status: open`,
    `created_at: ${timestamp}`,
    '---',
  ].join('\n');

  const body = [
    `# ${input.title}`,
    '',
    `**Severity:** ${input.severity}`,
    `**Status:** open`,
    '',
    '## Details',
    '',
    input.details,
  ].join('\n');

  const content = `${frontmatter}\n\n${body}\n`;

  await fs.writeFile(filePath, content, 'utf-8');
  log(`Sentinel: Created issue at ${filePath}`);

  return {
    id: filename,
    timestamp,
    path: filePath,
    status: 'open',
  };
}
