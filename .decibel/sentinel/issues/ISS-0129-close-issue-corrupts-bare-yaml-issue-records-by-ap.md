---
id: ISS-0129
projectId: decibel-tools-mcp
severity: high
status: closed
created_at: 2026-08-20T01:09:54.571Z
priority: high
updated_at: 2026-08-20T04:29:52.138Z
---

# close_issue corrupts bare-YAML issue records by appending a markdown Resolution section

**Severity:** high
**Status:** closed

## Details

Root cause of the ~85 degraded issue records found while fixing the list_issues .yml blindness.

close_issue appends a markdown block to the record file:

  ## Resolution

Fixed in 4ecad91, shipped in 2.2.0-beta.0 (npm tag `beta`). close_issue now writes resolutions as YAML on bare-YAML (.yml/.yaml) records and keeps markdown sections only for fenced .md records. salvageBareYaml() recovers records already corrupted by an appended `## Resolution` section and flags them `degraded` rather than dropping them from list_issues. Block-scalar descriptions containing markdown are not salvage-truncated. 66/66 sentinel unit tests pass.
