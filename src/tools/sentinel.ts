import fs from 'fs/promises';
import path from 'path';
import { getConfig, log } from '../config.js';
import { resolvePath, ensureDir, hasProjectLocal } from '../dataRoot.js';

// ============================================================================
// Types
// ============================================================================

export type Severity = 'low' | 'med' | 'high' | 'critical';
export type Priority = 'low' | 'medium' | 'high' | 'critical';
export type EpicStatus = 'planned' | 'in_progress' | 'shipped' | 'on_hold' | 'cancelled';
export type IssueStatus = 'open' | 'closed' | 'wontfix';

// ============================================================================
// Issue Types
// ============================================================================

export interface CreateIssueInput {
  repo: string;
  severity: Severity;
  title: string;
  details: string;
  epic_id?: string;
}

export interface CreateIssueOutput {
  id: string;
  timestamp: string;
  path: string;
  status: string;
  epic_id?: string;
  location: 'project' | 'global';
}

export interface CloseIssueInput {
  repo: string;
  issue_id: string;
  resolution?: string;
  status?: 'closed' | 'wontfix';
}

export interface CloseIssueOutput {
  id: string;
  path: string;
  status: IssueStatus;
  closed_at: string;
  resolution?: string;
}

export interface CloseIssueError {
  error: 'ISSUE_NOT_FOUND';
  repo: string;
  issue_id: string;
  message: string;
  available_issues: Array<{ id: string; title: string }>;
}

export interface ListRepoIssuesInput {
  repo: string;
  status?: IssueStatus;
}

export interface ListRepoIssuesOutput {
  issues: IssueSummary[];
}

// ============================================================================
// Epic Types
// ============================================================================

export interface LogEpicInput {
  title: string;
  summary: string;
  motivation?: string[];
  outcomes?: string[];
  acceptance_criteria?: string[];
  priority?: Priority;
  tags?: string[];
  owner?: string;
  squad?: string;
}

export interface LogEpicOutput {
  epic_id: string;
  timestamp: string;
  path: string;
  location: 'project' | 'global';
}

export interface ListEpicsInput {
  status?: EpicStatus;
  priority?: Priority;
  tags?: string[];
}

export interface EpicSummary {
  id: string;
  title: string;
  status: EpicStatus;
  priority: Priority;
}

export interface ListEpicsOutput {
  epics: EpicSummary[];
}

export interface GetEpicInput {
  epic_id: string;
}

export interface Epic {
  id: string;
  title: string;
  summary: string;
  status: EpicStatus;
  priority: Priority;
  motivation: string[];
  outcomes: string[];
  acceptance_criteria: string[];
  tags: string[];
  owner: string;
  squad: string;
  created_at: string;
}

export interface GetEpicOutput {
  epic: Epic | null;
  error?: string;
}

export interface GetEpicIssuesInput {
  epic_id: string;
}

export interface IssueSummary {
  id: string;
  title: string;
  severity: Severity;
  status: string;
}

export interface GetEpicIssuesOutput {
  issues: IssueSummary[];
}

// ============================================================================
// Resolve Epic Types
// ============================================================================

export interface ResolveEpicInput {
  query: string;
  limit?: number;
}

export interface EpicMatch {
  id: string;
  title: string;
  status: EpicStatus;
  priority: Priority;
  score: number;
}

export interface ResolveEpicOutput {
  matches: EpicMatch[];
}

// ============================================================================
// Error Types
// ============================================================================

export interface EpicNotFoundError {
  error: 'EPIC_NOT_FOUND';
  epic_id: string;
  message: string;
  suggested_epics: Array<{ id: string; title: string }>;
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

async function getNextEpicNumber(epicsDir: string): Promise<number> {
  try {
    const files = await fs.readdir(epicsDir);
    const epicNumbers = files
      .filter((f) => f.startsWith('EPIC-') && f.endsWith('.md'))
      .map((f) => {
        const match = f.match(/^EPIC-(\d+)/);
        return match ? parseInt(match[1], 10) : 0;
      });
    return epicNumbers.length > 0 ? Math.max(...epicNumbers) + 1 : 1;
  } catch {
    return 1;
  }
}

function formatEpicId(num: number): string {
  return `EPIC-${num.toString().padStart(4, '0')}`;
}

async function parseEpicFile(filePath: string): Promise<Epic | null> {
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

        // Handle arrays (simple format: [item1, item2])
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

    // Extract sections from body
    const bodyMatch = content.match(/---\n\n([\s\S]*)/);
    const body = bodyMatch ? bodyMatch[1] : '';

    const extractList = (section: string): string[] => {
      const regex = new RegExp(`## ${section}\\n([\\s\\S]*?)(?=\\n## |$)`);
      const match = body.match(regex);
      if (!match) return [];
      return match[1]
        .split('\n')
        .filter((line) => line.startsWith('- '))
        .map((line) => line.slice(2).trim());
    };

    return {
      id: frontmatter.id as string || '',
      title: frontmatter.title as string || '',
      summary: frontmatter.summary as string || '',
      status: (frontmatter.status as EpicStatus) || 'planned',
      priority: (frontmatter.priority as Priority) || 'medium',
      motivation: extractList('Motivation'),
      outcomes: extractList('Outcomes'),
      acceptance_criteria: extractList('Acceptance Criteria'),
      tags: (frontmatter.tags as string[]) || [],
      owner: frontmatter.owner as string || '',
      squad: frontmatter.squad as string || '',
      created_at: frontmatter.created_at as string || '',
    };
  } catch {
    return null;
  }
}

async function getAllEpics(): Promise<Array<{ id: string; title: string; status: EpicStatus; priority: Priority }>> {
  const epicsDir = resolvePath('sentinel-epics');
  const epics: Array<{ id: string; title: string; status: EpicStatus; priority: Priority }> = [];

  try {
    const files = await fs.readdir(epicsDir);
    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      const filePath = path.join(epicsDir, file);
      const epic = await parseEpicFile(filePath);
      if (epic) {
        epics.push({
          id: epic.id,
          title: epic.title,
          status: epic.status,
          priority: epic.priority,
        });
      }
    }
  } catch {
    // Directory doesn't exist yet
  }

  return epics;
}

function calculateFuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase();
  const t = text.toLowerCase();

  // Exact match
  if (t === q) return 1.0;

  // Contains exact query
  if (t.includes(q)) return 0.9;

  // Word-by-word matching
  const queryWords = q.split(/\s+/);
  const textWords = t.split(/\s+/);
  let matchedWords = 0;

  for (const qWord of queryWords) {
    if (textWords.some((tWord) => tWord.includes(qWord) || qWord.includes(tWord))) {
      matchedWords++;
    }
  }

  if (queryWords.length > 0) {
    return (matchedWords / queryWords.length) * 0.8;
  }

  return 0;
}

async function parseIssueFile(filePath: string): Promise<IssueSummary | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) return null;

    const frontmatter: Record<string, string> = {};
    for (const line of frontmatterMatch[1].split('\n')) {
      const colonIndex = line.indexOf(':');
      if (colonIndex > 0) {
        const key = line.slice(0, colonIndex).trim();
        const value = line.slice(colonIndex + 1).trim();
        frontmatter[key] = value;
      }
    }

    // Extract title from first heading
    const titleMatch = content.match(/^# (.+)$/m);
    const title = titleMatch ? titleMatch[1] : path.basename(filePath, '.md');

    return {
      id: path.basename(filePath),
      title,
      severity: (frontmatter.severity as Severity) || 'low',
      status: frontmatter.status || 'open',
    };
  } catch {
    return null;
  }
}

async function findIssueFile(repo: string, issueId: string): Promise<{ filePath: string; filename: string } | null> {
  const issuesDir = resolvePath('sentinel-issues');

  try {
    const files = await fs.readdir(issuesDir);
    
    // Try exact match first
    if (files.includes(issueId)) {
      return { filePath: path.join(issuesDir, issueId), filename: issueId };
    }
    
    // Try with .md extension
    const withMd = issueId.endsWith('.md') ? issueId : `${issueId}.md`;
    if (files.includes(withMd)) {
      return { filePath: path.join(issuesDir, withMd), filename: withMd };
    }

    // Fuzzy match - find file containing the query
    const match = files.find(f => f.toLowerCase().includes(issueId.toLowerCase()));
    if (match) {
      return { filePath: path.join(issuesDir, match), filename: match };
    }

    return null;
  } catch {
    return null;
  }
}

async function getRepoIssues(repo: string): Promise<Array<{ id: string; title: string }>> {
  const issuesDir = resolvePath('sentinel-issues');
  const issues: Array<{ id: string; title: string }> = [];

  try {
    const files = await fs.readdir(issuesDir);
    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      const filePath = path.join(issuesDir, file);
      const issue = await parseIssueFile(filePath);
      if (issue) {
        issues.push({ id: issue.id, title: issue.title });
      }
    }
  } catch {
    // Directory doesn't exist
  }

  return issues;
}

// ============================================================================
// Issue Functions
// ============================================================================

export async function createIssue(
  input: CreateIssueInput
): Promise<CreateIssueOutput | EpicNotFoundError> {
  // Validate epic_id if provided
  if (input.epic_id) {
    const allEpics = await getAllEpics();
    const epicExists = allEpics.some((e) => e.id === input.epic_id);

    if (!epicExists) {
      // Return structured error with suggestions
      const suggested = allEpics
        .slice(0, 5)
        .map((e) => ({ id: e.id, title: e.title }));

      return {
        error: 'EPIC_NOT_FOUND',
        epic_id: input.epic_id,
        message: `Unknown epic_id ${input.epic_id}.`,
        suggested_epics: suggested,
      };
    }
  }

  const now = new Date();
  const timestamp = now.toISOString();
  const fileTimestamp = formatTimestampForFilename(now);
  const slug = slugify(input.title);
  const filename = `${fileTimestamp}-${slug}.md`;

  // Use project-local path if decibel/ exists, else global
  const issuesDir = resolvePath('sentinel-issues');
  ensureDir(issuesDir);
  const filePath = path.join(issuesDir, filename);

  // Determine location for output using hasProjectLocal()
  const location = hasProjectLocal() ? 'project' : 'global';

  // Build frontmatter with optional epic_id
  const frontmatterLines = [
    '---',
    `repo: ${input.repo}`,
    `severity: ${input.severity}`,
    `status: open`,
    `created_at: ${timestamp}`,
  ];
  if (input.epic_id) {
    frontmatterLines.push(`epic_id: ${input.epic_id}`);
  }
  frontmatterLines.push('---');
  const frontmatter = frontmatterLines.join('\n');

  const bodyLines = [
    `# ${input.title}`,
    '',
    `**Severity:** ${input.severity}`,
    `**Status:** open`,
  ];
  if (input.epic_id) {
    bodyLines.push(`**Epic:** ${input.epic_id}`);
  }
  bodyLines.push('', '## Details', '', input.details);
  const body = bodyLines.join('\n');

  const content = `${frontmatter}\n\n${body}\n`;

  await fs.writeFile(filePath, content, 'utf-8');
  log(`Sentinel: Created issue at ${filePath} (${location})`);

  return {
    id: filename,
    timestamp,
    path: filePath,
    status: 'open',
    epic_id: input.epic_id,
    location,
  };
}

export async function closeIssue(
  input: CloseIssueInput
): Promise<CloseIssueOutput | CloseIssueError> {
  const found = await findIssueFile(input.repo, input.issue_id);

  if (!found) {
    const available = await getRepoIssues(input.repo);
    return {
      error: 'ISSUE_NOT_FOUND',
      repo: input.repo,
      issue_id: input.issue_id,
      message: `Could not find issue matching "${input.issue_id}" in repo "${input.repo}".`,
      available_issues: available.slice(0, 5),
    };
  }

  const { filePath, filename } = found;
  const content = await fs.readFile(filePath, 'utf-8');
  const now = new Date();
  const closedAt = now.toISOString();
  const newStatus: IssueStatus = input.status || 'closed';

  // Update frontmatter
  let updatedContent = content.replace(
    /^(---\n[\s\S]*?)status: \w+/m,
    `$1status: ${newStatus}`
  );

  // Add closed_at to frontmatter if not present
  if (!updatedContent.includes('closed_at:')) {
    updatedContent = updatedContent.replace(
      /^(---\n[\s\S]*?)(---)$/m,
      `$1closed_at: ${closedAt}\n$2`
    );
  } else {
    updatedContent = updatedContent.replace(
      /closed_at: .*/,
      `closed_at: ${closedAt}`
    );
  }

  // Update status in body
  updatedContent = updatedContent.replace(
    /\*\*Status:\*\* \w+/,
    `**Status:** ${newStatus}`
  );

  // Add resolution section if provided
  if (input.resolution) {
    if (updatedContent.includes('## Resolution')) {
      // Replace existing resolution
      updatedContent = updatedContent.replace(
        /## Resolution\n\n[\s\S]*?(?=\n## |$)/,
        `## Resolution\n\n${input.resolution}\n`
      );
    } else {
      // Add resolution section at the end
      updatedContent = updatedContent.trimEnd() + `\n\n## Resolution\n\n${input.resolution}\n`;
    }
  }

  await fs.writeFile(filePath, updatedContent, 'utf-8');
  log(`Sentinel: Closed issue at ${filePath}`);

  return {
    id: filename,
    path: filePath,
    status: newStatus,
    closed_at: closedAt,
    resolution: input.resolution,
  };
}

export async function listRepoIssues(
  input: ListRepoIssuesInput
): Promise<ListRepoIssuesOutput> {
  const issuesDir = resolvePath('sentinel-issues');
  const issues: IssueSummary[] = [];

  try {
    const files = await fs.readdir(issuesDir);
    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      const filePath = path.join(issuesDir, file);
      const issue = await parseIssueFile(filePath);
      if (issue) {
        // Apply status filter
        if (input.status && issue.status !== input.status) continue;
        issues.push(issue);
      }
    }
  } catch {
    // Directory doesn't exist
  }

  // Sort by filename (newest first based on timestamp)
  issues.sort((a, b) => b.id.localeCompare(a.id));

  return { issues };
}

// ============================================================================
// Epic Functions
// ============================================================================

export async function logEpic(input: LogEpicInput): Promise<LogEpicOutput> {
  const now = new Date();
  const timestamp = now.toISOString();

  const epicsDir = resolvePath('sentinel-epics');
  ensureDir(epicsDir);

  const epicNum = await getNextEpicNumber(epicsDir);
  const epicId = formatEpicId(epicNum);
  const slug = slugify(input.title);
  const filename = `${epicId}-${slug}.md`;
  const filePath = path.join(epicsDir, filename);

  // Determine location for output using hasProjectLocal()
  const location = hasProjectLocal() ? 'project' : 'global';

  const priority = input.priority || 'medium';
  const tags = input.tags || [];
  const owner = input.owner || '';
  const squad = input.squad || '';

  // Build frontmatter
  const frontmatter = [
    '---',
    `id: ${epicId}`,
    `title: ${input.title}`,
    `summary: ${input.summary}`,
    `status: planned`,
    `priority: ${priority}`,
    `tags: [${tags.join(', ')}]`,
    `owner: ${owner}`,
    `squad: ${squad}`,
    `created_at: ${timestamp}`,
    '---',
  ].join('\n');

  // Build body sections
  const sections: string[] = [];

  sections.push(`# ${input.title}`, '', '## Summary', '', input.summary);

  if (input.motivation && input.motivation.length > 0) {
    sections.push('', '## Motivation', '');
    for (const item of input.motivation) {
      sections.push(`- ${item}`);
    }
  }

  if (input.outcomes && input.outcomes.length > 0) {
    sections.push('', '## Outcomes', '');
    for (const item of input.outcomes) {
      sections.push(`- ${item}`);
    }
  }

  if (input.acceptance_criteria && input.acceptance_criteria.length > 0) {
    sections.push('', '## Acceptance Criteria', '');
    for (const item of input.acceptance_criteria) {
      sections.push(`- [ ] ${item}`);
    }
  }

  const content = `${frontmatter}\n\n${sections.join('\n')}\n`;

  await fs.writeFile(filePath, content, 'utf-8');
  log(`Sentinel: Created epic at ${filePath} (${location})`);

  return {
    epic_id: epicId,
    timestamp,
    path: filePath,
    location,
  };
}

export async function listEpics(input: ListEpicsInput): Promise<ListEpicsOutput> {
  const epicsDir = resolvePath('sentinel-epics');

  const epics: EpicSummary[] = [];

  try {
    const files = await fs.readdir(epicsDir);
    for (const file of files) {
      if (!file.endsWith('.md')) continue;

      const filePath = path.join(epicsDir, file);
      const epic = await parseEpicFile(filePath);
      if (!epic) continue;

      // Apply filters
      if (input.status && epic.status !== input.status) continue;
      if (input.priority && epic.priority !== input.priority) continue;
      if (input.tags && input.tags.length > 0) {
        const hasTag = input.tags.some((t) => epic.tags.includes(t));
        if (!hasTag) continue;
      }

      epics.push({
        id: epic.id,
        title: epic.title,
        status: epic.status,
        priority: epic.priority,
      });
    }
  } catch {
    // Directory doesn't exist yet
  }

  // Sort by ID (newest first based on number)
  epics.sort((a, b) => b.id.localeCompare(a.id));

  return { epics };
}

export async function getEpic(input: GetEpicInput): Promise<GetEpicOutput> {
  const epicsDir = resolvePath('sentinel-epics');

  try {
    const files = await fs.readdir(epicsDir);
    const epicFile = files.find((f) => f.startsWith(input.epic_id));

    if (!epicFile) {
      return { epic: null, error: `Epic not found: ${input.epic_id}` };
    }

    const filePath = path.join(epicsDir, epicFile);
    const epic = await parseEpicFile(filePath);

    if (!epic) {
      return { epic: null, error: `Failed to parse epic: ${input.epic_id}` };
    }

    return { epic };
  } catch {
    return { epic: null, error: `Epic not found: ${input.epic_id}` };
  }
}

export async function getEpicIssues(
  input: GetEpicIssuesInput
): Promise<GetEpicIssuesOutput> {
  const issuesDir = resolvePath('sentinel-issues');
  const issues: IssueSummary[] = [];

  try {
    const issueFiles = await fs.readdir(issuesDir);

    for (const file of issueFiles) {
      if (!file.endsWith('.md')) continue;

      const filePath = path.join(issuesDir, file);
      const content = await fs.readFile(filePath, 'utf-8');

      // Check if this issue belongs to the epic
      if (content.includes(`epic_id: ${input.epic_id}`)) {
        const issue = await parseIssueFile(filePath);
        if (issue) {
          issues.push(issue);
        }
      }
    }
  } catch {
    // Issues dir doesn't exist
  }

  return { issues };
}

export async function resolveEpic(input: ResolveEpicInput): Promise<ResolveEpicOutput> {
  const limit = input.limit || 5;
  const allEpics = await getAllEpics();

  // Score each epic against the query
  const scored: EpicMatch[] = allEpics.map((epic) => {
    // Score against both ID and title
    const idScore = calculateFuzzyScore(input.query, epic.id);
    const titleScore = calculateFuzzyScore(input.query, epic.title);
    const score = Math.max(idScore, titleScore);

    return {
      id: epic.id,
      title: epic.title,
      status: epic.status,
      priority: epic.priority,
      score: Math.round(score * 100) / 100, // Round to 2 decimals
    };
  });

  // Filter out zero scores and sort by score descending
  const matches = scored
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return { matches };
}
