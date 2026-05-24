// ============================================================================
// Project-Intelligence Store — interface + types
// ============================================================================
// Abstracts read/write of project-intel domains (sentinel/architect/friction/
// oracle) behind a Store interface with two impls:
//   - FsStore       : box-local .decibel/*.md files (dev/self-host, git-tracked)
//   - SupabaseStore : org-scoped Core Supabase tables under RLS (hosted SaaS)
// Selected by config (DECIBEL_STORE). See ADR-0007 / EPIC-0033.
// ============================================================================

export type IssueSeverity = 'low' | 'med' | 'high' | 'critical';
export type IssueStatus = 'open' | 'in_progress' | 'done' | 'blocked' | 'closed' | 'wontfix';
export type IssuePriority = 'low' | 'medium' | 'high';

/**
 * Per-request context carried from DispatchContext into the store.
 * - orgId    : tenant org (hq.orgs.id) from the X-Org-Key header (required by SupabaseStore)
 * - projectKey: project label, e.g. "decibel-hq" → maps to hq.projects.key
 * - userJwt  : caller's Supabase access token from X-User-Key → sets RLS identity on writes
 */
export interface StoreContext {
  orgId?: string;
  projectKey: string;
  userJwt?: string;
}

/**
 * One sentinel issue. Mirrors hq.sentinel_issues domain columns 1:1;
 * id / org_id / project_id / created_by are resolved/assigned by the store, not here.
 */
export interface IssueRecord {
  /** Stable id: issue filename stem (no .md) or ISS-NNNN. Upsert key with org+project. */
  source_key: string;
  title: string;
  /** Full markdown body sans frontmatter. */
  details?: string;
  severity?: IssueSeverity;
  status: IssueStatus;
  priority?: IssuePriority;
  /** Linked epic's source_key (from frontmatter epic_id). */
  epic_key?: string;
  tags?: string[];
  resolution?: string;
  closed_at?: string;
  created_at?: string;
  updated_at?: string;
}

export interface IssueListFilter {
  status?: IssueStatus;
}

export interface IssueStore {
  list(ctx: StoreContext, filter?: IssueListFilter): Promise<IssueRecord[]>;
  get(ctx: StoreContext, sourceKey: string): Promise<IssueRecord | null>;
  /** Insert or update, keyed by (org_id, project_id, source_key). */
  upsert(ctx: StoreContext, issue: IssueRecord): Promise<IssueRecord>;
}

export interface Store {
  readonly kind: 'fs' | 'supabase';
  issues: IssueStore;
  // Future domains: adrs, friction, oracle.
}
