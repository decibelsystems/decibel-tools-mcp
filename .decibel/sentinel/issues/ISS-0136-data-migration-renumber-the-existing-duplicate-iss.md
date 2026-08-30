---
uid: 01a03a87-109d-78a4-bcf6-b194cb836f3b
id: ISS-0136
projectId: decibel-tools-mcp
severity: med
status: closed
created_at: 2026-08-25T20:05:25.277Z
updated_at: 2026-08-30T22:00:15.111Z
closed_at: 2026-08-30T22:00:15.046Z
resolution: |-
  Verified resolved 2026-08-30, two independent checks.

  MECHANISM: src/lib/issueIdAllocator.ts takes a file lock spanning allocation THROUGH successful write (not just the id scan, which would leave the same race), and writes with O_EXCL so a caller that bypasses the lock fails with EEXIST rather than overwriting a real issue. Reachability confirmed, not assumed: allocateAndWriteIssue() is CALLED from src/sentinelIssues.ts:281 and src/domain/issueRepository.ts:301, and issueRepository is the live path (ISS-0149 was created through it this session and landed as ISS-0149-*.md with a correct unique id).

  DATA: 0 duplicate id groups on disk, down from the 4 recorded in EPIC-0038's Measured state (ISS-0015, ISS-0028, ISS-0054, ISS-0112). Counted directly over .decibel/sentinel/issues by filename prefix AND frontmatter id: 147 records carry an ISS id, 147 distinct. list_issues independently reports no duplicate_ids key, which its contract emits only when the count is non-zero.

  NOTE for whoever touches this next: src/tools/sentinel.ts:9 imports allocateAndWriteIssue but never calls it, and getNextIssueNumber() at src/tools/sentinel.ts:408 — the original racy scan-then-write allocator — is still defined and also never called. Both are dead but look live. Removing them is Phase 6 backlog hygiene; leaving them invites a future misdiagnosis.
---

# Data migration: renumber the existing duplicate ISS-NNNN ids across projects

**Severity:** med
**Status:** closed

## Details

Follow-up to ISS-0131, which fixed the CODE defect (writers now refuse an ambiguous id instead of resolving it in fs.readdir order). The DATA is still colliding — ISS-0131 explicitly scoped renumbering out as "a data migration, separate from the code fix".

CURRENT STATE, measured 2026-08-25 via the new list_issues duplicate report on this repo:
  ISS-0015 -> ISS-0015-fix-sentinel-silent-fallback.yml
              ISS-0015-sentinel-falls-back-to-decibel-mcp-data-instead-of.yml
  ISS-0028 -> ISS-0028-add-package-health-scanning-to-sentinel-scan.yml
              ISS-0028-voice-input-for-decibel-dojo-exp-0001-complete.yml
  ISS-0054 -> 2025-12-14T23-20-45.237Z-memory-leak-detected.md   (id in frontmatter)
              ISS-0054-e2e-test-suite-per-test-process-spawn-cost-1s-test.yml
  ISS-0112 -> ISS-0112-array-parameters-serialized-as-strings-in-mcp-faca.md
              ISS-0112-one-click-mac-pc-installer-for-decibel-tools-non-t.md

Note ISS-0054 is a CROSS-FORMAT collision — a timestamp-named file carrying `id: ISS-0054` in frontmatter colliding with an ISS-named file. A filename-only scan (`ls | grep -oE '^ISS-[0-9]+' | uniq -d`) reports only 3 duplicates here and misses it. Any migration script MUST key on the resolved id (filename prefix, else frontmatter id), not the filename, or it will silently leave cross-format pairs behind. ISS-0131's cross-project census counted 63 duplicates total (frontend_v0.2: 34, senken-trading-agent: 16, machina: 8, decibel-tools-mcp: 5, deck: 0) — those per-project numbers predate this fix and should be re-measured with the duplicate report rather than trusted.

WHY IT STILL MATTERS NOW THAT WRITES ARE SAFE:
The refusal is correct but it is a DEGRADED MODE. Every colliding id is an issue that can only be written by passing its full filename, which no caller does by habit and no agent does by default. During the live P0 that surfaced this, senken needed ISS-0105 and got the right one only by luck of readdir order; today it would get a clean refusal instead of the wrong record, which is better but still not a working close_issue.

SUGGESTED APPROACH (not started, needs a call on id-stability):
1. Decide whether renumbering rewrites the id in place (breaks any external reference to the old id — commit trailers, ADRs, cross-repo mentions) or allocates a new id and leaves a tombstone/alias. Cross-repo references argue for aliasing; simplicity argues for rewrite.
2. Whichever wins: the LOWER-numbered/oldest record should keep the id, and the newer claimant gets renumbered, so history stays stable.
3. getNextIssueNumber must be run per-project AFTER the merge so new ids don't land on top of the renumbered set.
4. Dry-run mode that prints the rename plan before touching anything, reviewed per project.

ROOT CAUSE OF THE COLLISIONS, for the record: this is NOT the allocator racing. Verified on the ISS-0112 pair here via `git log --diff-filter=A` — the file carrying `created_at: 2026-06-25` was ADDED to the repo on 2026-08-02, well after ISS-0112 was legitimately allocated on 2026-07-11. A second writer (an import/replay path, not createIssue) injected a record whose id was allocated elsewhere. getNextIssueNumber takes max+1 over the directory and is correct as long as the directory is complete; the import path bypasses it. Any fix that only hardens createIssue will not stop new collisions — see also ISS-0133 (importer skipped .yml issues) and the agentic queue_sync replay path.

Related: ISS-0131 (the code fix), ISS-0133, ISS-0105 (converge issue stores on one format).

## Resolution

Verified resolved 2026-08-30, two independent checks.

MECHANISM: src/lib/issueIdAllocator.ts takes a file lock spanning allocation THROUGH successful write (not just the id scan, which would leave the same race), and writes with O_EXCL so a caller that bypasses the lock fails with EEXIST rather than overwriting a real issue. Reachability confirmed, not assumed: allocateAndWriteIssue() is CALLED from src/sentinelIssues.ts:281 and src/domain/issueRepository.ts:301, and issueRepository is the live path (ISS-0149 was created through it this session and landed as ISS-0149-*.md with a correct unique id).

DATA: 0 duplicate id groups on disk, down from the 4 recorded in EPIC-0038's Measured state (ISS-0015, ISS-0028, ISS-0054, ISS-0112). Counted directly over .decibel/sentinel/issues by filename prefix AND frontmatter id: 147 records carry an ISS id, 147 distinct. list_issues independently reports no duplicate_ids key, which its contract emits only when the count is non-zero.

NOTE for whoever touches this next: src/tools/sentinel.ts:9 imports allocateAndWriteIssue but never calls it, and getNextIssueNumber() at src/tools/sentinel.ts:408 — the original racy scan-then-write allocator — is still defined and also never called. Both are dead but look live. Removing them is Phase 6 backlog hygiene; leaving them invites a future misdiagnosis.
