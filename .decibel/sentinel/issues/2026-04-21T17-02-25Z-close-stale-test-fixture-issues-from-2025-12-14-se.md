---
uid: 019db0fe-3e65-727b-8ab7-7964cd3f70ea
id: ISS-0104
projectId: decibel-tools-mcp
severity: low
status: closed
created_at: 2026-04-21T17:02:25.381Z
updated_at: 2026-04-26T20:55:48.964Z
closed_at: 2026-04-30T22:32:52.985Z
---

# Close stale test fixture issues from 2025-12-14

Meta-tracker for cleaning up the 22 sentinel test fixtures filed on 2025-12-14 (ISS-0054..ISS-0075 inclusive) that have been polluting `list_issues` for months.

## Resolution

Completed: all 22 stale 2025-12-14 test fixtures closed (ISS-0054..ISS-0075 inclusive). This was the meta-tracker for that cleanup; closing now that the work is done.

## Notes

This issue's original on-disk format had a malformed frontmatter — only `id:` was inside the `---...---` block; `projectId`, `severity`, `status`, `created_at`, `updated_at` lived as Markdown body. `sentinel.close_issue` happily wrote new fields (`closed_at`, `status: closed`) into the malformed top block during the bulk cleanup, reinforcing the broken structure. Reformatted to standard frontmatter on 2026-04-30 as part of the same cleanup PR (#16). The format-divergence issue itself remains tracked as `2026-04-30T00-39-16Z-review-code-two-coexisting-issue-file-formats-cons`.
