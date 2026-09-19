---
uid: 01a0b73a-ccd3-7256-af94-4370bd868ab6
id: ISS-0175
projectId: decibel-tools-mcp
severity: med
status: open
priority: medium
tags:
  - sentinel
  - duplicate-id
  - multi-user
  - git
  - record-identity
  - peer-reported
created_at: 2026-09-19T01:14:39.186Z
linked_commits:
  - sha: 824aaf62ff4342a4b6058b8c8ad227b17d3615f0
    shortSha: 824aaf6
    message: "sentinel: ISS-0175 — record identity does not survive parallel clones"
    relationship: related
    linked_at: 2026-09-19T01:14:56.384Z
    linked_by: ai:claude
updated_at: 2026-09-19T01:14:56.384Z

---
# ISS-NNNN identity does not survive parallel clones — the lock is per-filesystem and git merges the collision cleanly

**Severity:** med
**Status:** open

## Details

REPORTED BY. decibel-marketing peer session, 2026-09-18, while checking what
the "git is the team layer" positioning actually depends on. Triaged and
partly corrected here.

THE CLAIM, AND IT HOLDS. recordIdAllocator.ts closes the concurrent-PROCESS
race properly — the lock spans allocation through successful write, not just
the scan, with O_EXCL as a second defence for callers that bypass it. Its own
doc comment is explicit that "a lock only protects callers that take it", and
a lock file protects callers sharing a FILESYSTEM. Three people on three
laptops each scan their own clone, each allocate ISS-0141, each commit a file
whose slug differs. Git merges both without a conflict, because the filenames
are not the same. One repo, two issues, one id, and no write ever collided.

This matters more now than it did: Ben is calibrating on small teams (2-8) and
three people already share state through git, so the repository IS the
multi-user surface. Sequential ids allocated per-clone cannot stay unique
across it.

CORRECTIONS TO THE REPORT.

1. The peer cited four live duplicate groups (ISS-0015, ISS-0028, ISS-0054,
   ISS-0112). Checked: only ONE duplicate id exists on disk today, ISS-0104 —
   "Close stale test fixture issues from 2025-12-14" and "[review/security]
   close_issue accepts and writes into malformed-frontmatter files", created
   nine days apart. The others appear to have been cleaned up. ISS-0136 already
   tracks renumbering the historical duplicates.

2. The peer credited list_issues with surfacing duplicate_ids/duplicate_id_files.
   It does not, at least not on this path: a full open-status list_issues today
   returns no such field. Both ISS-0104 records are closed, so the duplicate is
   not visible in that listing at all. The reader-side handling is NOT as good
   as the report assumes — this degrades more quietly than credited.

3. Related and confirmed today from a different direction: the same shape hit
   the EPIC store, where two files claimed EPIC-0034 and read_epic returned the
   test fixture rather than the real epic, with the winner decided by
   alphabetical filename order (ISS-0170). So "duplicate id" is not a
   theoretical end state; it silently returns the wrong record.

FIX SHAPES, as offered, cheapest first:
  1. A per-clone or per-author discriminator in the allocated id. Smallest
     change, ids stay readable, nothing downstream breaks.
  2. Adopt the timestamp scheme already in the wild
     (2026-05-10T00-30-02Z-slug.md) — collision-free by construction, but ids
     get less quotable and there is migration cost. Note these records already
     coexist in the store and list_issues returns their FILENAME as the id,
     which is its own defect.
  3. Renumber at merge time via a hook. Most faithful to sequential ids, most
     machinery, and the only one that can reorder an id someone has already
     quoted in a commit message.

NOT DECIDED. Shape 1 is the obvious starting point but it changes the id format
that ADRs, commit trailers and the close hook all parse, so it wants a look at
the allocator's contract before anyone commits to it. Whatever is chosen should
also make a duplicate id LOUD on read — ISS-0170 is the evidence that a silent
wrong answer is the real cost, not the collision itself.
