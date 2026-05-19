---
projectId: decibel-tools-mcp
severity: low
status: open
created_at: 2026-04-30T00:39:27.770Z
---

# [review/security] Frontmatter keys stored in plain Record — prototype-pollution surface

**Severity:** low
**Status:** open

## Details

parseIssueFile and listIssuesForProject store parsed frontmatter into `Record<string, unknown>`. If a user-authored issue file has a frontmatter key like `__proto__` or `constructor`, it could pollute the prototype chain in some JavaScript engines.

Modern V8 (Node 18+) handles this safely for property lookup, but as a defense-in-depth pattern, prefer Map<string, unknown> over plain Record for arbitrary user input.

Lift: minimal — change one container type, update consumers. Doesn't change wire format or behavior.

Filed during fix/sentinel-epic-issue-relationship review.
