import fs from 'fs/promises';
import path from 'path';
import { parse as parseYaml, parseAllDocuments, stringify as stringifyYaml } from 'yaml';
import { log } from './config.js';
import { getWritePath, readFilesFromBothPaths } from './decibelPaths.js';
import { allocateAndWriteIssue } from './lib/issueIdAllocator.js';
import { writeFileAtomic } from './lib/atomicWrite.js';

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
export function safeParseYaml(content: string): Record<string, unknown> {
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
      const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
      const parsed = fmMatch ? safeParseYaml(fmMatch[1]) : safeParseYaml(content);

      // Required fields, with fallbacks for markdown-frontmatter issues
      // (tools/sentinel.ts createIssue): id = filename, title = `# heading`.
      // Without these, read_issue/update_issue can't see .md issues at all.
      const headingMatch = content.match(/^# (.+)$/m);
      const id = (parsed.id as string) || path.basename(filePath);
      const title =
        (parsed.title as string) ||
        headingMatch?.[1] ||
        path.basename(filePath).replace(/\.(md|ya?ml)$/, '');

      if (!id || !title) {
        log(`sentinelIssues: Skipping ${filePath} - missing id or title`);
        continue;
      }

      // Two DIFFERENT issues can claim one id (ISS-0131). Dropping the second
      // made it unreachable to read_issue/update_issue while the tool still
      // reported success on the first — so keep both and mark them instead.
      // (Cross-path duplicates of the SAME file are already deduped by
      // filename in readFilesFromBothPaths, so this only ever fires on a real
      // id collision.)
      const isDuplicate = seenIds.has(id);
      if (isDuplicate) {
        log(`sentinelIssues: Duplicate id ${id} from ${source} path — both retained, marked ambiguous`);
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
        description:
          (parsed.description as string | undefined) ??
          (fmMatch?.[2]?.trim() ? fmMatch[2].trim() : undefined),
      };

      // Copy any extra fields
      for (const key of Object.keys(parsed)) {
        if (!(key in issue)) {
          issue[key] = parsed[key];
        }
      }
      // Keep the on-disk filename so lookups can accept it as an ID
      issue.filename = path.basename(filePath);

      issues.push(issue);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`sentinelIssues: Failed to parse ${filePath}: ${message}`);
    }
  }

  // Mark EVERY member of a colliding id, not just the ones seen second — a
  // caller holding the first file is in exactly as much danger as one holding
  // the second, and neither can be safely written by id alone.
  const byId = new Map<string, SentinelIssue[]>();
  for (const issue of issues) {
    const key = issue.id.toUpperCase();
    byId.set(key, [...(byId.get(key) ?? []), issue]);
  }
  for (const group of byId.values()) {
    if (group.length > 1) {
      for (const issue of group) issue.duplicate_id = true;
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

  // Id allocation and the write are held under one cross-process lock, shared
  // with src/tools/sentinel.ts. Both implementations allocate from a single
  // ISS-NNNN space into the same directory, so they must serialize against each
  // other — not just against other instances of themselves.
  const slug = slugify(title);
  const now = new Date().toISOString();

  const buildIssue = (newId: string): SentinelIssue => {
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
    if (epicId) issue.epicId = epicId;
    if (description) issue.description = description;
    return issue;
  };

  // Serialize with an explicit field order for stable, reviewable diffs.
  const buildIssueYaml = (newId: string): string => {
    const built = buildIssue(newId);
    const yamlObj: Record<string, unknown> = {
      id: built.id,
      title: built.title,
      project: built.project,
      status: built.status,
      priority: built.priority,
    };
    if (epicId) yamlObj.epic_id = epicId;
    yamlObj.tags = built.tags;
    yamlObj.created_at = built.created_at;
    yamlObj.updated_at = built.updated_at;
    if (description) yamlObj.description = description;
    return stringifyYaml(yamlObj, { lineWidth: 0 }); // Don't wrap lines
  };

  const allocated = await allocateAndWriteIssue(issuesDir, 'yml', slug, buildIssueYaml);
  const { id: newId, filename, filePath } = allocated;
  const issue = buildIssue(newId);

  log(`sentinelIssues: Created issue at ${filePath}`);

  return {
    ...issue,
    filePath,
  };
}

/**
 * Build the refusal for an id that names more than one record. Callers get the
 * candidate filenames because each one is itself a valid, unambiguous id —
 * without them the error would be a dead end rather than a next step.
 */
function ambiguousIssueId(
  issueId: string,
  projectId: string,
  candidates: Array<{ filename?: unknown; title?: string }>
): Error {
  const names = candidates.map((c) =>
    typeof c.filename === 'string' ? c.filename : String(c.title ?? '?')
  );
  const err = new Error(
    `AMBIGUOUS_ISSUE_ID: "${issueId}" matches ${names.length} records in project "${projectId}", ` +
      `so the target is undefined and nothing was changed. ` +
      `Re-run with one of these filenames as issue_id: ${names.join(', ')}`
  );
  err.name = 'AmbiguousIssueIdError';
  return err;
}

/**
 * Get a single issue by ID (e.g., "ISS-0005") with full content
 */
export async function getIssueById(
  projectId: string,
  issueId: string,
): Promise<SentinelIssue | null> {
  // Accept every ID form other tools emit: frontmatter id (ISS-NNNN),
  // filename with or without extension (what list_issues/close_issue use).
  const norm = (s: string) => s.toUpperCase().replace(/\.(MD|YA?ML)$/, '');
  const issues = await listIssuesForProject(projectId);
  const normalizedId = norm(issueId);

  // Filename is the more specific form and can only match one record, so it
  // wins outright — that keeps "retry with the filename" a working escape
  // hatch out of an ambiguous id.
  const byFilename = issues.filter(
    (i) => typeof i.filename === 'string' && norm(i.filename) === normalizedId
  );
  if (byFilename.length === 1) return byFilename[0];

  const byId = issues.filter((i) => norm(i.id) === normalizedId);
  if (byId.length === 0) return null;
  if (byId.length > 1) throw ambiguousIssueId(issueId, projectId, byId);
  return byId[0];
}

// ============================================================================
// Update Issue
// ============================================================================

export interface UpdateIssueInput {
  projectId: string;
  issueId: string;
  status?: IssueStatus;
  priority?: IssuePriority;
  tags?: string[];
  note?: string;
}

export interface UpdateIssueOutput extends SentinelIssue {
  filePath: string;
  changes: string[];
}

/**
 * Update an existing issue — status, priority, tags, and/or append a note.
 * Reads the YAML file, applies changes, writes back.
 */
export async function updateIssue(
  input: UpdateIssueInput
): Promise<UpdateIssueOutput> {
  const { projectId, issueId, status, priority, tags, note } = input;

  // Find the issue file
  const files = await readFilesFromBothPaths(projectId, ISSUES_SUBPATH);
  const normalizedId = issueId.toUpperCase();

  // Exact filename beats a prefix, so naming the file disambiguates a
  // duplicate id. Checked first and returned outright.
  const exact = files.filter(
    (f) => path.basename(f.filePath).toUpperCase() === normalizedId
  );

  // A bare `startsWith` had no boundary: "ISS-011" swallowed ISS-0110,
  // ISS-0112 and ISS-0119, and `break` then wrote to whichever readdir
  // happened to yield first. Require the id to end at a separator or the
  // extension, and collect every hit rather than stopping at the first.
  const prefixed = files.filter((f) => {
    const basename = path.basename(f.filePath).toUpperCase();
    if (!basename.startsWith(normalizedId)) return false;
    const rest = basename.slice(normalizedId.length);
    return rest === '' || rest.startsWith('-') || /^\.(MD|YA?ML)$/.test(rest);
  });

  const matches = exact.length > 0 ? exact : prefixed;

  if (matches.length === 0) {
    throw new Error(`Issue ${issueId} not found in project ${projectId}`);
  }

  if (matches.length > 1) {
    throw ambiguousIssueId(
      issueId,
      projectId,
      matches.map((f) => ({ filename: path.basename(f.filePath) }))
    );
  }

  const matchedFile = matches[0];

  // Read and parse. Two on-disk formats exist:
  //   1. Markdown with `---` frontmatter delimiters + body (tools/sentinel.ts createIssue)
  //   2. Pure YAML (this module's createIssue)
  // The writer MUST preserve the source format — flattening a markdown file to
  // bare YAML drops the delimiters, the `# Title` heading, and the body, which
  // makes the issue invisible to frontmatter-based readers (silent data loss).
  const content = await fs.readFile(matchedFile.filePath, 'utf-8');
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  const parsed = fmMatch ? safeParseYaml(fmMatch[1]) : safeParseYaml(content);
  let body = fmMatch ? fmMatch[2] : undefined;
  const changes: string[] = [];

  // Apply changes
  if (status && status !== parsed.status) {
    changes.push(`status: ${parsed.status} → ${status}`);
    parsed.status = status;
    // Markdown records mirror the status into the body as `**Status:** x` for
    // human readers. close_issue rewrites that line; this path did not, so a
    // record moved to in_progress or closed here still read `open` to anyone
    // opening the file. Frontmatter stayed correct, which is why the tools
    // never noticed — the drift was only ever visible to people.
    if (body !== undefined) {
      body = body.replace(/^\*\*Status:\*\* .*$/m, `**Status:** ${status}`);
    }
  }

  if (priority && priority !== parsed.priority) {
    changes.push(`priority: ${parsed.priority ?? 'unset'} → ${priority}`);
    parsed.priority = priority;
  }

  if (tags) {
    const oldTags = (parsed.tags as string[]) || [];
    const merged = [...new Set([...oldTags, ...tags])];
    if (merged.length !== oldTags.length) {
      changes.push(`tags: added ${tags.filter(t => !oldTags.includes(t)).join(', ')}`);
      parsed.tags = merged;
    }
  }

  if (note) {
    const timestamp = new Date().toISOString().slice(0, 10);
    if (body !== undefined) {
      // Markdown format: append to the body, keeping the heading/prose intact
      body = `${body.replace(/\s+$/, '')}\n\n[${timestamp}] ${note}\n`;
    } else {
      const existing = (parsed.description as string) || '';
      parsed.description = `${existing}\n\n[${timestamp}] ${note}`;
    }
    changes.push(`note appended`);
  }

  if (changes.length === 0) {
    throw new Error(`No changes to apply to ${issueId}`);
  }

  // Update timestamp
  parsed.updated_at = new Date().toISOString();

  // Write back in the same format the file came in
  const yaml = stringifyYaml(parsed, { lineWidth: 0 });
  const yamlContent = body !== undefined ? `---\n${yaml}---\n${body}` : yaml;

  // Write to the primary (.decibel) path
  const writeDir = await getWritePath(projectId, ISSUES_SUBPATH);
  await ensureDir(writeDir);
  const writePath = path.join(writeDir, path.basename(matchedFile.filePath));
  await writeFileAtomic(writePath, yamlContent);
  log(`sentinelIssues: Updated issue ${issueId} at ${writePath} — ${changes.join(', ')}`);

  // Build return object
  const issue: SentinelIssue = {
    id: parsed.id as string,
    title: parsed.title as string,
    project: (parsed.project as string) || projectId,
    status: parsed.status as IssueStatus,
    priority: parsed.priority as IssuePriority | undefined,
    epicId: (parsed.epic_id as string) || (parsed.epicId as string),
    tags: parsed.tags as string[] | undefined,
    created_at: parsed.created_at as string | undefined,
    updated_at: parsed.updated_at as string | undefined,
    description: parsed.description as string | undefined,
  };

  return { ...issue, filePath: writePath, changes };
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
