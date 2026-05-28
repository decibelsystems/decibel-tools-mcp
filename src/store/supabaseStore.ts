// ============================================================================
// SupabaseStore — org-scoped project intelligence in Core Supabase under RLS
// ============================================================================
// Write/agent surface for the hosted SaaS. Every call runs as the CALLER:
// a per-request supabase-js client is built with the user's JWT (X-User-Key) as
// Authorization: Bearer, so PostgREST sees role=authenticated and membership RLS
// (hq.is_org_member) scopes reads + writes. NO service_role for tenant ops.
// Tenant routing: (orgId from X-Org-Key, projectKey label) → hq.projects.id.
// Contract co-designed with decibel-hq (multi-tenant-store.md). See ADR-0007.
// ============================================================================

import { createClient } from '@supabase/supabase-js';
import type {
  IssueRecord,
  IssueListFilter,
  IssueStore,
  Store,
  StoreContext,
} from './types.js';

const SCHEMA = 'hq';

function requireEnv(): { url: string; anonKey: string } {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error('SupabaseStore: SUPABASE_URL and SUPABASE_ANON_KEY must be set.');
  }
  return { url, anonKey };
}

/** Per-request client bound to the caller's JWT so RLS applies as that user. Never cached. */
function clientForUser(userJwt: string) {
  const { url, anonKey } = requireEnv();
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: SCHEMA },
    global: { headers: { Authorization: `Bearer ${userJwt}` } },
  });
}

/** Inferred client type (schema-scoped to 'hq'). */
type DbClient = ReturnType<typeof clientForUser>;

/** Decode the `sub` (user id) claim from a JWT for created_by. Supabase verifies the token server-side. */
function jwtSub(jwt: string): string | undefined {
  try {
    const payload = jwt.split('.')[1];
    if (!payload) return undefined;
    const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
    const claims = JSON.parse(json) as { sub?: string };
    return claims.sub;
  } catch {
    return undefined;
  }
}

function requireCtx(ctx: StoreContext): { orgId: string; userJwt: string } {
  if (!ctx.orgId) throw new Error('SupabaseStore: orgId (X-Org-Key) is required for tenant routing.');
  if (!ctx.userJwt) throw new Error('SupabaseStore: userJwt (X-User-Key) is required.');
  return { orgId: ctx.orgId, userJwt: ctx.userJwt };
}

/** Resolve a project label → hq.projects.id within the org (RLS: caller must be a member). */
async function resolveProjectId(
  client: DbClient,
  orgId: string,
  projectKey: string,
): Promise<string> {
  const { data, error } = await client
    .from('projects')
    .select('id')
    .eq('org_id', orgId)
    .eq('key', projectKey)
    .maybeSingle();
  if (error) throw new Error(`SupabaseStore: project lookup failed: ${error.message}`);
  if (!data) {
    throw new Error(`SupabaseStore: project '${projectKey}' not found in org ${orgId} (or caller is not a member).`);
  }
  return (data as { id: string }).id;
}

interface IssueRow {
  source_key: string;
  title: string;
  details: string | null;
  severity: IssueRecord['severity'] | null;
  status: IssueRecord['status'];
  priority: IssueRecord['priority'] | null;
  epic_key: string | null;
  tags: string[] | null;
  resolution: string | null;
  closed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

function rowToIssue(r: IssueRow): IssueRecord {
  return {
    source_key: r.source_key,
    title: r.title,
    details: r.details ?? undefined,
    severity: r.severity ?? undefined,
    status: r.status,
    priority: r.priority ?? undefined,
    epic_key: r.epic_key ?? undefined,
    tags: r.tags ?? undefined,
    resolution: r.resolution ?? undefined,
    closed_at: r.closed_at ?? undefined,
    created_at: r.created_at ?? undefined,
    updated_at: r.updated_at ?? undefined,
  };
}

class SupabaseIssueStore implements IssueStore {
  async list(ctx: StoreContext, filter?: IssueListFilter): Promise<IssueRecord[]> {
    const { orgId, userJwt } = requireCtx(ctx);
    const client = clientForUser(userJwt);
    const projectId = await resolveProjectId(client, orgId, ctx.projectKey);
    let q = client
      .from('sentinel_issues')
      .select('*')
      .eq('org_id', orgId)
      .eq('project_id', projectId);
    if (filter?.status) q = q.eq('status', filter.status);
    const { data, error } = await q;
    if (error) throw new Error(`SupabaseStore: list failed: ${error.message}`);
    return ((data ?? []) as IssueRow[]).map(rowToIssue);
  }

  async get(ctx: StoreContext, sourceKey: string): Promise<IssueRecord | null> {
    const { orgId, userJwt } = requireCtx(ctx);
    const client = clientForUser(userJwt);
    const projectId = await resolveProjectId(client, orgId, ctx.projectKey);
    const { data, error } = await client
      .from('sentinel_issues')
      .select('*')
      .eq('org_id', orgId)
      .eq('project_id', projectId)
      .eq('source_key', sourceKey)
      .maybeSingle();
    if (error) throw new Error(`SupabaseStore: get failed: ${error.message}`);
    return data ? rowToIssue(data as IssueRow) : null;
  }

  async upsert(ctx: StoreContext, issue: IssueRecord): Promise<IssueRecord> {
    const { orgId, userJwt } = requireCtx(ctx);
    const client = clientForUser(userJwt);
    const projectId = await resolveProjectId(client, orgId, ctx.projectKey);
    const createdBy = jwtSub(userJwt);

    const row: Record<string, unknown> = {
      org_id: orgId,
      project_id: projectId,
      source_key: issue.source_key,
      title: issue.title,
      details: issue.details ?? null,
      severity: issue.severity ?? null,
      status: issue.status,
      priority: issue.priority ?? null,
      epic_key: issue.epic_key ?? null,
      tags: issue.tags ?? [],
      resolution: issue.resolution ?? null,
      closed_at: issue.closed_at ?? null,
      updated_at: new Date().toISOString(),
    };
    if (issue.created_at) row.created_at = issue.created_at;
    if (createdBy) row.created_by = createdBy;

    const { data, error } = await client
      .from('sentinel_issues')
      .upsert(row, { onConflict: 'org_id,project_id,source_key' })
      .select('*')
      .single();
    if (error) throw new Error(`SupabaseStore: upsert failed: ${error.message}`);
    return rowToIssue(data as IssueRow);
  }
}

export class SupabaseStore implements Store {
  readonly kind = 'supabase' as const;
  issues: IssueStore = new SupabaseIssueStore();
}
