---
uid: 01a01cb7-d2e5-7f67-97dd-a45f9568fc47
id: ISS-0130
projectId: decibel-tools-mcp
severity: med
status: open
created_at: 2026-08-20T01:10:04.261Z
updated_at: 2026-08-20T05:31:24.753Z
---

# src/store/ (fsStore, supabaseStore) is dead code — nothing in src/ imports it

**Severity:** med
**Status:** open

## Details

src/store/ contains fsStore.ts, supabaseStore.ts, index.ts, types.ts, markdown.ts implementing an IssueStore/Store abstraction. Nothing under src/ imports any of it. The only reference in the whole repo is scripts/import-store.ts, which imports parseIssueMarkdown/parseAdrMarkdown from src/store/markdown.js.

This is an active hazard, not just clutter. While triaging the list_issues .yml bug, the reported root cause was src/store/fsStore.ts:37 — which does contain the exact `if (!f.endsWith('.md')) continue;` line, and reads like the obvious culprit. Patching it would have changed nothing observable, and a post-fix verification would have "confirmed" a fix that never ran. The live path is:

  facade list_issues -> sentinel_list_repo_issues -> listRepoIssues (src/tools/sentinel.ts)

Two more traps in the same area: src/sentinelIssues.ts:listIssuesForProject is a THIRD issue-listing implementation (used by workflow.ts and sentinel_listIssues, and it does read .yml via readFilesFromBothPaths), and src/store/markdown.ts:parseIssueMarkdown requires --- delimiters, which bare-YAML records do not have.

Decide: delete src/store/ and inline what import-store.ts needs, or wire it up as the real store. Leaving three parallel implementations where only one is live guarantees more misdiagnoses.

Related to ISS-0105 (converge sentinel issue stores on .md) and the two-writer duplicate-id friction.

[2026-08-20] SCOPE CORRECTION — do not delete src/store/markdown.ts.

This issue framed the choice as "delete src/store/ or wire it up". Half of that is now off the table: src/store/markdown.ts is LIVE code reached through scripts/import-store.ts, which is the write path into hq.sentinel_issues. It was carrying three real defects that made HQ's hosted issue data wrong (see ISS-0133), now fixed there.

So the accurate split is:
- src/store/markdown.ts — LIVE via the importer. Keep. Arguably belongs next to the importer rather than in a store abstraction nothing else uses.
- src/store/fsStore.ts, supabaseStore.ts, index.ts, types.ts — still unreferenced anywhere in src/ or scripts/. Still the misdiagnosis hazard described above.

The original hazard argument stands and is now demonstrated twice: fsStore.ts:37 was named as the root cause of the list_issues bug and patching it would have changed nothing, while the actual .md-only filters were in tools/sentinel.ts (reader), tools/sentinel.ts (writer) and scripts/import-store.ts (importer). Three real sites, none of them the one that looked obvious.
