import fs from 'fs/promises';
import path from 'path';
import { getConfig, log } from '../config.js';
import { ensureDir } from '../dataRoot.js';
import { resolveProjectPaths, validateWritePath, ResolvedProjectPaths } from '../projectRegistry.js';
import { emitCreateProvenance } from './provenance.js';
import { safeParseYaml } from '../sentinelIssues.js';

/**
 * Sentinel record files exist in two on-disk formats: markdown-with-frontmatter
 * (`.md`) and bare YAML (`.yml`/`.yaml`). Historically every directory scan
 * filtered on `.md` only, so ~530 `.yml` issues across 15 projects were
 * silently omitted from list_issues while read_issue/update_issue resolved
 * them fine. Treat both as first-class.
 */
const RECORD_EXT_RE = /\.(md|ya?ml)$/i;

function isRecordFile(filename: string): boolean {
  return RECORD_EXT_RE.test(filename);
}

function stripRecordExt(filename: string): string {
  return filename.replace(RECORD_EXT_RE, '');
}

/**
 * Extract the frontmatter region from a record file. `.md` records delimit it
 * with `---`; bare `.yml` records are frontmatter all the way down, so the
 * whole file is the region.
 */
function frontmatterRegion(content: string): string | null {
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (fmMatch) return fmMatch[1];
  if (/^---/.test(content.trimStart())) return null; // malformed delimiter block
  return content;
}

/**
 * Quote a scalar for use as a YAML frontmatter value when the string contains
 * characters that would otherwise change parser behaviour. Plain titles like
 * "Fix the auth bug" pass through unchanged; values containing `#`, leading
 * whitespace, or YAML indicator chars get JSON-style double-quoted.
 *
 * Without this, hand-assembled frontmatter `title: ${input.title}` silently
 * truncates values like "Fix bug from PR #42" because YAML treats `#` as a
 * comment indicator on read-back.
 */
function yamlScalar(value: string): string {
  if (value === '') return '""';
  // Characters that change YAML interpretation in a plain scalar.
  const needsQuoting = /[#:{}[\],&*!|>'"%@`]/.test(value)
    || /^[\s\-?]/.test(value)
    || /\s$/.test(value)
    || /^(true|false|null|yes|no|on|off|~)$/i.test(value)
    || /^[-+]?\d/.test(value);
  if (!needsQuoting) return value;
  return JSON.stringify(value);
}

// ============================================================================
// Project Resolution Error
// ============================================================================

export interface ProjectResolutionError {
  error: 'PROJECT_NOT_FOUND';
  message: string;
  suggestion: string;
}

export function isProjectResolutionError(result: unknown): result is ProjectResolutionError {
  return (
    typeof result === 'object' &&
    result !== null &&
    'error' in result &&
    (result as ProjectResolutionError).error === 'PROJECT_NOT_FOUND'
  );
}

function makeProjectResolutionError(operation: string): ProjectResolutionError {
  return {
    error: 'PROJECT_NOT_FOUND',
    message: `Cannot ${operation}: No .decibel/ folder found in project directory.`,
    suggestion: 'Run from a directory with a .decibel/ folder, set DECIBEL_PROJECT_ROOT environment variable, or initialize with `decibel init`.',
  };
}

// ============================================================================
// Types
// ============================================================================

export type Severity = 'low' | 'med' | 'high' | 'critical';
export type Priority = 'low' | 'medium' | 'high' | 'critical';
export type EpicStatus = 'planned' | 'in_progress' | 'shipped' | 'on_hold' | 'cancelled';
export type IssueStatus = 'open' | 'in_progress' | 'blocked' | 'closed' | 'wontfix';

// ============================================================================
// Issue Types
// ============================================================================

export interface CreateIssueInput {
  projectId?: string;
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
  projectId?: string;
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
  projectId: string;
  issue_id: string;
  message: string;
  available_issues: Array<{ id: string; title: string }>;
}

export interface ListRepoIssuesInput {
  projectId?: string;
  status?: IssueStatus;
}

export interface ListRepoIssuesOutput {
  issues: IssueSummary[];
  /** Files in the issues dir that could not be parsed — surfaced so silent
   *  skips can't masquerade as a shorter, clean list. */
  malformed?: number;
  malformed_files?: string[];
  /** Records that only parsed after salvaging corrupted YAML — readable, but
   *  the underlying files need repair. */
  degraded?: number;
  degraded_files?: string[];
}

// ============================================================================
// Epic Types
// ============================================================================

export interface LogEpicInput {
  projectId?: string;
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
  projectId?: string;
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
  projectId?: string;
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
  projectId?: string;
  epic_id: string;
}

export interface IssueSummary {
  id: string;
  title: string;
  severity: Severity;
  status: string;
  /**
   * Linked epic id (e.g., "EPIC-0001") if the issue's frontmatter declares one.
   * Surfaced via list_issues / list_epic_issues so consumers (HQ, MCP clients)
   * can build the epic→issue relationship without a per-issue read_issue call.
   */
  epic_id?: string;
  /** Priority level (low / medium / high / critical) when set. */
  priority?: string;
  /** Optional tags array. Parsed from inline-flow YAML (`tags: [a, b]`). */
  tags?: string[];
  /** ISO timestamp of issue creation. */
  created_at?: string;
  /** ISO timestamp of last modification. */
  updated_at?: string;
  /**
   * True when the record only parsed after salvaging — its YAML was corrupted
   * by a markdown section appended to a bare-YAML file (see `close_issue`
   * writing `## Resolution` into `.yml` records). The issue is readable, but
   * the file needs repair.
   */
  degraded?: boolean;
}

export interface GetEpicIssuesOutput {
  issues: IssueSummary[];
}

// ============================================================================
// Resolve Epic Types
// ============================================================================

export interface ResolveEpicInput {
  projectId?: string;
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
  return iso.replace(/:/g, '-').replace(/\.\d{3}Z$/, 'Z');
}

async function getNextEpicNumber(epicsDir: string): Promise<number> {
  try {
    const files = await fs.readdir(epicsDir);
    const epicNumbers = files
      .filter((f) => f.startsWith('EPIC-') && isRecordFile(f))
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

function formatIssueId(num: number): string {
  return `ISS-${num.toString().padStart(4, '0')}`;
}

async function getNextIssueNumber(issuesDir: string): Promise<number> {
  let max = 0;
  try {
    const files = await fs.readdir(issuesDir);
    for (const file of files) {
      const prefixMatch = file.match(/^ISS-(\d+)/i);
      if (prefixMatch) {
        max = Math.max(max, parseInt(prefixMatch[1], 10));
        continue;
      }
      if (!isRecordFile(file)) continue;
      try {
        const content = await fs.readFile(path.join(issuesDir, file), 'utf-8');
        const region = frontmatterRegion(content);
        if (!region) continue;
        const idLine = region.split('\n').find((l) => l.trim().toLowerCase().startsWith('id:'));
        if (!idLine) continue;
        const idVal = idLine.slice(idLine.indexOf(':') + 1).trim();
        const idMatch = idVal.match(/^ISS-(\d+)$/i);
        if (idMatch) max = Math.max(max, parseInt(idMatch[1], 10));
      } catch {
        // skip unreadable files
      }
    }
  } catch {
    // dir doesn't exist yet
  }
  return max + 1;
}

async function parseEpicFile(filePath: string): Promise<Epic | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const hasDelimiters = /^---\r?\n/.test(content);

    // Bare-YAML epics (`.yml`/`.yaml`) have no `---` fence and no markdown
    // body — parse them as YAML outright rather than failing the fence check.
    if (!hasDelimiters) {
      let parsed: Record<string, unknown>;
      try {
        parsed = safeParseYaml(content);
      } catch {
        return null;
      }
      if (typeof parsed !== 'object' || parsed === null) return null;
      const str = (k: string): string =>
        typeof parsed[k] === 'string' ? (parsed[k] as string) : '';
      const list = (k: string): string[] =>
        Array.isArray(parsed[k]) ? (parsed[k] as string[]) : [];
      return {
        id: str('id'),
        title: str('title'),
        summary: str('summary'),
        status: (str('status') as EpicStatus) || 'planned',
        priority: (str('priority') as Priority) || 'medium',
        motivation: list('motivation'),
        outcomes: list('outcomes'),
        acceptance_criteria: list('acceptance_criteria'),
        tags: list('tags'),
        owner: str('owner'),
        squad: str('squad'),
        created_at: str('created_at'),
      };
    }

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
            .map((s) => s.trim().replace(/^"(.*)"$/s, '$1'))
            .filter((s) => s.length > 0);
        } else {
          // Strip YAML-style outer quoting. yamlScalar writes values containing
          // '#', ':' etc. as JSON-style double-quoted strings; without this,
          // the naive parser returns the literal "..."-wrapped string.
          if (value.length >= 2) {
            if (value.startsWith('"') && value.endsWith('"')) {
              try { value = JSON.parse(value); } catch { /* keep as-is on bad escape */ }
            } else if (value.startsWith("'") && value.endsWith("'")) {
              value = value.slice(1, -1).replace(/''/g, "'");
            }
          }
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

async function getAllEpics(projectId?: string): Promise<Array<{ id: string; title: string; status: EpicStatus; priority: Priority }>> {
  const resolved = resolveProjectPaths(projectId);
  const epicsDir = resolved.subPath('sentinel', 'epics');
  const epics: Array<{ id: string; title: string; status: EpicStatus; priority: Priority }> = [];

  try {
    const files = await fs.readdir(epicsDir);
    for (const file of files) {
      if (!isRecordFile(file)) continue;
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

/**
 * Parse an issue file using the real YAML parser. Handles both on-disk formats
 * the daemon writes today:
 *
 *   1. Markdown-style with frontmatter delimiters (createIssue):
 *      ---
 *      key: value
 *      epic_id: EPIC-0001
 *      ---
 *      # Title
 *      body
 *
 *   2. YAML-only (updateIssue, after stringifyYaml):
 *      key: value
 *      epic_id: EPIC-0001
 *      description: |-
 *        body
 *
 * Uses `safeParseYaml` (shared with sentinelIssues.ts) which handles single-
 * doc and multi-doc YAML automatically. The previous ad-hoc parser was both
 * format-fragile (dropped YAML-only files) AND vulnerable to description-body
 * `epic_id` injection via crafted column-0 lines. The real parser closes both.
 */
async function parseIssueFile(filePath: string): Promise<IssueSummary | null> {
  let content: string;
  try {
    content = await fs.readFile(filePath, 'utf-8');
  } catch {
    return null;
  }

  // 1. Whole-file parse. Covers well-formed bare YAML and, via safeParseYaml's
  //    multi-doc handling, most markdown-with-frontmatter records.
  try {
    const parsed = safeParseYaml(content);
    if (typeof parsed === 'object' && parsed !== null) {
      return buildIssueSummary(filePath, content, parsed, false);
    }
  } catch {
    // fall through
  }

  // 2. Delimited frontmatter only — the markdown body confused the parser.
  const region = frontmatterRegion(content);
  if (region && region !== content) {
    try {
      const parsed = safeParseYaml(region);
      if (typeof parsed === 'object' && parsed !== null) {
        return buildIssueSummary(filePath, content, parsed, false);
      }
    } catch {
      // fall through
    }
  }

  // 3. Salvage. close_issue appends a markdown `## Resolution` section to
  //    bare-YAML records; the prose beneath it is not valid YAML, so the whole
  //    record used to vanish. Parse only the region above the first heading.
  const salvaged = salvageBareYaml(content);
  if (salvaged) return buildIssueSummary(filePath, content, salvaged, true);

  return null;
}

/**
 * Parse only the YAML region above the first markdown heading. Returns null if
 * the record is delimited, has no heading, or the region is still unparseable.
 */
function salvageBareYaml(content: string): Record<string, unknown> | null {
  if (/^---/.test(content.trimStart())) return null;
  const lines = content.split('\n');
  const headingIdx = lines.findIndex((l) => /^#{1,6}\s/.test(l));
  if (headingIdx <= 0) return null;
  try {
    const parsed = safeParseYaml(lines.slice(0, headingIdx).join('\n'));
    if (typeof parsed !== 'object' || parsed === null) return null;
    return parsed;
  } catch {
    return null;
  }
}

function buildIssueSummary(
  filePath: string,
  content: string,
  parsed: Record<string, unknown>,
  degraded: boolean
): IssueSummary {
  // Title: first markdown heading wins (legacy markdown-frontmatter format),
  // else explicit `title:` key in YAML, else filename as last-resort.
  const titleMatch = content.match(/^# (.+)$/m);
  const title =
    titleMatch?.[1] ??
    (typeof parsed.title === 'string' ? parsed.title : undefined) ??
    stripRecordExt(path.basename(filePath));

  // ID: prefer canonical ISS-NNNN form from frontmatter, else filename.
  const fmId = typeof parsed.id === 'string' ? parsed.id.match(/^ISS-\d+$/i)?.[0] : undefined;
  const id = fmId ?? path.basename(filePath);

  const summary: IssueSummary = {
    id,
    title,
    severity: (parsed.severity as Severity) || 'low',
    status: (typeof parsed.status === 'string' ? parsed.status : undefined) || 'open',
    epic_id:
      (typeof parsed.epic_id === 'string' ? parsed.epic_id : undefined) ??
      (typeof parsed.epicId === 'string' ? parsed.epicId : undefined),
    priority: typeof parsed.priority === 'string' ? parsed.priority : undefined,
    tags: Array.isArray(parsed.tags) ? (parsed.tags as string[]) : undefined,
    created_at: typeof parsed.created_at === 'string' ? parsed.created_at : undefined,
    updated_at: typeof parsed.updated_at === 'string' ? parsed.updated_at : undefined,
  };
  if (degraded) summary.degraded = true;
  return summary;
}

async function findIssueFile(projectId: string | undefined, issueId: string): Promise<{ filePath: string; filename: string } | null> {
  const resolved = resolveProjectPaths(projectId);
  const issuesDir = resolved.subPath('sentinel', 'issues');

  try {
    const files = await fs.readdir(issuesDir);

    // Try exact match first
    if (files.includes(issueId)) {
      return { filePath: path.join(issuesDir, issueId), filename: issueId };
    }

    // Try each record extension (.md, .yml, .yaml)
    if (!isRecordFile(issueId)) {
      for (const ext of ['.md', '.yml', '.yaml']) {
        const candidate = `${issueId}${ext}`;
        if (files.includes(candidate)) {
          return { filePath: path.join(issuesDir, candidate), filename: candidate };
        }
      }
    }

    // ISS-NNNN: match filename prefix with word boundary, or frontmatter id
    const issMatch = issueId.match(/^ISS-(\d+)$/i);
    if (issMatch) {
      const padded = `ISS-${issMatch[1].padStart(4, '0')}`.toLowerCase();
      const prefixHit = files.find((f) => {
        const lower = f.toLowerCase();
        return lower.startsWith(`${padded}-`) || stripRecordExt(lower) === padded;
      });
      if (prefixHit) {
        return { filePath: path.join(issuesDir, prefixHit), filename: prefixHit };
      }
      // Scan frontmatter for legacy retroactively-stamped issues
      for (const f of files) {
        if (!isRecordFile(f)) continue;
        try {
          const content = await fs.readFile(path.join(issuesDir, f), 'utf-8');
          const region = frontmatterRegion(content);
          if (!region) continue;
          const idLine = region.split('\n').find((l) => l.trim().toLowerCase().startsWith('id:'));
          if (!idLine) continue;
          const idVal = idLine.slice(idLine.indexOf(':') + 1).trim().toLowerCase();
          if (idVal === padded) {
            return { filePath: path.join(issuesDir, f), filename: f };
          }
        } catch {
          // skip unreadable
        }
      }
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

async function getProjectIssues(projectId?: string): Promise<Array<{ id: string; title: string }>> {
  const resolved = resolveProjectPaths(projectId);
  const issuesDir = resolved.subPath('sentinel', 'issues');
  const issues: Array<{ id: string; title: string }> = [];

  try {
    const files = await fs.readdir(issuesDir);
    for (const file of files) {
      if (!isRecordFile(file)) continue;
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
): Promise<CreateIssueOutput | EpicNotFoundError | ProjectResolutionError> {
  // Resolve project paths first - fail fast if no project
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.projectId);
  } catch (err) {
    return makeProjectResolutionError('create issue');
  }

  const issuesDir = resolved.subPath('sentinel', 'issues');

  // Validate epic_id if provided
  if (input.epic_id) {
    const allEpics = await getAllEpics(input.projectId);
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
  const slug = slugify(input.title);

  ensureDir(issuesDir);
  const issueNum = await getNextIssueNumber(issuesDir);
  const issueId = formatIssueId(issueNum);
  const filename = `${issueId}-${slug}.md`;

  const filePath = path.join(issuesDir, filename);
  validateWritePath(filePath, resolved);

  // Build frontmatter with optional epic_id
  const frontmatterLines = [
    '---',
    `id: ${issueId}`,
    `projectId: ${resolved.id}`,
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
  log(`Sentinel: Created issue at ${filePath} (project: ${resolved.id})`);

  // Emit provenance event for this creation
  await emitCreateProvenance(
    `sentinel:issue:${filename}`,
    content,
    `Created issue: ${input.title}`,
    input.projectId
  );

  return {
    id: issueId,
    timestamp,
    path: filePath,
    status: 'open',
    epic_id: input.epic_id,
    location: 'project',
  };
}

/**
 * Split a bare-YAML record into its YAML region and any trailing markdown.
 * close_issue historically appended a `## Resolution` section to bare-YAML
 * records; that tail is pre-existing corruption we preserve rather than
 * discard, while writing new fields into the YAML region where they belong.
 */
function splitBareYamlRecord(content: string): { yaml: string[]; tail: string[] } {
  const lines = content.split('\n');
  const headingIdx = lines.findIndex((l) => /^#{1,6}\s/.test(l));
  if (headingIdx < 0) return { yaml: lines, tail: [] };
  return { yaml: lines.slice(0, headingIdx), tail: lines.slice(headingIdx) };
}

/** Replace a column-0 scalar key in a YAML region, appending it if absent. */
function setYamlScalarField(lines: string[], key: string, value: string): string[] {
  const re = new RegExp(`^${key}:`);
  const idx = lines.findIndex((l) => re.test(l));
  if (idx >= 0) {
    const out = [...lines];
    out[idx] = `${key}: ${value}`;
    return out;
  }
  // Append after the last non-blank line so we don't strand it past a gap.
  const out = [...lines];
  while (out.length > 0 && out[out.length - 1].trim() === '') out.pop();
  out.push(`${key}: ${value}`);
  return out;
}

/** Replace a column-0 block-scalar key (and its indented continuation). */
function setYamlBlockField(lines: string[], key: string, value: string): string[] {
  const re = new RegExp(`^${key}:`);
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    if (re.test(lines[i])) {
      i++;
      // Consume the indented continuation block, including interior blank
      // lines, but stop before the next column-0 key.
      while (i < lines.length) {
        if (lines[i].trim() === '') {
          let j = i;
          while (j < lines.length && lines[j].trim() === '') j++;
          if (j >= lines.length || /^\S/.test(lines[j])) break;
          i = j;
          continue;
        }
        if (/^\s/.test(lines[i])) { i++; continue; }
        break;
      }
      continue;
    }
    out.push(lines[i]);
    i++;
  }
  while (out.length > 0 && out[out.length - 1].trim() === '') out.pop();
  out.push(`${key}: |-`);
  for (const l of value.split('\n')) out.push(`  ${l}`);
  return out;
}

export async function closeIssue(
  input: CloseIssueInput
): Promise<CloseIssueOutput | CloseIssueError | ProjectResolutionError> {
  // Resolve project paths first
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.projectId);
  } catch (err) {
    return makeProjectResolutionError('close issue');
  }

  const found = await findIssueFile(input.projectId, input.issue_id);

  if (!found) {
    const available = await getProjectIssues(input.projectId);
    return {
      error: 'ISSUE_NOT_FOUND',
      projectId: resolved.id,
      issue_id: input.issue_id,
      message: `Could not find issue matching "${input.issue_id}" in project "${resolved.id}".`,
      available_issues: available.slice(0, 5),
    };
  }

  const { filePath, filename } = found;
  const content = await fs.readFile(filePath, 'utf-8');
  const now = new Date();
  const closedAt = now.toISOString();
  const newStatus: IssueStatus = input.status || 'closed';

  let updatedContent: string;

  if (/^---\r?\n/.test(content)) {
    // ---- Markdown-with-frontmatter record ------------------------------------
    updatedContent = content.replace(
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
  } else {
    // ---- Bare-YAML record ----------------------------------------------------
    // The frontmatter regexes above are all anchored on a leading `---`, so on
    // a bare-YAML record they silently no-op: status stayed `open` while the
    // markdown resolution append (which had no such guard) still fired. That
    // both corrupted the YAML and left the issue looking open, while
    // close_issue returned success. Write real YAML fields instead.
    const { yaml, tail } = splitBareYamlRecord(content);
    let region = setYamlScalarField(yaml, 'status', newStatus);
    region = setYamlScalarField(region, 'closed_at', closedAt);
    if (input.resolution) {
      region = setYamlBlockField(region, 'resolution', input.resolution);
    }
    // Preserve any pre-existing markdown tail verbatim — repairing already
    // corrupted files is a separate, reviewed migration (see ISS-0129).
    const parts = tail.length > 0 ? [...region, '', ...tail] : region;
    updatedContent = parts.join('\n').replace(/\n*$/, '\n');
  }

  await fs.writeFile(filePath, updatedContent, 'utf-8');
  log(`Sentinel: Closed issue at ${filePath}`);

  // Prefer ISS-NNNN id from filename or frontmatter for the return value
  const filenamePrefix = filename.match(/^(ISS-\d+)/i)?.[1];
  const fmIdMatch = updatedContent.match(/^---\n([\s\S]*?)\n---/);
  const fmId = fmIdMatch?.[1]
    .split('\n')
    .find((l) => l.trim().toLowerCase().startsWith('id:'))
    ?.split(':')[1]
    ?.trim()
    ?.match(/^ISS-\d+$/i)?.[0];
  const returnedId = filenamePrefix ?? fmId ?? filename;

  return {
    id: returnedId,
    path: filePath,
    status: newStatus,
    closed_at: closedAt,
    resolution: input.resolution,
  };
}

export async function listRepoIssues(
  input: ListRepoIssuesInput
): Promise<ListRepoIssuesOutput | ProjectResolutionError> {
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.projectId);
  } catch (err) {
    return makeProjectResolutionError('list issues');
  }

  const issuesDir = resolved.subPath('sentinel', 'issues');
  const issues: IssueSummary[] = [];
  const malformedFiles: string[] = [];
  const degradedFiles: string[] = [];

  try {
    const files = await fs.readdir(issuesDir);
    for (const file of files) {
      if (!isRecordFile(file)) continue;
      const filePath = path.join(issuesDir, file);
      const issue = await parseIssueFile(filePath);
      if (issue) {
        if (issue.degraded) degradedFiles.push(file);
        // Apply status filter
        if (input.status && issue.status !== input.status) continue;
        issues.push(issue);
      } else {
        // Unparseable file: report it instead of silently shrinking the list
        malformedFiles.push(file);
      }
    }
  } catch {
    // Directory doesn't exist
  }

  // Sort by filename (newest first based on timestamp)
  issues.sort((a, b) => b.id.localeCompare(a.id));

  const out: ListRepoIssuesOutput = { issues };
  if (malformedFiles.length > 0) {
    out.malformed = malformedFiles.length;
    out.malformed_files = malformedFiles;
  }
  if (degradedFiles.length > 0) {
    out.degraded = degradedFiles.length;
    out.degraded_files = degradedFiles;
  }
  return out;
}

// ============================================================================
// Epic Functions
// ============================================================================

export async function logEpic(input: LogEpicInput): Promise<LogEpicOutput | ProjectResolutionError> {
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.projectId);
  } catch (err) {
    return makeProjectResolutionError('log epic');
  }

  const epicsDir = resolved.subPath('sentinel', 'epics');
  const now = new Date();
  const timestamp = now.toISOString();

  ensureDir(epicsDir);

  const epicNum = await getNextEpicNumber(epicsDir);
  const epicId = formatEpicId(epicNum);
  const slug = slugify(input.title);
  const filename = `${epicId}-${slug}.md`;
  const filePath = path.join(epicsDir, filename);
  validateWritePath(filePath, resolved);

  const priority = input.priority || 'medium';
  const tags = input.tags || [];
  const owner = input.owner || '';
  const squad = input.squad || '';

  // Build frontmatter — use yamlScalar on free-text fields so values containing
  // `#`, `:` etc. don't truncate on read-back (see ISS-0110 bug 3).
  const frontmatter = [
    '---',
    `id: ${epicId}`,
    `projectId: ${yamlScalar(resolved.id)}`,
    `title: ${yamlScalar(input.title)}`,
    `summary: ${yamlScalar(input.summary)}`,
    `status: planned`,
    `priority: ${priority}`,
    `tags: [${tags.map(yamlScalar).join(', ')}]`,
    `owner: ${yamlScalar(owner)}`,
    `squad: ${yamlScalar(squad)}`,
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
  log(`Sentinel: Created epic at ${filePath} (project: ${resolved.id})`);

  // Emit provenance event for this creation
  await emitCreateProvenance(
    `sentinel:epic:${epicId}`,
    content,
    `Created epic: ${input.title}`,
    input.projectId
  );

  return {
    epic_id: epicId,
    timestamp,
    path: filePath,
    location: 'project',
  };
}

export async function listEpics(input: ListEpicsInput): Promise<ListEpicsOutput | ProjectResolutionError> {
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.projectId);
  } catch (err) {
    return makeProjectResolutionError('list epics');
  }
  const epicsDir = resolved.subPath('sentinel', 'epics');

  const epics: EpicSummary[] = [];

  try {
    const files = await fs.readdir(epicsDir);
    for (const file of files) {
      if (!isRecordFile(file)) continue;

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

export async function getEpic(input: GetEpicInput): Promise<GetEpicOutput | ProjectResolutionError> {
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.projectId);
  } catch (err) {
    return makeProjectResolutionError('get epic');
  }
  const epicsDir = resolved.subPath('sentinel', 'epics');

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
): Promise<GetEpicIssuesOutput | ProjectResolutionError> {
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.projectId);
  } catch (err) {
    return makeProjectResolutionError('get epic issues');
  }
  const issuesDir = resolved.subPath('sentinel', 'issues');
  const issues: IssueSummary[] = [];

  try {
    const issueFiles = await fs.readdir(issuesDir);

    for (const file of issueFiles) {
      if (!isRecordFile(file)) continue;
      const filePath = path.join(issuesDir, file);
      // Parse first, then filter on the parsed epic_id field. Previously this
      // used a brittle `content.includes('epic_id: ${epic_id}')` substring
      // check, which (a) matched commented-out epic_id lines, (b) didn't
      // handle quoted values like `epic_id: "EPIC-0001"`, and (c) ran before
      // parseIssueFile could fail and silently drop the issue regardless.
      const issue = await parseIssueFile(filePath);
      if (issue && issue.epic_id === input.epic_id) {
        issues.push(issue);
      }
    }
  } catch {
    // Issues dir doesn't exist
  }

  return { issues };
}

export async function resolveEpic(input: ResolveEpicInput): Promise<ResolveEpicOutput | ProjectResolutionError> {
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.projectId);
  } catch (err) {
    return makeProjectResolutionError('resolve epic');
  }

  const limit = input.limit || 5;
  const allEpics = await getAllEpics(input.projectId);

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
