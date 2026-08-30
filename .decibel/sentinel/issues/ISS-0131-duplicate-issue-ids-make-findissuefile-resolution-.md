---
uid: 01a01d6a-259a-725a-9583-e511d4bed8da
id: ISS-0131
projectId: decibel-tools-mcp
severity: high
status: closed
created_at: 2026-08-20T04:24:50.842Z
closed_at: 2026-08-25T20:06:15.417Z
---

# Duplicate issue ids make findIssueFile resolution readdir-order-dependent — update_issue/close_issue can silently write to the wrong issue

**Severity:** high
**Status:** closed

## Details

Reported by the senken-trading-agent peer (15 duplicate ids inside its .yml set); mechanism and blast radius confirmed here.

findIssueFile (src/tools/sentinel.ts) resolves an id to a file with:

  const prefixHit = files.find((f) => lower.startsWith(`${padded}-`) || stripRecordExt(lower) === padded);

`files.find` returns the FIRST match in fs.readdir order. When two files share an id, which one wins is directory-order-dependent and never surfaced to the caller. Every writer that goes through findIssueFile — update_issue, close_issue — therefore has an undefined target. It silently edits one issue and silently leaves the other untouched, returning success.

This is not theoretical. In senken, two genuinely DIFFERENT issues share each of these ids:

  ISS-0105 -> "Governor timeout on close_position causes SL/TP exits to fail"   (wins)
              "v3 bot engine never updated position, risks DB on close"          (unreachable)
  ISS-0114 -> "PCS phase 2 request queue ownership lease and remap"              (wins)
              "Position size 1,000 instead of configured 100"                    (unreachable)

ISS-0105 is the issue senken needed during a live P0. The needed one happens to win — by luck, not design.

MEASURED ACROSS PROJECTS (duplicate ids by format):

  project               dup_ids  cross_format  within_yml  within_md
  frontend_v0.2            34         14           20          0
  senken-trading-agent     16          1           15          0
  machina                   8          0            8          0
  decibel-tools-mcp         5          1            2          2
  deck                      0          0            0          0

Two corrections to claims in circulation:
- "Cross-format .md/.yml collisions are zero" is true for machina and nearly true for senken, but NOT general: frontend_v0.2 has 14. senken actually has 1 (ISS-0035: 'arch-debt-multiple-sources-of-truth-for-position-s.yml' + 'position-tracking-dual-table-desync.md').
- The dominant mode is duplicates WITHIN a single format (45 of 63 total), so this predates and is independent of the .md/.yml split. The id allocator was already colliding inside .yml.

Why the allocator mostly avoids cross-format collisions: getNextIssueNumber matches /^ISS-(\d+)/ on the FILENAME regardless of extension, so ISS-NNNN-*.yml files are counted. The extension gate only ever affected timestamp-named files carrying their id in frontmatter. That explains the low cross-format count without making the within-format problem any less real.

SUGGESTED FIX (not applied — needs a call on caller impact):
1. findIssueFile should detect multiple candidates and refuse to guess: return an AMBIGUOUS_ISSUE_ID error listing the candidate filenames, rather than silently picking readdir order. Writers must not target an undefined file.
2. Optionally add a read-only integrity check (list_issues already reports malformed/degraded; duplicate ids belong in the same report).
3. Renumbering the existing 63 duplicates is a data migration, separate from the code fix.

Related: ISS-0129 (close_issue bare-YAML corruption), ISS-0130 (dead src/store), ISS-0105 (converge issue stores).

## Resolution

Fixed in bbc50d7. All three silent-pick sites now refuse an ambiguous id instead of resolving it in fs.readdir order.

WHAT SHIPPED:
1. tools/sentinel.ts: findIssueFile became findIssueCandidates, matching in tiers of decreasing specificity (exact filename > filename+ext > ISS-NNNN prefix > frontmatter id > fuzzy) and returning only the first non-empty tier. Ambiguity is reported within a tier, never across, so an exact filename still outranks a prefix and remains a working escape hatch. close_issue returns AMBIGUOUS_ISSUE_ID listing every candidate filename, each of which is itself a valid unambiguous id.
2. sentinelIssues.ts updateIssue: the bare `basename.startsWith(id)` + `break` had no boundary check, so "ISS-011" matched ISS-0110/ISS-0112/ISS-0119 and wrote to whichever readdir yielded first. Now requires the id to end at a separator or record extension, and collects every hit rather than stopping at the first. This was a second, separate defect beyond duplicates and is why update_issue was affected as the issue predicted.
3. sentinelIssues.ts listIssuesForProject: deduped by id and DROPPED the loser, making one of two colliding issues unreachable to read_issue entirely. Both are now retained and EVERY member of a collision is marked duplicate_id (not just the one seen second — a caller holding the first file is in equal danger).

Also fixed en route: the close_issue tool handler matched only ISSUE_NOT_FOUND, so any other error shape — the new AMBIGUOUS_ISSUE_ID, and pre-existing project-resolution failures — was returned to the caller as a SUCCESSFUL close.

REPORTING (suggested fix item 2): list_issues now emits duplicate_ids and duplicate_id_files. Keyed on the RESOLVED id (filename prefix, else frontmatter id) rather than the filename, which matters: on this repo it finds 4 collisions where a filename-only grep finds 3. The extra one is ISS-0054, a timestamp-named file carrying the id in frontmatter colliding with an ISS-named file — exactly the cross-format case the issue flagged as under-counted.

NOT IN SCOPE, deliberately: renumbering the colliding data. Filed as ISS-0136 with the current census and a note that any migration must key on resolved id, not filename, or it will leave cross-format pairs behind.

ROOT-CAUSE CORRECTION worth recording: these collisions are NOT the allocator racing. Verified on the ISS-0112 pair with `git log --diff-filter=A` — the record carrying created_at 2026-06-25 was ADDED to the repo on 2026-08-02, well after ISS-0112 was legitimately allocated on 2026-07-11. getNextIssueNumber takes max+1 over the directory and is correct when the directory is complete; an import/replay path injects records with foreign ids and bypasses it. Hardening createIssue alone would not stop new collisions. This also means the open friction entry "sentinel create_issue allocates colliding ISS-NNNN ids" is misattributed — the allocator is not the culprit.

TESTING: 21 new tests across tests/unit/duplicateIssueIds.test.ts and duplicateIssueIdsStore.test.ts, including that a refusal leaves BOTH files byte-identical. Full suite 422/422. The new tests were mutation-checked by restoring the pick-first behaviour, which fails 4 of them — they are not vacuous.
