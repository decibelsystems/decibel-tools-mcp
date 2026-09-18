---
id: 2026-09-17T00-41-01Z-sentinel-update-issue-rewrites-issue-files-without
projectId: decibel-tools-mcp
severity: high
status: closed
created_at: 2026-09-17T00:41:01.525Z
updated_at: 2026-09-18T03:53:54.920Z
closed_at: 2026-09-18T03:53:54.838Z
resolution: "Fixed upstream by the Phase 5 single issue writer (c7d59b7, #62) and the bare-YAML record migration (f5af443, #64), now on this branch via the 3.0.0 merge (cd3e463). Verified on the merged build: create → update_issue(status, note) → list_issues still shows the issue with proper --- frontmatter → close_issue → list closed. Round-trip passes."
---

# sentinel update_issue rewrites issue files without frontmatter delimiters — updated issues vanish from list_issues

**Severity:** high
**Status:** closed

## Details

Found in project airlock on 2026-08-01, written up in decibel-bug-report.md at repo root (untracked). update_issue rewrites the .md issue file into a shape parseIssueFile cannot read: the --- frontmatter delimiters are lost, so every later list_issues call silently skips the file. No error, no malformed flag. In airlock, list_issues reported 2 issues when the directory held 7; the 5 missing were exactly the 5 that had ever been updated. Impact: the tracker fails in the dangerous direction (looks nearly done). Anything on list_issues inherits it: oracle next_actions, preflight, ship, epic-close gates. Fix: update_issue must serialize through the same frontmatter writer create_issue uses, and list_issues should surface unparseable files as a count rather than dropping them. Related: ISS-0105 (converge issue stores on .md), 2026-04-30 review item "two coexisting issue file formats".

## Resolution

Fixed upstream by the Phase 5 single issue writer (c7d59b7, #62) and the bare-YAML record migration (f5af443, #64), now on this branch via the 3.0.0 merge (cd3e463). Verified on the merged build: create → update_issue(status, note) → list_issues still shows the issue with proper --- frontmatter → close_issue → list closed. Round-trip passes.
