#!/usr/bin/env tsx
// ============================================================================
// One-time importer: .decibel/sentinel/issues/*.md  ->  hq.sentinel_issues (Core)
// ============================================================================
// Reads a project's local sentinel issue .md files (via the markdown-safe parser)
// and upserts them into the org-scoped Core Supabase store. Idempotent via
// unique(org_id, project_id, source_key). Uses SERVICE_ROLE (bypasses RLS) and
// sets org_id + created_by explicitly per the contract (created_by=null legacy).
// See EPIC-0033 / ADR-0007 / decibel-hq multi-tenant-store.md.
//
// Usage:
//   tsx scripts/import-store.ts --org <org_uuid> --project <key> --source <.decibel dir> [--dry-run]
//
// --dry-run needs NO creds and writes NOTHING — it just reads+parses and reports.
// A real run needs SUPABASE_URL + SUPABASE_SERVICE_KEY in the environment.
// ============================================================================

import fs from 'fs/promises';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { parseIssueMarkdown } from '../src/store/markdown.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const orgId = arg('org');
  const projectKey = arg('project');
  const source = arg('source');
  const dryRun = process.argv.includes('--dry-run');

  if (!projectKey || !source || (!dryRun && !orgId)) {
    console.error(
      'Usage: tsx scripts/import-store.ts --org <org_uuid> --project <key> --source <.decibel dir> [--dry-run]',
    );
    process.exit(1);
  }

  const issuesDir = path.join(source, 'sentinel', 'issues');
  let files: string[];
  try {
    files = await fs.readdir(issuesDir);
  } catch {
    console.error(`No issues directory at ${issuesDir}`);
    process.exit(1);
  }
  const mdFiles = files.filter((f) => f.endsWith('.md'));
  console.log(`Found ${mdFiles.length} issue .md file(s) in ${issuesDir}`);

  // Parse all up front (validates the markdown reader regardless of mode).
  const rows = await Promise.all(
    mdFiles.map(async (f) => {
      const content = await fs.readFile(path.join(issuesDir, f), 'utf-8');
      return parseIssueMarkdown(f, content);
    }),
  );

  if (dryRun) {
    for (const r of rows) {
      console.log(`[dry-run] ${r.source_key}  status=${r.status} sev=${r.severity ?? '-'} epic=${r.epic_key ?? '-'} title="${r.title.slice(0, 60)}"`);
    }
    console.log(`[dry-run] parsed ${rows.length}/${mdFiles.length} issues OK — no writes performed.`);
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

  // Resolve project label -> uuid within the org.
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
  for (const issue of rows) {
    const row = {
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
      // created_at/updated_at are NOT NULL in the schema; never send null (an explicit
      // null overrides the column default). Fall back: updated_at -> created_at -> now.
      created_at: issue.created_at ?? new Date().toISOString(),
      updated_at: issue.updated_at ?? issue.created_at ?? new Date().toISOString(),
      created_by: null,
    };
    const { error } = await client
      .from('sentinel_issues')
      .upsert(row, { onConflict: 'org_id,project_id,source_key' });
    if (error) {
      console.error(`FAILED ${issue.source_key}: ${error.message}`);
      failed++;
      continue;
    }
    imported++;
  }
  console.log(`Imported ${imported}/${rows.length} issues into org=${orgId} project=${projectKey} (${failed} failed).`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
