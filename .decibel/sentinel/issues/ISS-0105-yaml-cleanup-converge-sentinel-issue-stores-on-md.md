---
uid: 019dd503-2593-7c15-bded-af8197cd0f94
id: ISS-0105
projectId: decibel-tools-mcp
severity: med
status: open
created_at: 2026-04-28T16:54:06.483Z
---

# YAML cleanup: converge sentinel issue stores on .md

**Severity:** med
**Status:** open

## Details

Two parallel issue stores exist as a half-finished migration from Dec 2025:

- `src/tools/sentinel.ts` — writes .md (active path, used by sentinel_create_issue MCP tool, codereview, voice)
- `src/sentinelIssues.ts` — writes .yml (added Dec 6 2025 as a 'YAML-based issue management' upgrade with ISS-NNNN IDs, typed YAML, 19 unit tests, but never replaced the .md path)

Both have ISS-NNNN IDs now (PR #8 brought the .md side up to parity). The .yml module is dead weight — its createIssue isn't wired to any MCP tool action, just imported as createSentinelIssue in tools/sentinel/index.ts:40 without callers.

## Plan

1. Verify nothing in src/ actually invokes createSentinelIssue/listIssuesForProject/getIssueById/updateIssue/filterByStatus/filterByEpicId from sentinelIssues.ts.
2. Port any unique helpers into sentinel.ts if needed (the safeParseYaml multi-document handler might be worth keeping for parsing legacy .yml files during transition).
3. Delete src/sentinelIssues.ts and its imports in tools/sentinel/index.ts.
4. Decide what to do with existing .yml issue files across projects: either leave them as historical, write a one-off script to convert .yml → .md, or extend sentinel.ts to read .yml as fallback for read-only listing.

## Risk

Low. The .yml store is parallel-but-not-used by the active MCP surface. Tests in tests/sentinelIssues.test.ts will need to be deleted or rewritten against sentinel.ts.

## Cross-project legacy data

Per audit on 2026-04-28, .yml issue counts: senken-trading-agent=171, deck=55, decibel-tools-mcp=56, frontend_v0.2=77, machina=37, decibel-studio=24. These won't be visible via listRepoIssues until converted or until sentinel.ts learns to read .yml too.

## Proposed Fix (triage 2026-05-19)

**Fix**: Two-PR sequence:
1. Port `safeParseYaml` (the multi-document parser) from `sentinelIssues.ts` into the MD side as a fallback reader, so `sentinel.ts` can list legacy `.yml` issues read-only during transition.
2. Delete `src/sentinelIssues.ts` + remove its imports; add a one-off migration script `scripts/migrate-yml-issues.ts` that converts existing `.yml` → `.md` (preserving id + body) and run it across `.decibel/` worldwide.

**Effort**: ~1 day
**Risk**: medium — **PR #14 is a prerequisite**: PR #14 just added a `tools/sentinel.ts → ../sentinelIssues.js` import (the first cross-import between the two CRUD paths). That import must merge and then be migrated/removed before `sentinelIssues.ts` can be deleted. See ISS-0107 for the related open question about that cross-import.
**PR shape**: PR (a) port helpers + add fallback reader; PR (b) delete YAML path + run migration
**Priority**: #6 in recommended sequence (after PR #14 merges)
**Blocked by**: PR #14 merge
