import fs from 'fs/promises';
import path from 'path';
import { parse as parseYaml, parseAllDocuments, stringify as stringifyYaml } from 'yaml';
import { log } from './config.js';
import { getWritePath, readFilesFromBothPaths } from './decibelPaths.js';

// ============================================================================
// Types
// ============================================================================

export type IssueStatus = 'open' | 'in_progress' | 'done' | 'blocked';
export type IssuePriority = 'low' | 'medium' | 'high';

export interface SentinelIssue {
  id: string;
  title: string;
  project: string;
  status: IssueStatus;
  priority?: IssuePriority;
  epicId?: string;
  tags?: string[];
  created_at?: string;
  updated_at?: string;
  description?: string;
  // Allow extras
  [key: string]: unknown;
}

export interface CreateIssueInput {
  projectId: string;
  title: string;
  description?: string;
  epicId?: string;
  priority?: IssuePriority;
  tags?: string[];
}

export interface CreateIssueOutput extends SentinelIssue {
  filePath: string;
}

// ============================================================================
// Constants
// ============================================================================

const ISSUES_SUBPATH = 'sentinel/issues';

// ============================================================================
// Helpers
// ============================================================================

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
 * Extract numeric suffix from issue ID (e.g., "ISS-0007" -> 7)
 */
function extractIssueNumber(id: string): number {
  const match = id.match(/^ISS-(\d+)$/i);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * Format issue ID with zero-padding
 */
function formatIssueId(num: number): string {
  return `ISS-${num.toString().padStart(4, '0')}`;
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
 * Safely parse YAML content that might contain multiple documents (frontmatter format).
 * Returns the first document's contents, or throws if no valid document found.
 */
function safeParseYaml(content: string): Record<string, unknown> {
  // First, try simple parse (most common case)
  try {
    return parseYaml(content) as Record<string, unknown>;
  } catch (err) {
    // Check if error is about multiple documents
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes('multiple documents')) {
      throw err;
    }
  }

  // Handle multi-document YAML (frontmatter format with --- delimiters)
  const docs = parseAllDocuments(content);
  if (docs.length === 0) {
    throw new Error('No YAML documents found');
  }

  // Return the first document (usually the frontmatter)
  const firstDoc = docs[0].toJSON();
  if (typeof firstDoc !== 'object' || firstDoc === null) {
    throw new Error('First YAML document is not an object');
  }

  return firstDoc as Record<string, unknown>;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * List all issues for a project
 * Reads from both .decibel/ and decibel/ paths, deduping by filename
 */
export async function listIssuesForProject(
  projectId: string
): Promise<SentinelIssue[]> {
  const issues: SentinelIssue[] = [];
  const seenIds = new Set<string>();

  // Read from both .decibel/ and decibel/ paths
  const files = await readFilesFromBothPaths(projectId, ISSUES_SUBPATH);

  if (files.length === 0) {
    log(`sentinelIssues: No issues found for project: ${projectId}`);
    return [];
  }

  for (const { filePath, source } of files) {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const parsed = safeParseYaml(content);

      // Validate required fields
      const id = parsed.id as string;
      const title = parsed.title as string;

      if (!id || !title) {
        log(`sentinelIssues: Skipping ${filePath} - missing id or title`);
        continue;
      }

      // Skip duplicates (primary takes precedence)
      if (seenIds.has(id)) {
        log(`sentinelIssues: Skipping duplicate ${id} from ${source} path`);
        continue;
      }
      seenIds.add(id);

      const issue: SentinelIssue = {
        id,
        title,
        project: (parsed.project as string) || projectId,
        status: (parsed.status as IssueStatus) || 'open',
        priority: parsed.priority as IssuePriority | undefined,
        epicId: (parsed.epic_id as string) || (parsed.epicId as string),
        tags: parsed.tags as string[] | undefined,
        created_at: parsed.created_at as string | undefined,
        updated_at: parsed.updated_at as string | undefined,
        description: parsed.description as string | undefined,
      };

      // Copy any extra fields
      for (const key of Object.keys(parsed)) {
        if (!(key in issue)) {
          issue[key] = parsed[key];
        }
      }

      issues.push(issue);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`sentinelIssues: Failed to parse ${filePath}: ${message}`);
    }
  }

  // Sort by ID (newest first)
  issues.sort((a, b) => extractIssueNumber(b.id) - extractIssueNumber(a.id));

  return issues;
}

/**
 * Create a new issue for a project
 */
export async function createIssue(
  input: CreateIssueInput
): Promise<CreateIssueOutput> {
  const { projectId, title, description, epicId, priority, tags } = input;

  // Always write to .decibel/ (primary path)
  const issuesDir = await getWritePath(projectId, ISSUES_SUBPATH);
  await ensureDir(issuesDir);

  // Find next issue number
  const existingIssues = await listIssuesForProject(projectId);
  const maxNum = existingIssues.reduce(
    (max, issue) => Math.max(max, extractIssueNumber(issue.id)),
    0
  );
  const newNum = maxNum + 1;
  const newId = formatIssueId(newNum);

  // Build filename
  const slug = slugify(title);
  const filename = `${newId}-${slug}.yml`;
  const filePath = path.join(issuesDir, filename);

  // Build issue object
  const now = new Date().toISOString();
  const issue: SentinelIssue = {
    id: newId,
    title,
    project: projectId,
    status: 'open',
    priority: priority || 'medium',
    tags: tags || [],
    created_at: now,
    updated_at: now,
  };

  if (epicId) {
    issue.epicId = epicId;
  }

  if (description) {
    issue.description = description;
  }

  // Build YAML content
  // Use a specific field order for cleaner output
  const yamlObj: Record<string, unknown> = {
    id: issue.id,
    title: issue.title,
    project: issue.project,
    status: issue.status,
    priority: issue.priority,
  };

  if (epicId) {
    yamlObj.epic_id = epicId;
  }

  yamlObj.tags = issue.tags;
  yamlObj.created_at = issue.created_at;
  yamlObj.updated_at = issue.updated_at;

  if (description) {
    yamlObj.description = description;
  }

  const yamlContent = stringifyYaml(yamlObj, {
    lineWidth: 0, // Don't wrap lines
  });

  // Write file
  await fs.writeFile(filePath, yamlContent, 'utf-8');
  log(`sentinelIssues: Created issue at ${filePath}`);

  return {
    ...issue,
    filePath,
  };
}

/**
 * Get a single issue by ID (e.g., "ISS-0005") with full content
 */
export async function getIssueById(
  projectId: string,
  issueId: string,
): Promise<SentinelIssue | null> {
  const issues = await listIssuesForProject(projectId);
  const normalizedId = issueId.toUpperCase();
  return issues.find((i) => i.id.toUpperCase() === normalizedId) ?? null;
}

/**
 * Filter issues by status
 */
export function filterByStatus(
  issues: SentinelIssue[],
  status: IssueStatus
): SentinelIssue[] {
  return issues.filter((issue) => issue.status === status);
}

/**
 * Filter issues by epic ID
 */
export function filterByEpicId(
  issues: SentinelIssue[],
  epicId: string
): SentinelIssue[] {
  return issues.filter((issue) => issue.epicId === epicId);
}
