---
id: ISS-0133
projectId: decibel-tools-mcp
severity: high
status: open
created_at: 2026-08-20T05:31:13.936Z
---

# import-store.ts skipped every .yml issue — hq.sentinel_issues undercounted for months (code fixed, re-import not run)

**Severity:** high
**Status:** open

## Details

Found by the decibel-hq peer by diffing hq.sentinel_issues against disk, then confirmed here. This is a THIRD patch site for the .md-only filter, separate from listRepoIssues (fixed) and closeIssue (fixed). The landed reader/writer fixes do not touch it, and the data does not self-heal.

THREE DEFECTS, all in the import path:

1. scripts/import-store.ts — DOMAINS.issues had `exts: ['.md']` while DOMAINS.architect, twenty lines below, already had `['.md', '.yml', '.yaml']`. An inconsistency inside a single file, so ADRs imported correctly the whole time and issues did not.

2. src/store/markdown.ts:parseIssueMarkdown — `source_key = filename.replace(/\.md$/i, '')` stripped only .md. A .yml record would have carried its extension into source_key, colliding with any later correct import under a different key for the same issue. This also explains a diagnostic trap decibel-hq hit: querying hq.sentinel_issues for '%.yml' returns zero, which reads as "no yml ever imported" but actually means the column cannot answer the question.

3. parseIssueMarkdown required the `---` fence. Without it, it set fm={} and continued rather than failing, so bare-YAML records would import as junk rows — title falling back to the filename stem, status defaulting to 'open', severity null, and the entire YAML text landing in `details` — while reporting success. Every .yml issue record in this repo is bare, so widening exts alone would have written garbage rows and called it a fix.

MEASURED IMPACT (decibel-hq, exact filename match against disk, not inferred from counts):
  decibel-studio        25 on disk (1 .md) -> exactly 1 row. 96% invisible.
  decibel-tools-mobile  17 on disk (3 .md) -> exactly 3 rows.
  deck                  52 rows = the .md count; 55 .yml dropped.
  Same shape on decibel-vector and pokedeck.
  4 projects whose stores are 100% .yml have no hq.projects row at all — decibel-tools (12), habit-tracker (11), studio-ios (2), fuligin (1). They looked empty at onboarding.

FIXED HERE: all three. exts widened; source_key strips /\.(md|ya?ml)$/i; parseIssueMarkdown parses bare YAML, falls back to the `description` field for details, and applies the same column-0 salvage boundary the reader uses so a close_issue-appended markdown section does not break the parse.

VERIFIED: re-parsing every record from disk now yields decibel-studio 25/25, decibel-tools-mobile 17/17, decibel-tools-mcp 160/162 well-formed, zero source_key collisions.

NOT DONE — NEEDS A DECISION:
The re-import has NOT been run. It writes to Supabase with SERVICE_ROLE across 15 projects and that is Ben's call, not an agent's. It should also not be run in isolation, because decibel-hq found a second, larger defect underneath this one: every row in hq.sentinel_issues shares a max created_at/updated_at of 2026-05-25T06:30:57Z — nothing written in 87 days. That is not extension-related (decibel-hq's own store is 100% .md, 17 on disk, 4 in Supabase). decibel-hq ADR-0008 documents the importer as one-time-not-a-projector, while decibel-hq ADR-0005 puts Supabase directly in the hosted read path with no daemon — so hosted HQ has been serving three-month-stale issue data by design, and nobody reconciled the two.

So the real question is not "re-run the importer" but "does the importer become a projector", which is an ADR-0008 conversation on the decibel-hq side. Tracked there as their ISS-0001.

Related: ISS-0130 (src/store is dead code — import-store.ts turns out to be its only consumer, so it is not deletable as filed), ISS-0129, ISS-0131.
