// ============================================================================
// Canonical issue model — EPIC-0038 Phase 3
// ============================================================================
// The one definition of what an issue IS, independent of how it is stored.
//
// Before this file there were three, and they disagreed:
//
//   src/sentinelIssues.ts   'open' | 'in_progress' | 'done' | 'blocked'
//   src/tools/sentinel.ts   'open' | 'in_progress' | 'blocked' | 'closed' | 'wontfix'
//   src/store/types.ts      both unions merged, plus 'done'
//
// No two agree. `update_issue` could write `done`, which the reader's type did
// not contain; `close_issue` wrote `closed`, which the updater's type did not
// contain. Neither was a type error, because status crossed the boundary as a
// bare string: buildIssueSummary read it with `typeof parsed.status === 'string'`
// and the list filter compared it with `!==`. An out-of-vocabulary value was
// therefore not rejected and not normalized — it was stored, returned, and
// matched by no query.
//
// ISS-0026 is the proof. It sits on disk with `status: resolved`, a value no
// writer in this codebase can produce and no filter can select. It is finished
// work that is invisible to `list_issues(status: 'open')` and equally invisible
// to `list_issues(status: 'closed')`.
//
// So the vocabulary is closed, and everything entering the model goes through
// normalizeStatus(). Unknown values are mapped or flagged, never passed through.
// ============================================================================

import { randomBytes } from 'crypto';

/**
 * The complete status vocabulary. Closed set — if a value is not here, it is
 * not a status, and normalizeStatus decides what to do about it.
 */
export const ISSUE_STATUSES = [
  'open',
  'in_progress',
  'blocked',
  'closed',
  'wontfix',
] as const;

export type IssueStatus = (typeof ISSUE_STATUSES)[number];

/** Statuses meaning "no longer needs work". Everything else is live. */
export const TERMINAL_STATUSES: ReadonlySet<IssueStatus> = new Set<IssueStatus>([
  'closed',
  'wontfix',
]);

export function isTerminal(status: IssueStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export function isLive(status: IssueStatus): boolean {
  return !isTerminal(status);
}

/**
 * Values seen on disk that predate the closed vocabulary, and what they meant.
 *
 * `done` came from sentinelIssues.updateIssue, whose union had it. `resolved`
 * came from a hand-edit or an older tool; ISS-0026 is the only instance. Both
 * mean the work finished, so both map to `closed` — the mapping is recorded on
 * the decoded record rather than applied silently, so a caller can tell the
 * difference between a record that said `closed` and one that was interpreted.
 */
const STATUS_ALIASES: Readonly<Record<string, IssueStatus>> = {
  done: 'closed',
  resolved: 'closed',
  complete: 'closed',
  completed: 'closed',
  fixed: 'closed',
  wont_fix: 'wontfix',
  'wont-fix': 'wontfix',
  duplicate: 'closed',
  reopened: 'open',
  todo: 'open',
  new: 'open',
  active: 'in_progress',
  in_review: 'in_progress',
};

export interface NormalizedStatus {
  status: IssueStatus;
  /** Set when the raw value was not already canonical. */
  normalizedFrom?: string;
  /**
   * True when the raw value matched nothing and the fallback was used. The
   * caller decides whether that is a warning or a hard error; the model will
   * not invent a meaning for a value it does not recognize.
   */
  unrecognized?: boolean;
}

/**
 * Map any on-disk status to the canonical vocabulary.
 *
 * Missing status defaults to `open` — that matches the previous reader's
 * behaviour and is the safe direction: a record wrongly shown as open gets
 * triaged, whereas one wrongly shown as closed disappears.
 */
export function normalizeStatus(raw: unknown): NormalizedStatus {
  if (typeof raw !== 'string' || raw.trim() === '') {
    // Absent is not the same as wrong: a record with no status is defaulted
    // quietly, while a record whose status is an empty string or a number is
    // flagged, because something wrote that on purpose.
    if (raw === undefined || raw === null) return { status: 'open' };
    return { status: 'open', normalizedFrom: String(raw), unrecognized: true };
  }

  const key = raw.trim().toLowerCase();
  if ((ISSUE_STATUSES as readonly string[]).includes(key)) {
    const status = key as IssueStatus;
    return key === raw ? { status } : { status, normalizedFrom: raw };
  }

  const aliased = STATUS_ALIASES[key];
  if (aliased) return { status: aliased, normalizedFrom: raw };

  return { status: 'open', normalizedFrom: raw, unrecognized: true };
}

export const ISSUE_SEVERITIES = ['low', 'med', 'high', 'critical'] as const;
export type IssueSeverity = (typeof ISSUE_SEVERITIES)[number];

export const ISSUE_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;
export type IssuePriority = (typeof ISSUE_PRIORITIES)[number];

/**
 * A stable identifier that survives everything the human-facing id does not.
 *
 * ISS-NNNN is a display name: it is derived from a directory scan, it is
 * reassigned when duplicates are repaired (four were, in Phase 2), and it is
 * allocated independently per checkout — which is exactly how the same issue
 * came to exist as ISS-0112 on one volume and ISS-0115 on another with nothing
 * in the data connecting them. `uid` is the identity; `id` is the label.
 *
 * UUIDv7 rather than v4 because it is time-ordered: records sort by creation
 * without consulting a timestamp field, and a Postgres index on it stays local
 * rather than scattering writes across the tree when this reaches HQ sync.
 */
export function newUid(now: number = Date.now()): string {
  const bytes = randomBytes(16);

  // 48-bit big-endian millisecond timestamp.
  bytes[0] = (now / 2 ** 40) & 0xff;
  bytes[1] = (now / 2 ** 32) & 0xff;
  bytes[2] = (now / 2 ** 24) & 0xff;
  bytes[3] = (now / 2 ** 16) & 0xff;
  bytes[4] = (now / 2 ** 8) & 0xff;
  bytes[5] = now & 0xff;

  bytes[6] = (bytes[6] & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant

  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const UID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUid(value: unknown): value is string {
  return typeof value === 'string' && UID_RE.test(value);
}

/**
 * One issue, as the rest of the system should think about it.
 *
 * Deliberately absent: file path, file format, frontmatter layout, and the
 * `**Status:**` line that markdown records carry in their body. That line is a
 * rendering of `status`, not a second copy of it — treating it as data is what
 * let sixteen records drift into saying `open` while the tools read them as
 * closed. The codec regenerates it on write; nothing else may touch it.
 */
export interface Issue {
  /** Stable identity. Optional only until the backfill completes. */
  uid?: string;
  /** Human-facing label, e.g. ISS-0112. Renumberable; not identity. */
  id: string;
  title: string;
  status: IssueStatus;
  severity?: IssueSeverity;
  priority?: IssuePriority;
  tags?: string[];
  epicId?: string;
  project?: string;
  /** Prose body: the markdown after the header block, or `description:`. */
  details?: string;
  resolution?: string;
  created_at?: string;
  updated_at?: string;
  closed_at?: string;
}
