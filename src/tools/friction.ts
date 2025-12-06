import fs from 'fs/promises';
import path from 'path';
import { log } from '../config.js';
import { resolvePath, ensureDir } from '../dataRoot.js';

// ============================================================================
// Types
// ============================================================================

export type FrictionSource = 'human' | 'agent';
export type FrictionFrequency = 'once' | 'occasional' | 'frequent' | 'constant';
export type FrictionImpact = 'low' | 'medium' | 'high' | 'blocking';
export type FrictionStatus = 'open' | 'acknowledged' | 'solving' | 'resolved' | 'wontfix';

export interface LogFrictionInput {
  context: string;  // project, repo, or system where friction occurs
  description: string;
  frequency?: FrictionFrequency;
  impact?: FrictionImpact;
  source?: FrictionSource;
  tags?: string[];
  workaround?: string;  // any current workaround being used
}

export interface LogFrictionOutput {
  id: string;
  timestamp: string;
  path: string;
  context: string;
  signal_strength: number;  // how many times similar friction logged
}

export interface ListFrictionInput {
  context?: string;
  status?: FrictionStatus;
  min_impact?: FrictionImpact;
  source?: FrictionSource;
  limit?: number;
}

export interface FrictionSummary {
  id: string;
  context: string;
  description: string;
  frequency: FrictionFrequency;
  impact: FrictionImpact;
  status: FrictionStatus;
  signal_count: number;
  last_reported: string;
  tags: string[];
}

export interface ListFrictionOutput {
  friction: FrictionSummary[];
  total_count: number;
}

export interface ResolveFrictionInput {
  friction_id: string;
  resolution: string;
  solution_ref?: string;  // optional link to issue, ADR, or commit that solved it
  status?: 'resolved' | 'wontfix';
}

export interface ResolveFrictionOutput {
  id: string;
  path: string;
  status: FrictionStatus;
  resolved_at: string;
}

export interface BumpFrictionInput {
  friction_id: string;
  source?: FrictionSource;
  note?: string;
}

export interface BumpFrictionOutput {
  id: string;
  signal_count: number;
  last_reported: string;
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
  const iso = date.toISOString();
  return iso.replace(/:/g, '-').replace(/\.\\d{3}Z$/, 'Z');
}

const impactOrder: Record<FrictionImpact, number> = {
  low: 1,
  medium: 2,
  high: 3,
  blocking: 4,
};

async function parseFrictionFile(filePath: string): Promise<FrictionSummary | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) return null;

    const frontmatter: Record<string, string | string[]> = {};
    for (const line of frontmatterMatch[1].split('\n')) {
      const colonIndex = line.indexOf(':');
      if (colonIndex > 0) {
        const key = line.slice(0, colonIndex).trim();
        let value = line.slice(colonIndex + 1).trim();

        if (value.startsWith('[') && value.endsWith(']')) {
          frontmatter[key] = value
            .slice(1, -1)
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
        } else {
          frontmatter[key] = value;
        }
      }
    }

    // Extract description from first paragraph after frontmatter
    const bodyMatch = content.match(/---\n\n# .+\n\n([\s\S]*?)(?=\n## |$)/);
    const description = bodyMatch ? bodyMatch[1].trim().split('\n')[0] : '';

    return {
      id: path.basename(filePath, '.md'),
      context: (frontmatter.context as string) || '',
      description,
      frequency: (frontmatter.frequency as FrictionFrequency) || 'occasional',
      impact: (frontmatter.impact as FrictionImpact) || 'medium',
      status: (frontmatter.status as FrictionStatus) || 'open',
      signal_count: parseInt(frontmatter.signal_count as string, 10) || 1,
      last_reported: (frontmatter.last_reported as string) || '',
      tags: (frontmatter.tags as string[]) || [],
    };
  } catch {
    return null;
  }
}

async function findFrictionFile(frictionId: string): Promise<string | null> {
  // Friction is always global
  const frictionDir = resolvePath('friction-global');

  try {
    const files = await fs.readdir(frictionDir);
    
    // Exact match
    const exact = files.find(f => f === frictionId || f === `${frictionId}.md`);
    if (exact) return path.join(frictionDir, exact);

    // Partial match
    const partial = files.find(f => f.toLowerCase().includes(frictionId.toLowerCase()));
    if (partial) return path.join(frictionDir, partial);

    return null;
  } catch {
    return null;
  }
}

// ============================================================================
// Functions
// ============================================================================

export async function logFriction(input: LogFrictionInput): Promise<LogFrictionOutput> {
  const now = new Date();
  const timestamp = now.toISOString();
  const fileTimestamp = formatTimestampForFilename(now);

  // Friction is always global (cross-project by nature)
  const frictionDir = resolvePath('friction-global');
  ensureDir(frictionDir);

  const slug = slugify(input.description);
  const filename = `${fileTimestamp}-${slug}.md`;
  const filePath = path.join(frictionDir, filename);

  const frequency = input.frequency || 'occasional';
  const impact = input.impact || 'medium';
  const source = input.source || 'human';
  const tags = input.tags || [];

  // Check for similar existing friction (same context + similar description)
  let signalStrength = 1;
  try {
    const existingFiles = await fs.readdir(frictionDir);
    for (const file of existingFiles) {
      if (!file.endsWith('.md')) continue;
      const existing = await parseFrictionFile(path.join(frictionDir, file));
      if (existing && 
          existing.context === input.context && 
          existing.status === 'open' &&
          (existing.description.toLowerCase().includes(slug.replace(/-/g, ' ')) ||
           slug.replace(/-/g, ' ').includes(existing.description.toLowerCase().substring(0, 20)))) {
        signalStrength++;
      }
    }
  } catch {
    // Directory doesn't exist yet
  }

  // Build frontmatter
  const frontmatter = [
    '---',
    `context: ${input.context}`,
    `frequency: ${frequency}`,
    `impact: ${impact}`,
    `status: open`,
    `source: ${source}`,
    `signal_count: 1`,
    `created_at: ${timestamp}`,
    `last_reported: ${timestamp}`,
    `tags: [${tags.join(', ')}]`,
    '---',
  ].join('\n');

  // Build body
  const bodyLines = [
    `# ${input.description}`,
    '',
    input.description,
    '',
    '## Context',
    '',
    `**Where:** ${input.context}`,
    `**Frequency:** ${frequency}`,
    `**Impact:** ${impact}`,
    `**Reported by:** ${source}`,
  ];

  if (input.workaround) {
    bodyLines.push('', '## Current Workaround', '', input.workaround);
  }

  bodyLines.push('', '## Signal Log', '', `- ${timestamp} [${source}] Initial report`);

  const content = `${frontmatter}\n\n${bodyLines.join('\n')}\n`;

  await fs.writeFile(filePath, content, 'utf-8');
  log(`Friction: Logged friction at ${filePath} (global)`);

  return {
    id: filename.replace('.md', ''),
    timestamp,
    path: filePath,
    context: input.context,
    signal_strength: signalStrength,
  };
}

export async function listFriction(input: ListFrictionInput): Promise<ListFrictionOutput> {
  const frictionDir = resolvePath('friction-global');
  const limit = input.limit || 20;

  let frictionList: FrictionSummary[] = [];

  try {
    const files = await fs.readdir(frictionDir);
    
    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      
      const filePath = path.join(frictionDir, file);
      const friction = await parseFrictionFile(filePath);
      if (!friction) continue;

      // Apply filters
      if (input.context && friction.context !== input.context) continue;
      if (input.status && friction.status !== input.status) continue;
      if (input.source) {
        // Would need to check file content for source filter
      }
      if (input.min_impact && impactOrder[friction.impact] < impactOrder[input.min_impact]) continue;

      frictionList.push(friction);
    }
  } catch {
    // Directory doesn't exist
  }

  const totalCount = frictionList.length;

  // Sort by impact (desc), then signal_count (desc), then last_reported (desc)
  frictionList.sort((a, b) => {
    const impactDiff = impactOrder[b.impact] - impactOrder[a.impact];
    if (impactDiff !== 0) return impactDiff;
    
    const signalDiff = b.signal_count - a.signal_count;
    if (signalDiff !== 0) return signalDiff;
    
    return b.last_reported.localeCompare(a.last_reported);
  });

  // Apply limit
  frictionList = frictionList.slice(0, limit);

  return {
    friction: frictionList,
    total_count: totalCount,
  };
}

export async function resolveFriction(input: ResolveFrictionInput): Promise<ResolveFrictionOutput | { error: string }> {
  const filePath = await findFrictionFile(input.friction_id);
  
  if (!filePath) {
    return { error: `Friction not found: ${input.friction_id}` };
  }

  const content = await fs.readFile(filePath, 'utf-8');
  const now = new Date();
  const resolvedAt = now.toISOString();
  const newStatus = input.status || 'resolved';

  // Update frontmatter
  let updatedContent = content.replace(
    /^(---\n[\s\S]*?)status: \w+/m,
    `$1status: ${newStatus}`
  );

  // Add resolved_at to frontmatter
  if (!updatedContent.includes('resolved_at:')) {
    updatedContent = updatedContent.replace(
      /^(---\n[\s\S]*?)(---)$/m,
      `$1resolved_at: ${resolvedAt}\n$2`
    );
  }

  // Add resolution section
  const resolutionSection = [
    '',
    '## Resolution',
    '',
    input.resolution,
  ];

  if (input.solution_ref) {
    resolutionSection.push('', `**Solution Reference:** ${input.solution_ref}`);
  }

  resolutionSection.push('', `**Resolved:** ${resolvedAt}`);

  if (updatedContent.includes('## Resolution')) {
    updatedContent = updatedContent.replace(
      /## Resolution[\s\S]*$/,
      resolutionSection.join('\n') + '\n'
    );
  } else {
    updatedContent = updatedContent.trimEnd() + '\n' + resolutionSection.join('\n') + '\n';
  }

  await fs.writeFile(filePath, updatedContent, 'utf-8');
  log(`Friction: Resolved friction at ${filePath}`);

  return {
    id: path.basename(filePath, '.md'),
    path: filePath,
    status: newStatus,
    resolved_at: resolvedAt,
  };
}

export async function bumpFriction(input: BumpFrictionInput): Promise<BumpFrictionOutput | { error: string }> {
  const filePath = await findFrictionFile(input.friction_id);
  
  if (!filePath) {
    return { error: `Friction not found: ${input.friction_id}` };
  }

  const content = await fs.readFile(filePath, 'utf-8');
  const now = new Date();
  const timestamp = now.toISOString();
  const source = input.source || 'human';

  // Parse current signal_count
  const signalMatch = content.match(/signal_count: (\d+)/);
  const currentCount = signalMatch ? parseInt(signalMatch[1], 10) : 1;
  const newCount = currentCount + 1;

  // Update frontmatter
  let updatedContent = content
    .replace(/signal_count: \d+/, `signal_count: ${newCount}`)
    .replace(/last_reported: .+/, `last_reported: ${timestamp}`);

  // Add to signal log
  const logEntry = input.note 
    ? `- ${timestamp} [${source}] ${input.note}`
    : `- ${timestamp} [${source}] Bump`;

  updatedContent = updatedContent.replace(
    /(## Signal Log\n\n)([\s\S]*?)(\n\n## |$)/,
    `$1$2\n${logEntry}$3`
  );

  await fs.writeFile(filePath, updatedContent, 'utf-8');
  log(`Friction: Bumped friction at ${filePath} (signal: ${newCount})`);

  return {
    id: path.basename(filePath, '.md'),
    signal_count: newCount,
    last_reported: timestamp,
  };
}
