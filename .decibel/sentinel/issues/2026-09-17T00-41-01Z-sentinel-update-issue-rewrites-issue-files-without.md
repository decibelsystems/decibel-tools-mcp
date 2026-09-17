---
projectId: decibel-tools-mcp
severity: high
status: open
created_at: 2026-09-17T00:41:01.525Z
---

# sentinel update_issue rewrites issue files without frontmatter delimiters — updated issues vanish from list_issues

**Severity:** high
**Status:** open

## Details

Found in project airlock on 2026-08-01, written up in decibel-bug-report.md at repo root (untracked). update_issue rewrites the .md issue file into a shape parseIssueFile cannot read: the --- frontmatter delimiters are lost, so every later list_issues call silently skips the file. No error, no malformed flag. In airlock, list_issues reported 2 issues when the directory held 7; the 5 missing were exactly the 5 that had ever been updated. Impact: the tracker fails in the dangerous direction (looks nearly done). Anything on list_issues inherits it: oracle next_actions, preflight, ship, epic-close gates. Fix: update_issue must serialize through the same frontmatter writer create_issue uses, and list_issues should surface unparseable files as a count rather than dropping them. Related: ISS-0105 (converge issue stores on .md), 2026-04-30 review item "two coexisting issue file formats".
