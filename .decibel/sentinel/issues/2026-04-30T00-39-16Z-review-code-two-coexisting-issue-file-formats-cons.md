---
uid: 019ddbd3-627a-7441-a6bd-8fccf47732a2
id: 2026-04-30T00-39-16Z-review-code-two-coexisting-issue-file-formats-cons
projectId: decibel-tools-mcp
severity: med
status: open
created_at: 2026-04-30T00:39:16.858Z
---

# [review/code] Two coexisting issue file formats — consolidate to one

**Severity:** med
**Status:** open

## Details

createIssue writes markdown-frontmatter format (--- ... ---). updateIssue writes pure YAML (after stringifyYaml). Every reader has to handle both. The class of bugs we just fixed (parseIssueFile rejecting YAML-only files) was caused by this duplication.

Long-term fix: pick one format and migrate. updateIssue's pure-YAML output is more uniform with the rest of .decibel/ (epics, ADRs, learnings all use pure YAML). Migrating createIssue to write the same format would let parseIssueFile drop its dual-format support entirely.

Migration plan:
1. Update createIssue to write pure YAML (no --- delimiters)
2. Add a one-time on-disk migration: walk all .decibel/sentinel/issues/*.md, strip the --- markers, rewrite as pure YAML
3. Update parseIssueFile to require single-doc YAML (drop the multi-doc fallback)
4. Update tests + downstream readers

Filed during fix/sentinel-epic-issue-relationship. The ad-hoc parser is gone (replaced by safeParseYaml) but the dual-format support remains — closing this issue requires a coordinated migration, not just code change.
