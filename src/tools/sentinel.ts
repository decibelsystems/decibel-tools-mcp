import fs from 'fs/promises';
import path from 'path';
import { stringify as stringifyYaml } from 'yaml';
import { getConfig, log } from '../config.js';
import { ensureDir } from '../dataRoot.js';
import { resolveProjectPaths, validateWritePath, ResolvedProjectPaths } from '../projectRegistry.js';
import { emitCreateProvenance } from './provenance.js';
import { safeParseYaml } from '../sentinelIssues.js';
import { allocateAndWriteIssue } from '../lib/issueIdAllocator.js';
import {
  FsIssueRepository,
  AmbiguousIssueIdError as RepoAmbiguousIssueIdError,
  IssueNotFoundError as RepoIssueNotFoundError,
  StoredIssue,
} from '../domain/issueRepository.js';
import { writeFileAtomic } from '../lib/atomicWrite.js';

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
  /** Both of these are in the canonical Issue model and in CreateIssueSpec.
   *  They were absent here, so create_issue accepted them (the MCP schema is
   *  additionalProperties: true) and silently dropped them. */
  priority?: Priority;
  tags?: string[];
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

/**
 * More than one record answers to the same id, so the write target is
 * undefined. Refusing is the only safe answer: picking readdir-first silently
 * edited one issue and left its twin untouched (ISS-0131).
 */
export interface AmbiguousIssueIdError {
  error: 'AMBIGUOUS_ISSUE_ID';
  projectId: string;
  issue_id: string;
  message: string;
  /** Filenames that all matched, each usable verbatim as an unambiguous id. */
  candidates: string[];
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
  /** Ids claimed by more than one record. Writers refuse to target these
   *  (AMBIGUOUS_ISSUE_ID), so they are a data-repair queue, not a cosmetic
   *  nit — surfaced here rather than discovered mid-incident (ISS-0131). */
  duplicate_ids?: number;
  duplicate_id_files?: Record<string, string[]>;
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

export interface UpdateEpicInput {
  projectId?: string;
  epic_id: string;
  status?: EpicStatus;
  priority?: Priority;
  summary?: string;
  title?: string;
  owner?: string;
  squad?: string;
  tags?: string[];
  /** Appended to the body as a timestamped entry, preserving prior notes. */
  note?: string;
}

export interface UpdateEpicOutput {
  id: string;
  path: string;
  status: EpicStatus;
  priority: Priority;
  updated_at: string;
  /** Human-readable field transitions; empty when the patch was a no-op. */
  changes: string[];
}

/** More than one epic record answers to the id, so the write target is undefined. */
export interface AmbiguousEpicIdError {
  error: 'AMBIGUOUS_EPIC_ID';
  epic_id: string;
  message: string;
  candidates: string[];
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

/**
 * The identity a writer would collide on: the padded ISS-NNNN from the
 * filename, else from frontmatter, else the filename itself (which is unique
 * by construction). Mirrors the tier-3/tier-4 matching in findIssueCandidates
 * so the collision report and the write refusal agree on what "same id" means.
 */
function canonicalIssueKey(filename: string, summaryId: string): string {
  const fromName = filename.match(/^ISS-(\d+)/i);
  if (fromName) return `ISS-${fromName[1].padStart(4, '0')}`.toUpperCase();
  const fromFrontmatter = summaryId.match(/^ISS-(\d+)$/i);
  if (fromFrontmatter) return `ISS-${fromFrontmatter[1].padStart(4, '0')}`.toUpperCase();
  return filename;
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

/**
 * Coerce a parsed YAML mapping into the flat shape the epic reader expects.
 * Scalars become strings, sequences become string arrays, absent stays absent.
 */
function normalizeFrontmatter(parsed: Record<string, unknown>): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (value === null || value === undefined) {
      out[key] = '';
    } else if (Array.isArray(value)) {
      out[key] = value.map((v) => (typeof v === 'string' ? v : String(v)));
    } else if (typeof value === 'string') {
      out[key] = value;
    } else if (value instanceof Date) {
      out[key] = value.toISOString();
    } else if (typeof value === 'object') {
      // A nested mapping has no representation in the flat epic model. Keep it
      // legible rather than emitting "[object Object]".
      out[key] = JSON.stringify(value);
    } else {
      out[key] = String(value);
    }
  }
  return out;
}

/**
 * The pre-YAML reader: split each line on its first colon. Retained ONLY as a
 * fallback for records YAML rejects — see parseEpicFrontmatter.
 */
function parseLooseFrontmatter(raw: string): Record<string, string | string[]> {
  const frontmatter: Record<string, string | string[]> = {};
  for (const line of raw.split('\n')) {
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
  return frontmatter;
}

/**
 * Parse epic frontmatter, YAML first.
 *
 * The fenced (`.md`) branch used to hand-roll `key: value` splitting while the
 * bare-YAML branch six lines above used a real parser. Splitting on the first
 * colon reports a block-scalar INDICATOR as the value — `summary: |-` read back
 * as the literal string "|-", losing the whole summary — and then treats every
 * indented prose line containing a colon as its own key. On EPIC-0038 that
 * produced 11 invented keys with names like "STILL LIVE" and "degraded".
 *
 * YAML cannot simply replace it. 7 of 38 epic records on disk have frontmatter
 * a real parser rejects: unquoted values containing ": ", emitted by a write
 * path that does not quote (`title: Epic: Special Characters!`). Parsing those
 * strictly would return null and drop them from list_epics entirely — a worse
 * defect than the one being fixed. So YAML when the record is valid, the loose
 * reader when it is not.
 *
 * The loose path is a compatibility shim for existing damage, not a supported
 * format. It is removable once the write side stops emitting unquoted scalars
 * (EPIC-0038 Phase 1e) and the affected records are repaired.
 */
function parseEpicFrontmatter(raw: string): Record<string, string | string[]> {
  try {
    const parsed = safeParseYaml(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return normalizeFrontmatter(parsed as Record<string, unknown>);
    }
  } catch {
    // Not valid YAML — fall through rather than dropping the record.
  }
  return parseLooseFrontmatter(raw);
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

    const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!frontmatterMatch) return null;

    const frontmatter = parseEpicFrontmatter(frontmatterMatch[1]);

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

/**
 * Resolve an issue id to every file it could plausibly mean.
 *
 * Matching runs in tiers of decreasing specificity and returns only the FIRST
 * NON-EMPTY tier. That ordering is load-bearing: an exact filename outranks an
 * ISS-NNNN prefix, so passing a filename stays a reliable way to name one
 * member of a duplicate-id pair. Ambiguity is only ever reported within a
 * single tier, never across tiers.
 *
 * Returning an array rather than the first hit is the point. Duplicate ISS-NNNN
 * ids exist in the wild (ISS-0131), and `files.find(...)` resolved them in
 * fs.readdir order — so every writer had an undefined target, silently edited
 * one record, silently left the other untouched, and returned success.
 */
async function findIssueCandidates(
  projectId: string | undefined,
  issueId: string
): Promise<Array<{ filePath: string; filename: string }>> {
  const resolved = resolveProjectPaths(projectId);
  const issuesDir = resolved.subPath('sentinel', 'issues');
  const at = (filename: string) => ({ filePath: path.join(issuesDir, filename), filename });

  try {
    const files = await fs.readdir(issuesDir);

    // Tier 1: exact filename. A directory cannot hold two of these.
    if (files.includes(issueId)) {
      return [at(issueId)];
    }

    // Tier 2: filename + record extension. At most one per extension, and the
    // extension order (.md, .yml, .yaml) is the established precedence.
    if (!isRecordFile(issueId)) {
      for (const ext of ['.md', '.yml', '.yaml']) {
        const candidate = `${issueId}${ext}`;
        if (files.includes(candidate)) {
          return [at(candidate)];
        }
      }
    }

    // ISS-NNNN: match filename prefix with word boundary, or frontmatter id
    const issMatch = issueId.match(/^ISS-(\d+)$/i);
    if (issMatch) {
      const padded = `ISS-${issMatch[1].padStart(4, '0')}`.toLowerCase();

      // Tier 3: filename prefix. THIS is where duplicates collide.
      const prefixHits = files.filter((f) => {
        const lower = f.toLowerCase();
        return lower.startsWith(`${padded}-`) || stripRecordExt(lower) === padded;
      });
      if (prefixHits.length > 0) {
        return prefixHits.map(at);
      }

      // Tier 4: frontmatter id, for legacy retroactively-stamped issues.
      const fmHits: string[] = [];
      for (const f of files) {
        if (!isRecordFile(f)) continue;
        try {
          const content = await fs.readFile(path.join(issuesDir, f), 'utf-8');
          const region = frontmatterRegion(content);
          if (!region) continue;
          const idLine = region.split('\n').find((l) => l.trim().toLowerCase().startsWith('id:'));
          if (!idLine) continue;
          const idVal = idLine.slice(idLine.indexOf(':') + 1).trim().toLowerCase();
          if (idVal === padded) fmHits.push(f);
        } catch {
          // skip unreadable
        }
      }
      if (fmHits.length > 0) return fmHits.map(at);
    }

    // Tier 5: fuzzy substring. Genuinely ambiguous when it hits more than once
    // (`ISS-011` spans ISS-0110, ISS-0112, ISS-0119), so it reports all of them.
    const fuzzyHits = files.filter((f) => f.toLowerCase().includes(issueId.toLowerCase()));
    return fuzzyHits.map(at);
  } catch {
    return [];
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
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.projectId);
  } catch (err) {
    return makeProjectResolutionError('create issue');
  }

  // Epic validation stays here: it is a policy question about this project's
  // epics, not a storage concern, so it does not belong behind the repository.
  if (input.epic_id) {
    const allEpics = await getAllEpics(input.projectId);
    if (!allEpics.some((e) => e.id === input.epic_id)) {
      return {
        error: 'EPIC_NOT_FOUND',
        epic_id: input.epic_id,
        message: `Unknown epic_id ${input.epic_id}.`,
        suggested_epics: allEpics.slice(0, 5).map((e) => ({ id: e.id, title: e.title })),
      };
    }
  }

  const repo = new FsIssueRepository(resolved.subPath('sentinel', 'issues'));

  // The repository allocates and writes under one cross-process lock and stamps
  // a uid at birth — which the previous writer did not, so every issue filed
  // since the Phase 3 backfill was landing without a stable identity.
  //
  // Path traversal is not reachable here: the filename is built from an
  // allocated ISS-NNNN plus a slug that strips everything outside [a-z0-9-],
  // so a hostile title cannot escape the issues directory.
  const created = await repo.create({
    title: input.title,
    details: input.details,
    severity: input.severity,
    epicId: input.epic_id,
    project: resolved.id,
    // Forwarded rather than dropped. CreateIssueSpec has accepted these all
    // along; omitting them here meant a caller could pass priority:'high' and
    // watch it vanish with no error, because create_issue's schema allows
    // additional properties.
    priority: input.priority,
    tags: input.tags,
  });

  log(`Sentinel: Created issue at ${created.path} (project: ${resolved.id})`);

  await emitCreateProvenance(
    `sentinel:issue:${created.filename}`,
    await fs.readFile(created.path, 'utf-8'),
    `Created issue: ${input.title}`,
    input.projectId
  );

  return {
    id: created.issue.id,
    timestamp: created.issue.created_at ?? new Date().toISOString(),
    path: created.path,
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
): Promise<CloseIssueOutput | CloseIssueError | AmbiguousIssueIdError | ProjectResolutionError> {
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.projectId);
  } catch (err) {
    return makeProjectResolutionError('close issue');
  }

  const repo = new FsIssueRepository(resolved.subPath('sentinel', 'issues'));

  try {
    // One call replaces the format fork this function used to carry. The
    // bare-YAML branch was where close_issue historically failed: its
    // frontmatter-anchored regexes silently no-opped on a delimiter-less
    // record, so status stayed `open` while the markdown resolution append
    // still fired — corrupting the YAML and reporting success. The codec has
    // one write path for both formats, so that divergence cannot recur.
    const closed = await repo.close(
      input.issue_id,
      input.resolution ?? '',
      input.status ?? 'closed'
    );

    log(`Sentinel: Closed issue at ${closed.path}`);

    return {
      id: closed.issue.id,
      path: closed.path,
      status: closed.issue.status as IssueStatus,
      closed_at: closed.issue.closed_at ?? new Date().toISOString(),
      resolution: input.resolution,
    };
  } catch (err) {
    if (err instanceof RepoAmbiguousIssueIdError) {
      return {
        error: 'AMBIGUOUS_ISSUE_ID',
        projectId: resolved.id,
        issue_id: input.issue_id,
        message:
          `"${input.issue_id}" matches ${err.candidates.length} records in project "${resolved.id}", ` +
          `so the write target is undefined and nothing was changed. ` +
          `Re-run with one of these filenames as issue_id: ${err.candidates.join(', ')}`,
        candidates: err.candidates,
      };
    }
    if (err instanceof RepoIssueNotFoundError) {
      const available = await getProjectIssues(input.projectId);
      return {
        error: 'ISSUE_NOT_FOUND',
        projectId: resolved.id,
        issue_id: input.issue_id,
        message: `Could not find issue matching "${input.issue_id}" in project "${resolved.id}".`,
        available_issues: available.slice(0, 5),
      };
    }
    throw err;
  }
}

/**
 * Delegates to the Phase 3 repository. The output contract is unchanged — the
 * point of the seam is that callers cannot tell which layer answered.
 *
 * `degraded` changes meaning slightly and for the better: it used to mean "only
 * parsed after salvaging corrupted YAML", and now means "readable, but the
 * codec had to interpret something" — a superset that also catches a legacy
 * status value or a title that fell back to the filename. Both are the same
 * repair queue.
 */
export async function listRepoIssues(
  input: ListRepoIssuesInput
): Promise<ListRepoIssuesOutput | ProjectResolutionError> {
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.projectId);
  } catch (err) {
    return makeProjectResolutionError('list issues');
  }

  const repo = new FsIssueRepository(resolved.subPath('sentinel', 'issues'));
  const [records, integrity] = await Promise.all([
    repo.list(input.status ? { status: input.status } : {}),
    repo.integrity(),
  ]);

  const issues: IssueSummary[] = records.map((r) => toIssueSummary(r, integrity));
  issues.sort((a, b) => b.id.localeCompare(a.id));

  const out: ListRepoIssuesOutput = { issues };
  if (integrity.malformed.length > 0) {
    out.malformed = integrity.malformed.length;
    out.malformed_files = integrity.malformed;
  }
  if (integrity.degraded.length > 0) {
    out.degraded = integrity.degraded.length;
    out.degraded_files = integrity.degraded.map((d) => d.filename);
  }
  const dupEntries = Object.entries(integrity.duplicateIds);
  if (dupEntries.length > 0) {
    out.duplicate_ids = dupEntries.length;
    out.duplicate_id_files = Object.fromEntries(dupEntries);
  }
  return out;
}

/** Canonical record -> the wire shape this module has always returned. */
function toIssueSummary(
  r: StoredIssue,
  integrity: { degraded: Array<{ filename: string }> }
): IssueSummary {
  // Records with no ISS-NNNN have always been identified on the wire by their
  // filename INCLUDING the extension, and close_issue/read_issue accept that
  // form. The canonical model drops the extension, which is tidier and which
  // the repository resolves either way — but changing it here would be a wire
  // contract change smuggled in on a refactor. ISS-0113 tracks the
  // inconsistency deliberately; this migration stays behaviour-preserving.
  const wireId = /^ISS-\d+$/i.test(r.issue.id) ? r.issue.id : r.filename;

  const summary: IssueSummary = {
    id: wireId,
    title: r.issue.title,
    severity: (r.issue.severity as Severity) ?? 'low',
    status: r.issue.status as IssueStatus,
    epic_id: r.issue.epicId,
    priority: r.issue.priority,
    tags: r.issue.tags,
    created_at: r.issue.created_at,
    updated_at: r.issue.updated_at,
  };
  if (integrity.degraded.some((d) => d.filename === r.filename)) summary.degraded = true;
  return summary;
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

  await writeFileAtomic(filePath, content);
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

/**
 * Locate the file backing an epic id.
 *
 * Boundary-matched deliberately. A bare `startsWith` has no boundary, so
 * `EPIC-003` would match EPIC-0030, EPIC-0031 and EPIC-0038 at once and the
 * caller would silently write to whichever readdir returned first — the same
 * defect that made issue resolution unsafe (ISS-0131). Returning every match
 * lets the caller refuse rather than guess.
 */
async function findEpicFiles(epicsDir: string, epicId: string): Promise<string[]> {
  let files: string[];
  try {
    files = await fs.readdir(epicsDir);
  } catch {
    return [];
  }
  const padded = epicId.match(/^EPIC-(\d+)$/i);
  const canonical = padded ? `epic-${padded[1].padStart(4, '0')}` : epicId.toLowerCase();
  return files.filter((f) => {
    if (!isRecordFile(f)) return false;
    const lower = f.toLowerCase();
    // Exact filename, or the id followed by a non-digit separator.
    return lower === epicId.toLowerCase() || new RegExp(`^${canonical}(?![0-9])`).test(lower);
  });
}

/**
 * Update an epic in place.
 *
 * Epics were write-once: log_epic created them and nothing could change status,
 * priority, summary, or ownership afterwards (ISS-0140). The practical effects
 * were that `status` stayed `planned` forever — making list_epics(status:...)
 * useless and feeding wrong epic state into oracle/roadmap reporting
 * (ISS-0110) — and that correcting an epic meant hand-editing the file, which
 * is the markdown-into-YAML write hazard that corrupted issue records in the
 * first place.
 *
 * Frontmatter is mutated as a parsed object and re-serialized, never patched by
 * regex, and the file is replaced atomically. The body's `## Summary` section
 * mirrors the frontmatter `summary` field, so both are updated together —
 * leaving them to drift is what makes hand-editing an epic error-prone.
 */
export async function updateEpic(
  input: UpdateEpicInput
): Promise<UpdateEpicOutput | EpicNotFoundError | AmbiguousEpicIdError | ProjectResolutionError> {
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.projectId);
  } catch {
    return makeProjectResolutionError('update epic');
  }

  const epicsDir = resolved.subPath('sentinel', 'epics');
  const matches = await findEpicFiles(epicsDir, input.epic_id);

  if (matches.length === 0) {
    const all = await getAllEpics(input.projectId);
    return {
      error: 'EPIC_NOT_FOUND',
      epic_id: input.epic_id,
      message: `Unknown epic_id ${input.epic_id}.`,
      suggested_epics: all.slice(0, 5).map((e) => ({ id: e.id, title: e.title })),
    };
  }
  if (matches.length > 1) {
    return {
      error: 'AMBIGUOUS_EPIC_ID',
      epic_id: input.epic_id,
      message:
        `${matches.length} epic records match "${input.epic_id}". ` +
        `Pass an exact filename to disambiguate.`,
      candidates: matches,
    };
  }

  const filePath = path.join(epicsDir, matches[0]);
  validateWritePath(filePath, resolved);
  const content = await fs.readFile(filePath, 'utf-8');

  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!fmMatch) {
    return {
      error: 'EPIC_NOT_FOUND',
      epic_id: input.epic_id,
      message: `Epic record ${matches[0]} has no parseable frontmatter; refusing to write into a malformed file.`,
      suggested_epics: [],
    };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = safeParseYaml(fmMatch[1]);
  } catch (err) {
    return {
      error: 'EPIC_NOT_FOUND',
      epic_id: input.epic_id,
      message: `Epic record ${matches[0]} has unparseable frontmatter (${
        err instanceof Error ? err.message : String(err)
      }); refusing to write into it.`,
      suggested_epics: [],
    };
  }

  let body = fmMatch[2];
  const changes: string[] = [];

  const applyScalar = (key: string, value: unknown, label = key): void => {
    if (value === undefined) return;
    const before = parsed[key];
    if (before === value) return;
    parsed[key] = value;
    changes.push(`${label}: ${before ?? 'unset'} → ${value}`);
  };

  applyScalar('status', input.status);
  applyScalar('priority', input.priority);
  applyScalar('title', input.title);
  applyScalar('owner', input.owner);
  applyScalar('squad', input.squad);

  if (input.tags !== undefined) {
    parsed.tags = input.tags;
    changes.push(`tags: ${input.tags.length} tag(s)`);
  }

  if (input.summary !== undefined) {
    parsed.summary = input.summary;
    changes.push('summary rewritten');
    // Keep the body's Summary section in step with frontmatter. They are two
    // copies of one value; letting them diverge is what makes an epic
    // untrustworthy to read.
    const summarySection = /^## Summary\s*\n[\s\S]*?(?=\n## |\s*$)/m;
    const replacement = `## Summary\n\n${input.summary}\n`;
    body = summarySection.test(body)
      ? body.replace(summarySection, replacement)
      : `${body.trimEnd()}\n\n${replacement}`;
  }

  if (input.note) {
    const stamp = new Date().toISOString();
    body = `${body.trimEnd()}\n\n## Note (${stamp})\n\n${input.note}\n`;
    changes.push('note appended');
  }

  if (changes.length === 0) {
    return {
      id: String(parsed.id ?? input.epic_id),
      path: filePath,
      status: (parsed.status as EpicStatus) ?? 'planned',
      priority: (parsed.priority as Priority) ?? 'medium',
      updated_at: String(parsed.updated_at ?? ''),
      changes: [],
    };
  }

  const updatedAt = new Date().toISOString();
  parsed.updated_at = updatedAt;

  const frontmatter = stringifyYaml(parsed, { lineWidth: 0 }).trimEnd();
  const rebuilt = `---\n${frontmatter}\n---\n\n${body.replace(/^\n+/, '').trimEnd()}\n`;

  await writeFileAtomic(filePath, rebuilt);
  log(`Sentinel: Updated epic ${parsed.id} at ${filePath} — ${changes.join(', ')}`);

  return {
    id: String(parsed.id ?? input.epic_id),
    path: filePath,
    status: (parsed.status as EpicStatus) ?? 'planned',
    priority: (parsed.priority as Priority) ?? 'medium',
    updated_at: updatedAt,
    changes,
  };
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
