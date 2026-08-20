#!/usr/bin/env tsx
// ============================================================================
// One-time importer: .decibel/<domain> files  ->  Core Supabase (hq.<table>)
// ============================================================================
// Reads a project's local project-intel files (markdown-safe parsers) and
// upserts them into the org-scoped Core store. Idempotent via
// unique(org_id, project_id, source_key). SERVICE_ROLE (bypasses RLS) and sets
// org_id + created_by (null = legacy) explicitly. See EPIC-0033 / ADR-0007.
//
// Usage:
//   tsx scripts/import-store.ts --org <org_uuid> --project <key> --source <.decibel dir> [--domain issues|architect] [--dry-run]
//
// --dry-run needs NO creds and writes NOTHING. A real run needs
// SUPABASE_URL + SUPABASE_SERVICE_KEY in the environment.
// ============================================================================

import fs from 'fs/promises';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { parseIssueMarkdown, parseAdrMarkdown } from '../src/store/markdown.js';

const nowIso = () => new Date().toISOString();

interface DomainCfg {
  subdir: string;
  table: string;
  exts: string[];
  parse: (filename: string, content: string) => Record<string, unknown> & { source_key: string };
  toRow: (parsed: Record<string, unknown>, ids: { orgId: string; projectId: string }) => Record<string, unknown>;
  describe: (parsed: Record<string, unknown>) => string;
}

const DOMAINS: Record<string, DomainCfg> = {
  issues: {
    subdir: 'sentinel/issues',
    table: 'sentinel_issues',
    // Issue records exist as both fenced `.md` and bare `.yml`/`.yaml`. This
    // was `['.md']` while the architect domain below already listed all three,
    // so every .yml issue was silently skipped at import — ~530 files across
    // 15 projects never reached hq.sentinel_issues.
    exts: ['.md', '.yml', '.yaml'],
    parse: (f, c) => parseIssueMarkdown(f, c),
    toRow: (i, { orgId, projectId }) => ({
      org_id: orgId,
      project_id: projectId,
      source_key: i.source_key,
      title: i.title,
      details: i.details ?? null,
      severity: i.severity ?? null,
      status: i.status,
      priority: i.priority ?? null,
      epic_key: i.epic_key ?? null,
      tags: i.tags ?? [],
      resolution: i.resolution ?? null,
      closed_at: i.closed_at ?? null,
      created_at: i.created_at ?? nowIso(),
      updated_at: i.updated_at ?? i.created_at ?? nowIso(),
      created_by: null,
    }),
    describe: (i) => `${i.source_key} status=${i.status} sev=${i.severity ?? '-'}`,
  },
  architect: {
    subdir: 'architect/adrs',
    table: 'architect_adrs',
    exts: ['.md', '.yml', '.yaml'],
    parse: (f, c) => parseAdrMarkdown(f, c),
    toRow: (a, { orgId, projectId }) => ({
      org_id: orgId,
      project_id: projectId,
      source_key: a.source_key,
      title: a.title,
      status: a.status ?? 'accepted',
      context: a.context ?? null,
      decision: a.decision ?? null,
      consequences: a.consequences ?? null,
      related_issues: a.related_issues ?? [],
      related_epics: a.related_epics ?? [],
      tags: a.tags ?? [],
      created_at: a.created_at ?? nowIso(),
      updated_at: a.updated_at ?? a.created_at ?? nowIso(),
      created_by: null,
    }),
    describe: (a) => `${a.source_key} status=${a.status ?? '-'} title="${String(a.title).slice(0, 50)}"`,
  },
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const orgId = arg('org');
  const projectKey = arg('project');
  const source = arg('source');
  const domainName = arg('domain') ?? 'issues';
  const dryRun = process.argv.includes('--dry-run');

  const cfg = DOMAINS[domainName];
  if (!cfg) {
    console.error(`Unknown --domain '${domainName}'. Known: ${Object.keys(DOMAINS).join(', ')}`);
    process.exit(1);
  }
  if (!projectKey || !source || (!dryRun && !orgId)) {
    console.error(
      'Usage: tsx scripts/import-store.ts --org <org_uuid> --project <key> --source <.decibel dir> [--domain issues|architect] [--dry-run]',
    );
    process.exit(1);
  }

  const dir = path.join(source, cfg.subdir);
  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch {
    console.error(`No ${domainName} directory at ${dir}`);
    process.exit(1);
  }
  const matched = files.filter((f) => cfg.exts.some((e) => f.toLowerCase().endsWith(e)));
  console.log(`Found ${matched.length} ${domainName} file(s) in ${dir}`);

  const parsed = await Promise.all(
    matched.map(async (f) => {
      const content = await fs.readFile(path.join(dir, f), 'utf-8');
      return cfg.parse(f, content);
    }),
  );

  if (dryRun) {
    for (const p of parsed) console.log(`[dry-run] ${cfg.describe(p)}`);
    console.log(`[dry-run] parsed ${parsed.length}/${matched.length} ${domainName} OK — no writes performed.`);
    return;
  }

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !serviceKey) {
    console.error('A real run requires SUPABASE_URL and SUPABASE_SERVICE_KEY in the environment.');
    process.exit(1);
  }
  const client = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: 'hq' },
  });

  const { data: proj, error: pErr } = await client
    .from('projects')
    .select('id')
    .eq('org_id', orgId!)
    .eq('key', projectKey)
    .maybeSingle();
  if (pErr) throw new Error(`project lookup failed: ${pErr.message}`);
  if (!proj) throw new Error(`project '${projectKey}' not found in org ${orgId}. Create it first.`);
  const projectId = (proj as { id: string }).id;

  let imported = 0;
  let failed = 0;
  for (const p of parsed) {
    const row = cfg.toRow(p, { orgId: orgId!, projectId });
    const { error } = await client.from(cfg.table).upsert(row, { onConflict: 'org_id,project_id,source_key' });
    if (error) {
      console.error(`FAILED ${p.source_key}: ${error.message}`);
      failed++;
      continue;
    }
    imported++;
  }
  console.log(`Imported ${imported}/${parsed.length} ${domainName} into org=${orgId} project=${projectKey} (${failed} failed).`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
