import fs from 'fs/promises';
import path from 'path';
import { getConfig, log } from '../config.js';

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
): Promise<RecordDesignDecisionOutput> {
  const config = getConfig();
  const now = new Date();
  const timestamp = now.toISOString();
  const fileTimestamp = formatTimestampForFilename(now);
  const slug = slugify(input.summary);
  const filename = `${fileTimestamp}-${slug}.md`;

  const dirPath = path.join(config.rootDir, 'designer', input.project_id);
  const filePath = path.join(dirPath, filename);

  // Create directory if it doesn't exist
  await fs.mkdir(dirPath, { recursive: true });

  // Build markdown content
  const frontmatter = [
    '---',
    `project_id: ${input.project_id}`,
    `area: ${input.area}`,
    `summary: ${input.summary}`,
    `timestamp: ${timestamp}`,
    '---',
  ].join('\n');

  const body = input.details || input.summary;
  const content = `${frontmatter}\n\n# ${input.summary}\n\n${body}\n`;

  await fs.writeFile(filePath, content, 'utf-8');
  log(`Designer: Recorded design decision to ${filePath}`);

  return {
    id: filename,
    timestamp,
    path: filePath,
  };
}
