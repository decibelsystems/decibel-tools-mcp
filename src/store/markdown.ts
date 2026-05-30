// ============================================================================
// Sentinel issue .md <-> IssueRecord (frontmatter + markdown body)
// ============================================================================
// Canonical format written by sentinel.ts createIssue:
//   ---
//   projectId: <label>
//   severity: <sev>
//   status: <status>
//   created_at: <iso>
//   [epic_id: <epic>]
//   ---
//   # <title>
//   **Severity:** ...
//   ## Details
//   <body>
// Reused by FsStore and the migration importer.
// ============================================================================

import { parse as parseYaml } from 'yaml';
import type { IssueRecord, IssueSeverity, IssueStatus, IssuePriority } from './types.js';

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;
const SEVERITIES: IssueSeverity[] = ['low', 'med', 'high', 'critical'];
const STATUSES: IssueStatus[] = ['open', 'in_progress', 'done', 'blocked', 'closed', 'wontfix'];
const PRIORITIES: IssuePriority[] = ['low', 'medium', 'high'];

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}
function oneOf<T extends string>(v: unknown, allowed: readonly T[]): T | undefined {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
}

/** Parse a sentinel issue .md into an IssueRecord. source_key = filename stem (no .md). */
export function parseIssueMarkdown(filename: string, content: string): IssueRecord {
  const source_key = filename.replace(/\.md$/i, '');
  let fm: Record<string, unknown> = {};
  let body = content;

  const m = content.match(FRONTMATTER_RE);
  if (m) {
    try {
      fm = (parseYaml(m[1]) as Record<string, unknown>) ?? {};
    } catch {
      fm = {};
    }
    body = content.slice(m[0].length);
  }

  const heading = body.match(/^#\s+(.+)$/m);
  const title = asString(fm.title) ?? (heading ? heading[1].trim() : source_key);
  const tags = Array.isArray(fm.tags)
    ? (fm.tags.filter((t) => typeof t === 'string') as string[])
    : undefined;

  return {
    source_key,
    title,
    details: body.trim() || undefined,
    severity: oneOf(fm.severity, SEVERITIES),
    status: oneOf(fm.status, STATUSES) ?? 'open',
    priority: oneOf(fm.priority, PRIORITIES),
    epic_key: asString(fm.epic_id) ?? asString(fm.epic_key),
    tags,
    resolution: asString(fm.resolution),
    closed_at: asString(fm.closed_at),
    created_at: asString(fm.created_at),
    updated_at: asString(fm.updated_at),
  };
}

/** Serialize an IssueRecord to sentinel .md (frontmatter + body), markdown-safe (no YAML round-trip of the body). */
export function serializeIssueMarkdown(projectKey: string, issue: IssueRecord): string {
  const fm: string[] = ['---', `projectId: ${projectKey}`];
  if (issue.severity) fm.push(`severity: ${issue.severity}`);
  fm.push(`status: ${issue.status}`);
  if (issue.priority) fm.push(`priority: ${issue.priority}`);
  if (issue.epic_key) fm.push(`epic_id: ${issue.epic_key}`);
  if (issue.tags && issue.tags.length > 0) fm.push(`tags: [${issue.tags.join(', ')}]`);
  if (issue.created_at) fm.push(`created_at: ${issue.created_at}`);
  if (issue.updated_at) fm.push(`updated_at: ${issue.updated_at}`);
  if (issue.closed_at) fm.push(`closed_at: ${issue.closed_at}`);
  if (issue.resolution) fm.push(`resolution: ${JSON.stringify(issue.resolution)}`);
  fm.push('---');

  let body: string;
  if (issue.details && /^#\s+/m.test(issue.details)) {
    // Already a full markdown body — preserve verbatim.
    body = issue.details.trim();
  } else {
    const lines = [`# ${issue.title}`, ''];
    if (issue.severity) lines.push(`**Severity:** ${issue.severity}`);
    lines.push(`**Status:** ${issue.status}`, '', '## Details', '', issue.details ?? '');
    body = lines.join('\n');
  }

  return `${fm.join('\n')}\n\n${body}\n`;
}

// ============================================================================
// ADR .md <-> fields (frontmatter + ## Context/## Decision/## Consequences),
// with legacy .yml tolerance. Used by the architect importer + ArchitectStore.
// ============================================================================

export interface AdrFields {
  source_key: string;
  title: string;
  status?: string;
  context?: string;
  decision?: string;
  consequences?: string;
  related_issues: string[];
  related_epics: string[];
  tags?: string[];
  created_at?: string;
  updated_at?: string;
}

/** Normalize a related_* value: native array, JSON-encoded string, or single string → string[]. */
function toStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x) => typeof x === 'string') as string[];
  if (typeof v === 'string' && v.trim()) {
    try {
      const p = JSON.parse(v);
      if (Array.isArray(p)) return p.filter((x) => typeof x === 'string') as string[];
    } catch {
      /* not JSON */
    }
    return [v];
  }
  return [];
}

/** Split a markdown body into its `## Section` → text map (lowercased keys). */
function sectionMap(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  const parts = body.split(/^##\s+/m);
  for (let i = 1; i < parts.length; i++) {
    const seg = parts[i];
    const nl = seg.indexOf('\n');
    const name = (nl === -1 ? seg : seg.slice(0, nl)).trim().toLowerCase();
    out[name] = (nl === -1 ? '' : seg.slice(nl + 1)).trim();
  }
  return out;
}

/** Parse an ADR file → fields, handling new .md (frontmatter + ## sections) AND legacy .yml. */
export function parseAdrMarkdown(filename: string, content: string): AdrFields {
  const source_key = filename.replace(/\.(md|ya?ml)$/i, '');
  if (/\.ya?ml$/i.test(filename)) {
    const y = (parseYaml(content) as Record<string, unknown>) ?? {};
    return {
      source_key,
      title: asString(y.title) ?? source_key,
      status: asString(y.status),
      context: asString(y.context),
      decision: asString(y.decision),
      consequences: asString(y.consequences),
      related_issues: toStringArray(y.related_issues),
      related_epics: toStringArray(y.related_epics),
      tags: Array.isArray(y.tags) ? (y.tags.filter((t) => typeof t === 'string') as string[]) : undefined,
      created_at: asString(y.created_at),
      updated_at: asString(y.updated_at),
    };
  }
  let fm: Record<string, unknown> = {};
  let body = content;
  const m = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (m) {
    try { fm = (parseYaml(m[1]) as Record<string, unknown>) ?? {}; } catch { fm = {}; }
    body = content.slice(m[0].length);
  }
  const heading = body.match(/^#\s+(.+)$/m);
  const sections = sectionMap(body);
  return {
    source_key,
    title: asString(fm.title) ?? (heading ? heading[1].trim() : source_key),
    status: asString(fm.status),
    context: sections['context'] || undefined,
    decision: sections['decision'] || undefined,
    consequences: sections['consequences'] || undefined,
    related_issues: toStringArray(fm.related_issues),
    related_epics: toStringArray(fm.related_epics),
    tags: Array.isArray(fm.tags) ? (fm.tags.filter((t) => typeof t === 'string') as string[]) : undefined,
    created_at: asString(fm.created_at),
    updated_at: asString(fm.updated_at),
  };
}
