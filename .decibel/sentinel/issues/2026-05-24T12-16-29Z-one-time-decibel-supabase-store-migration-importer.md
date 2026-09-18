---
uid: 019e59ea-5323-74dc-9319-69ae6809dd1c
id: 2026-05-24T12-16-29Z-one-time-decibel-supabase-store-migration-importer
projectId: decibel-tools-mcp
severity: med
status: closed
epic_id: EPIC-0033
created_at: 2026-05-24T12:16:29.475Z
closed_at: 2026-05-25T06:35:07.102Z
---

# One-time .decibel → Supabase store migration importer (idempotent)

**Severity:** med
**Status:** closed
**Epic:** EPIC-0033

## Details

One-time idempotent importer (owned in this repo) that reads each registered project's .decibel/<domain> files and upserts into the store keyed by stable IDs, tagged org_id+project_id. Must parse the canonical .md frontmatter format. DEPENDS ON the read_issue/update_issue store-split fix (2026-05-23T23-45-31Z) landing first so issues read cleanly. .decibel/ stays as local cache during transition. Part of EPIC-0033 / ADR-0007.

## Resolution

Built + proven. scripts/import-store.ts: domain-aware (issues|architect), reads .decibel/<domain> files via the markdown-safe parsers, idempotent upsert (on conflict org_id,project_id,source_key), SERVICE_ROLE with org_id+created_by set explicitly, --dry-run (creds-free). Ran for real: 637 sentinel issues across 19 repos + 9 ADRs (decibel-tools-mcp), 0 failures, all org-scoped in the Decibel org. The "depends on read/update store-split fix" caveat was moot — the importer reads .md directly via parseIssueMarkdown/parseAdrMarkdown, not the buggy handlers. friction/oracle reuse the same domain-config pattern when those tables land.
