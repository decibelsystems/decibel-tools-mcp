---
id: ISS-0131
projectId: decibel-tools-mcp
severity: high
status: open
created_at: 2026-08-20T04:24:50.842Z
---

# Duplicate issue ids make findIssueFile resolution readdir-order-dependent — update_issue/close_issue can silently write to the wrong issue

**Severity:** high
**Status:** open

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
