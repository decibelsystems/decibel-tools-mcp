// ============================================================================
// Issue codec — EPIC-0038 Phase 3
// ============================================================================
// Translates between on-disk records and the canonical Issue model. This is the
// only place that knows there are two formats.
//
// Two rules shape the whole file:
//
// 1. DECODE IS LOSSLESS. Every frontmatter key survives a decode/encode round
//    trip, whether or not the model has a field for it. Records in this store
//    carry keys no interface declares — `repo`, `closed_reason`, `degraded`,
//    `source`, `projectId` alongside `project` — and a codec that emitted only
//    the fields it recognized would silently delete them on the first write.
//    The precedent is real: update_issue once rewrote markdown records as bare
//    YAML and dropped the delimiters, the heading and the body.
//
// 2. THE BODY MIRROR IS OUTPUT, NEVER INPUT. Markdown records repeat status and
//    severity in the body as `**Status:** x` for human readers. Decode ignores
//    those lines entirely and reads frontmatter; encode regenerates them from
//    the model. That asymmetry is the point — it makes the drift that hit
//    sixteen records structurally impossible rather than merely fixed. There is
//    no code path that can write a mirror disagreeing with its frontmatter.
// ============================================================================

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import {
  Issue,
  IssuePriority,
  IssueSeverity,
  isUid,
  normalizeStatus,
} from './issue.js';

export type IssueFormat = 'md' | 'yaml';

export interface DecodedIssue {
  issue: Issue;
  format: IssueFormat;
  /**
   * Everything needed to reconstruct the file byte-for-byte apart from the
   * fields the model owns. Callers should treat this as opaque and pass it back
   * to encodeIssue unchanged.
   */
  raw: {
    data: Record<string, unknown>;
    body: string;
  };
  /**
   * Non-fatal observations: a normalized status, an unrecognized value, a
   * missing title. Surfaced so callers can report integrity problems rather
   * than discovering them months later.
   */
  warnings: string[];
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/** Keys the model owns. Everything else is preserved verbatim in raw.data. */
const MODEL_KEYS = new Set([
  'uid',
  'id',
  'title',
  'status',
  'severity',
  'priority',
  'tags',
  'epic_id',
  'epicId',
  'project',
  'description',
  'details',
  'resolution',
  'created_at',
  'updated_at',
  'closed_at',
]);

function normalizeTags(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const tags = v.filter((t): t is string => typeof t === 'string' && t.trim() !== '');
  return tags.length > 0 ? tags : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v : undefined;
}

/**
 * Split a bare-YAML record into its YAML head and any markdown tail at column 0.
 *
 * The column-0 anchor is load-bearing and must not gain `\s*`: headings indented
 * inside a `description:` block scalar are body text, not a tail, and matching
 * them would truncate the record at parse time. Phase 2 verified no record in
 * the store relies on the difference, but nothing else pins it, so it is pinned
 * by test here.
 */
export function splitBareYaml(content: string): { head: string; tail: string } {
  const lines = content.split('\n');
  const idx = lines.findIndex((l) => /^#{1,6}\s/.test(l));
  if (idx < 0) return { head: content, tail: '' };
  return { head: lines.slice(0, idx).join('\n'), tail: lines.slice(idx).join('\n') };
}

/**
 * Prose under `## Details`, which is where the markdown format keeps the body.
 *
 * This used to stop at the next `##` heading of any kind, which quietly made
 * the format unable to hold a structured issue. Authors write `## Problem`,
 * `## Root Cause`, `## Fix` — 44 records in this store did, and every one read
 * back truncated at the first of them, in two cases from 107 characters to 30.
 *
 * Only ONE trailing section is not the author's: `## Resolution`, which
 * encodeIssue regenerates from `issue.resolution` and which decode reads from
 * frontmatter. Including it here would duplicate it into details and then
 * re-append it on every write. Everything else belongs to the body.
 *
 * The trailing occurrence is the one stripped, not the first — an issue whose
 * prose discusses a resolution mid-body keeps it.
 */
function extractDetails(body: string): string | undefined {
  const m = body.match(/^##\s+Details\s*\n([\s\S]*)$/m);
  if (!m) return undefined;

  let rest = m[1];
  const headings = [...rest.matchAll(/\n##\s+Resolution\s*(?:\n|$)/g)];
  const last = headings[headings.length - 1];
  if (last?.index !== undefined) rest = rest.slice(0, last.index);

  return rest.trim() || undefined;
}

export function decodeIssue(filename: string, content: string): DecodedIssue {
  const warnings: string[] = [];
  const fm = FRONTMATTER_RE.exec(content);

  let data: Record<string, unknown>;
  let body: string;
  let format: IssueFormat;

  if (fm) {
    format = 'md';
    body = fm[2];
    try {
      data = (parseYaml(fm[1]) as Record<string, unknown>) ?? {};
    } catch (err) {
      data = {};
      warnings.push(`frontmatter did not parse: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    format = 'yaml';
    const split = splitBareYaml(content);
    body = split.tail;
    if (split.tail.trim()) {
      // Phase 2 repaired every instance of this. A new one means a writer is
      // appending markdown to bare YAML again.
      warnings.push('bare-YAML record has a markdown tail — a writer is appending prose outside the YAML');
    }
    try {
      data = (parseYaml(split.head) as Record<string, unknown>) ?? {};
    } catch (err) {
      data = {};
      warnings.push(`YAML did not parse: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (typeof data !== 'object' || data === null) {
    data = {};
    warnings.push('record did not parse to an object');
  }

  // ---- id: frontmatter ISS-NNNN, else the filename ------------------------
  const fmId = str(data.id);
  const id =
    (fmId && /^ISS-\d+$/i.test(fmId) ? fmId.toUpperCase() : undefined) ??
    filename.match(/^(ISS-\d+)/i)?.[1]?.toUpperCase() ??
    fmId ??
    filename.replace(/\.(md|ya?ml)$/i, '');

  // ---- title: markdown heading wins, then frontmatter, then filename ------
  const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const title = heading ?? str(data.title) ?? filename.replace(/\.(md|ya?ml)$/i, '');
  if (!heading && !str(data.title)) {
    warnings.push('no title in heading or frontmatter — fell back to the filename');
  }

  // ---- status: the whole reason this codec exists -------------------------
  const norm = normalizeStatus(data.status);
  if (norm.unrecognized) {
    warnings.push(`unrecognized status ${JSON.stringify(data.status)} — read as ${norm.status}`);
  } else if (norm.normalizedFrom) {
    warnings.push(`status ${JSON.stringify(norm.normalizedFrom)} normalized to ${norm.status}`);
  }

  const uid = isUid(data.uid) ? data.uid : undefined;
  if (data.uid !== undefined && !uid) {
    warnings.push(`uid ${JSON.stringify(data.uid)} is not a valid UUIDv7 — ignored`);
  }

  const issue: Issue = {
    uid,
    id,
    title,
    status: norm.status,
    severity: str(data.severity) as IssueSeverity | undefined,
    priority: str(data.priority) as IssuePriority | undefined,
    // An empty tag list and no tag list mean the same thing, and encode omits
    // empty arrays — so decoding [] to [] would make the codec non-idempotent.
    // Twelve records in the store carry `tags: []`; the corpus test caught it.
    tags: normalizeTags(data.tags),
    epicId: str(data.epic_id) ?? str(data.epicId),
    // Both spellings exist; `projectId` is the markdown writer's, `project` the
    // YAML writer's. The model has one, and encode puts it back where it came from.
    project: str(data.project) ?? str(data.projectId),
    details: str(data.description) ?? extractDetails(body),
    resolution: str(data.resolution),
    created_at: str(data.created_at),
    updated_at: str(data.updated_at),
    closed_at: str(data.closed_at),
  };

  // Strip model-owned keys; whatever remains is carried through untouched.
  const preserved: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (!MODEL_KEYS.has(k) && k !== 'projectId') preserved[k] = v;
  }

  return { issue, format, raw: { data: preserved, body }, warnings };
}

/**
 * Rewrite the derived header lines in a markdown body from the model.
 *
 * Only lines that already exist are updated — this does not inject a mirror
 * into a record that never had one, because the mirror is a convention of the
 * markdown writer's layout, not a requirement of the format.
 */
function syncBodyMirror(body: string, issue: Issue): string {
  let out = body;
  out = out.replace(/^\*\*Status:\*\* .*$/m, `**Status:** ${issue.status}`);
  if (issue.severity) {
    out = out.replace(/^\*\*Severity:\*\* .*$/m, `**Severity:** ${issue.severity}`);
  }
  if (issue.epicId) {
    out = out.replace(/^\*\*Epic:\*\* .*$/m, `**Epic:** ${issue.epicId}`);
  }
  // The heading is the title's home in this format; keep them in step.
  out = out.replace(/^#\s+.+$/m, `# ${issue.title}`);

  // Resolution is rendered into the body for the same reason status is: a
  // markdown record is read by people, and `## Resolution` is where they look.
  // It is regenerated from the model rather than stored there, so it cannot
  // drift from frontmatter the way the status mirror did. Writing it ONLY to
  // frontmatter would have been the tidier data model and the worse record —
  // the prose would have silently vanished from every closed issue.
  if (issue.resolution) {
    const section = `## Resolution\n\n${issue.resolution}\n`;
    out = /^##\s+Resolution\s*$/m.test(out)
      ? out.replace(/^##\s+Resolution\s*\n[\s\S]*?(?=\n##\s|$)/m, section)
      : `${out.replace(/\s+$/, '')}\n\n${section}`;
  }
  return out;
}

export function encodeIssue(decoded: DecodedIssue): string {
  const { issue, format, raw } = decoded;

  const data: Record<string, unknown> = {};
  const put = (k: string, v: unknown) => {
    if (v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0)) data[k] = v;
  };

  // Field order is stable so diffs stay readable across writes.
  put('uid', issue.uid);
  put('id', issue.id);
  // Markdown records normally carry the title in the `# heading`, and writing
  // it to frontmatter as well would create a second copy to drift — the same
  // mistake as the status mirror. But a record with no heading has nowhere else
  // to keep it, and omitting it there means the title is silently replaced by
  // the filename on the next read. So: frontmatter holds the title exactly when
  // the body cannot.
  const bodyHasHeading = /^#\s+.+$/m.test(raw.body);
  if (format === 'yaml' || !bodyHasHeading) put('title', issue.title);
  // The markdown writer spells it projectId; keep each format's own spelling so
  // a rewrite is not a gratuitous diff on every record.
  put(format === 'md' ? 'projectId' : 'project', issue.project);
  put('severity', issue.severity);
  put('status', issue.status);
  put('priority', issue.priority);
  put('epic_id', issue.epicId);
  put('tags', issue.tags);
  put('created_at', issue.created_at);
  put('updated_at', issue.updated_at);
  put('closed_at', issue.closed_at);
  // Bare YAML keeps prose in `description`; markdown keeps it in the body.
  if (format === 'yaml') put('description', issue.details);
  put('resolution', issue.resolution);

  // Preserved unknown keys land after the model's, so they never displace a
  // known field's position but are never lost either.
  for (const [k, v] of Object.entries(raw.data)) if (!(k in data)) data[k] = v;

  const yaml = stringifyYaml(data, { lineWidth: 0 });

  if (format === 'md') {
    const body = syncBodyMirror(raw.body, issue);
    return `---\n${yaml}---\n${body}`;
  }

  // A bare-YAML tail should not exist post-Phase-2, but if one is present it is
  // pre-existing prose and gets preserved rather than dropped.
  return raw.body.trim() ? `${yaml}\n${raw.body}` : yaml;
}

/** Apply changes to a decoded record, keeping derived state consistent. */
export function applyIssueChanges(decoded: DecodedIssue, changes: Partial<Issue>): DecodedIssue {
  return { ...decoded, issue: { ...decoded.issue, ...changes } };
}
