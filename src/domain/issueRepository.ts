// ============================================================================
// Issue repository — EPIC-0038 Phase 3
// ============================================================================
// The seam between "what an issue is" and "where issues live".
//
// Callers ask for issues by id and get back canonical Issue objects. They do
// not learn whether a record was markdown-with-frontmatter or bare YAML, which
// directory it came from, or how its id was resolved. That is the whole point:
// Phase 5 converges the on-disk format and should be a change to the codec and
// this file only, and a future SupabaseIssueRepository should be a sibling
// rather than a rewrite of every caller.
//
// Resolution is the subtle part. An id can name more than one record — four
// duplicate groups existed before Phase 2 repaired them — and the historical
// failure mode was `files.find(...)` picking whichever the directory listing
// happened to yield first, so writers had an undefined target and reported
// success either way. Ambiguity is therefore an error here, never a guess.
// ============================================================================

import { promises as fs } from 'fs';
import path from 'path';
import { writeFileAtomic } from '../lib/atomicWrite.js';
import { allocateAndWriteIssue } from '../lib/issueIdAllocator.js';
import {
  Issue,
  IssuePriority,
  IssueSeverity,
  IssueStatus,
  isLive,
  newUid,
} from './issue.js';
import {
  DecodedIssue,
  IssueFormat,
  decodeIssue,
  encodeIssue,
} from './issueCodec.js';

/** An issue plus where it lives. The path is for diagnostics, not for callers to write through. */
export interface StoredIssue {
  issue: Issue;
  filename: string;
  path: string;
  format: IssueFormat;
  /** Integrity observations from decoding. Empty for a healthy record. */
  warnings: string[];
}

export interface IssueListFilter {
  status?: IssueStatus;
  /** All non-terminal statuses. Distinct from status:'open', which is one value. */
  liveOnly?: boolean;
  epicId?: string;
}

export interface CreateIssueSpec {
  title: string;
  details: string;
  severity: IssueSeverity;
  priority?: IssuePriority;
  epicId?: string;
  tags?: string[];
  project?: string;
}

/**
 * Integrity state of the whole store, reported alongside a listing rather than
 * discovered mid-incident.
 *
 * The distinction that matters: `malformed` records are invisible to callers,
 * so a silent skip would make a broken store look like a shorter clean one.
 * `degraded` records are readable but carry something the codec had to
 * interpret. Both are repair queues, not cosmetics — a duplicate id makes an
 * issue unwritable, because the repository refuses an ambiguous target.
 */
export interface StoreIntegrity {
  malformed: string[];
  degraded: Array<{ filename: string; warnings: string[] }>;
  duplicateIds: Record<string, string[]>;
}

export interface IssueRepository {
  integrity(): Promise<StoreIntegrity>;
  list(filter?: IssueListFilter): Promise<StoredIssue[]>;
  get(idOrFilename: string): Promise<StoredIssue | null>;
  create(spec: CreateIssueSpec): Promise<StoredIssue>;
  update(idOrFilename: string, changes: Partial<Issue>): Promise<StoredIssue>;
  close(idOrFilename: string, resolution: string, status?: 'closed' | 'wontfix'): Promise<StoredIssue>;
}

export class AmbiguousIssueIdError extends Error {
  readonly code = 'AMBIGUOUS_ISSUE_ID';
  constructor(
    readonly issueId: string,
    readonly candidates: string[]
  ) {
    super(
      `Issue id ${issueId} matches ${candidates.length} records: ${candidates.join(', ')}. ` +
        `Name one by filename, or by its uid, to disambiguate.`
    );
    this.name = 'AmbiguousIssueIdError';
  }
}

export class IssueNotFoundError extends Error {
  readonly code = 'ISSUE_NOT_FOUND';
  constructor(readonly issueId: string) {
    super(`Issue ${issueId} not found.`);
    this.name = 'IssueNotFoundError';
  }
}

const RECORD_RE = /\.(md|ya?ml)$/i;

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

export class FsIssueRepository implements IssueRepository {
  constructor(private readonly issuesDir: string) {}

  private async readAll(): Promise<StoredIssue[]> {
    let names: string[];
    try {
      names = (await fs.readdir(this.issuesDir)).filter((f) => RECORD_RE.test(f));
    } catch {
      return [];
    }

    const out: StoredIssue[] = [];
    for (const filename of names) {
      const full = path.join(this.issuesDir, filename);
      let content: string;
      try {
        content = await fs.readFile(full, 'utf-8');
      } catch {
        continue; // Unreadable record: skip rather than fail the whole listing.
      }
      const decoded = decodeIssue(filename, content);
      out.push({
        issue: decoded.issue,
        filename,
        path: full,
        format: decoded.format,
        warnings: decoded.warnings,
      });
    }
    return out;
  }

  /**
   * Duplicate detection deliberately runs over EVERY record, never a filtered
   * subset: a closed twin still makes an id ambiguous for writers, so filtering
   * it out of a listing must not filter it out of the collision report.
   */
  async integrity(): Promise<StoreIntegrity> {
    const all = await this.readAll();
    const malformed: string[] = [];
    const degraded: Array<{ filename: string; warnings: string[] }> = [];
    const claims = new Map<string, string[]>();

    for (const r of all) {
      const unparseable = r.warnings.some((w) => w.includes('did not parse'));
      if (unparseable) malformed.push(r.filename);
      else if (r.warnings.length > 0) degraded.push({ filename: r.filename, warnings: r.warnings });

      const key = r.issue.id.toUpperCase();
      claims.set(key, [...(claims.get(key) ?? []), r.filename]);
    }

    const duplicateIds: Record<string, string[]> = {};
    for (const [id, files] of claims) if (files.length > 1) duplicateIds[id] = files;

    return { malformed, degraded, duplicateIds };
  }

  async list(filter: IssueListFilter = {}): Promise<StoredIssue[]> {
    // A record that did not parse is not an issue — returning it would hand
    // callers a husk built from filename fallbacks. It is still counted by
    // integrity(), so the file is reported rather than silently dropped.
    let all = (await this.readAll()).filter(
      (r) => !r.warnings.some((w) => w.includes('did not parse'))
    );
    if (filter.status) all = all.filter((r) => r.issue.status === filter.status);
    if (filter.liveOnly) all = all.filter((r) => isLive(r.issue.status));
    if (filter.epicId) all = all.filter((r) => r.issue.epicId === filter.epicId);
    return all;
  }

  /**
   * Resolve an id to exactly one record, in tiers of decreasing specificity.
   *
   * Only the first non-empty tier is considered, and ambiguity is reported
   * within a tier rather than across tiers — so naming a record by its filename
   * stays a reliable way to pick one member of a duplicate pair even while the
   * shared ISS-NNNN remains ambiguous. uid is checked first because it is the
   * only identifier guaranteed unique by construction.
   */
  private async resolve(idOrFilename: string): Promise<StoredIssue[]> {
    const all = await this.readAll();
    const needle = idOrFilename.trim();
    const upper = needle.toUpperCase();

    const byUid = all.filter((r) => r.issue.uid && r.issue.uid === needle);
    if (byUid.length > 0) return byUid;

    const byFilename = all.filter((r) => r.filename.toUpperCase() === upper);
    if (byFilename.length > 0) return byFilename;

    // Filename without the extension, which is how list output used to name records.
    const byStem = all.filter(
      (r) => r.filename.replace(RECORD_RE, '').toUpperCase() === upper.replace(RECORD_RE, '')
    );
    if (byStem.length > 0) return byStem;

    // ISS-NNNN, requiring the id to end at a separator or the extension. A bare
    // startsWith made "ISS-011" swallow ISS-0110, ISS-0112 and ISS-0119.
    const byId = all.filter((r) => {
      if (r.issue.id.toUpperCase() === upper) return true;
      const base = r.filename.toUpperCase();
      if (!base.startsWith(upper)) return false;
      const rest = base.slice(upper.length);
      return rest === '' || rest.startsWith('-') || /^\.(MD|YA?ML)$/.test(rest);
    });
    if (byId.length > 0) return byId;

    // Last tier: a partial id like "ISS-011", which is a prefix of ISS-0110,
    // ISS-0112 and ISS-0119. The boundary rule above deliberately refuses to
    // resolve it, but refusing is not the same as saying nothing is there —
    // "not found" would be a misleading answer when three records obviously
    // start with it. So a loose prefix is reported as a collision when it spans
    // several records, and is NEVER resolved to a single one: silently picking
    // one is the swallow bug this whole tier system exists to prevent.
    const loose = all.filter((r) => r.filename.toUpperCase().startsWith(upper));
    return loose.length > 1 ? loose : [];
  }

  async get(idOrFilename: string): Promise<StoredIssue | null> {
    const matches = await this.resolve(idOrFilename);
    if (matches.length === 0) return null;
    if (matches.length > 1) {
      throw new AmbiguousIssueIdError(idOrFilename, matches.map((m) => m.filename));
    }
    return matches[0];
  }

  private async requireOne(idOrFilename: string): Promise<StoredIssue> {
    const found = await this.get(idOrFilename);
    if (!found) throw new IssueNotFoundError(idOrFilename);
    return found;
  }

  async create(spec: CreateIssueSpec): Promise<StoredIssue> {
    const now = new Date().toISOString();
    const slug = slugify(spec.title);

    // Allocation and write happen under one cross-process lock (Phase 1). Every
    // new record gets a uid at birth, so the backfill only ever has to deal
    // with records that predate this path.
    const issue: Issue = {
      uid: newUid(),
      id: 'ISS-PENDING',
      title: spec.title,
      status: 'open',
      severity: spec.severity,
      priority: spec.priority,
      tags: spec.tags,
      epicId: spec.epicId,
      project: spec.project,
      details: spec.details,
      created_at: now,
    };

    const build = (issueId: string): string => {
      const body = [
        `# ${spec.title}`,
        '',
        `**Severity:** ${spec.severity}`,
        `**Status:** open`,
        ...(spec.epicId ? [`**Epic:** ${spec.epicId}`] : []),
        '',
        '## Details',
        '',
        spec.details,
        '',
      ].join('\n');

      const decoded: DecodedIssue = {
        issue: { ...issue, id: issueId },
        format: 'md',
        raw: { data: {}, body },
        warnings: [],
      };
      return encodeIssue(decoded);
    };

    const allocated = await allocateAndWriteIssue(this.issuesDir, 'md', slug, build);
    return this.requireOne(allocated.filename);
  }

  async update(idOrFilename: string, changes: Partial<Issue>): Promise<StoredIssue> {
    const current = await this.requireOne(idOrFilename);
    const content = await fs.readFile(current.path, 'utf-8');
    const decoded = decodeIssue(current.filename, content);

    const updated: DecodedIssue = {
      ...decoded,
      issue: {
        ...decoded.issue,
        ...changes,
        // Identity is not editable through update. Renumbering is a migration.
        uid: decoded.issue.uid ?? changes.uid,
        id: decoded.issue.id,
        updated_at: new Date().toISOString(),
      },
    };

    await writeFileAtomic(current.path, encodeIssue(updated));
    return this.requireOne(current.filename);
  }

  async close(
    idOrFilename: string,
    resolution: string,
    status: 'closed' | 'wontfix' = 'closed'
  ): Promise<StoredIssue> {
    const now = new Date().toISOString();
    return this.update(idOrFilename, { status, resolution, closed_at: now });
  }
}
