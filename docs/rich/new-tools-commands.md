# New Decibel Tools - Command Reference

Quick reference for all new tools added in the `feature/code-health-auditor` branch.

---

## Git Tools

### git_log_recent
Get recent git commits with optional filters.

```
git_log_recent
git_log_recent with count: 10
git_log_recent with since: "2 weeks ago"
git_log_recent with author: "hiro"
git_log_recent with grep: "fix"
git_log_recent with path: "src/auth"
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `projectId` | string | Project identifier (optional) |
| `count` | number | Number of commits (default: 20) |
| `since` | string | After date (e.g., "2 weeks ago", "2025-01-01") |
| `until` | string | Before date |
| `author` | string | Filter by author name/email |
| `path` | string | Filter to commits affecting path |
| `grep` | string | Search commit messages |

---

### git_changed_files
List files changed between two commits, tags, or branches.

```
git_changed_files
git_changed_files with from: "v1.0.0", to: "v1.1.0"
git_changed_files with from: "main", to: "HEAD"
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `projectId` | string | Project identifier (optional) |
| `from` | string | Starting point (default: HEAD~1) |
| `to` | string | Ending point (default: HEAD) |

---

### git_find_removal
Find when code was removed (pickaxe search).

```
git_find_removal with search: "validateToken"
git_find_removal with search: "oldFunction", path: "src/"
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `projectId` | string | Project identifier (optional) |
| `search` | string | **Required.** String to search for |
| `path` | string | Limit to specific path pattern |

---

### git_blame_context
Get blame info for a file or line range.

```
git_blame_context with file: "src/auth.ts"
git_blame_context with file: "src/auth.ts", line: 42
git_blame_context with file: "src/auth.ts", startLine: 50, endLine: 60
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `projectId` | string | Project identifier (optional) |
| `file` | string | **Required.** Path to file |
| `line` | number | Specific line number |
| `startLine` | number | Start of line range |
| `endLine` | number | End of line range |

---

### git_tags
List tags sorted by date.

```
git_tags
git_tags with count: 5
git_tags with pattern: "v*"
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `projectId` | string | Project identifier (optional) |
| `count` | number | Number of tags (default: 10) |
| `pattern` | string | Filter pattern (e.g., "v*") |

---

### git_status
Get current git status.

```
git_status
git_status with projectId: "steakholders"
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `projectId` | string | Project identifier (optional) |

**Returns:** branch, ahead/behind counts, staged/modified/untracked counts

---

## Auditor Tools

### auditor_triage
Quick code smell scan.

```
auditor_triage
auditor_triage with path: "src/services"
auditor_triage with checks: ["god_file", "hidden_rules"]
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `projectId` | string | Project identifier (optional) |
| `path` | string | File or directory to scan (default: src/) |
| `checks` | array | Smell types to check (see below) |

**Smell types:** `god_file`, `rule_sprawl`, `dip_violation`, `duplicate_code`, `hidden_rules`, `buried_legacy`, `naming_drift`, `missing_tests`, `hidden_side_effects`, `hardcoded_values`

---

### auditor_health_dashboard
Project-wide code health metrics.

```
auditor_health_dashboard
auditor_health_dashboard with projectId: "elliott"
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `projectId` | string | Project identifier (optional) |

**Returns:** totalFiles, totalLines, godFiles, avgFileSize, maxFileSize, smellCounts, topOffenders

---

### auditor_refactor_score
Rank files by refactoring urgency.

```
auditor_refactor_score
auditor_refactor_score with limit: 5
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `projectId` | string | Project identifier (optional) |
| `limit` | number | Max candidates to return (default: 10) |

**Returns:** candidates with score, factors, and recommendation (split/extract/simplify/delete)

---

### auditor_naming_audit
Check file naming against conventions.

```
auditor_naming_audit
auditor_naming_audit with conventions: "naming-conventions.yml"
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `projectId` | string | Project identifier (optional) |
| `conventions` | string | Path to conventions file |

---

### auditor_init
Create naming conventions scaffold.

```
auditor_init
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `projectId` | string | Project identifier (optional) |

**Creates:** `naming-conventions.yml` in project root

---

## Workflow Tools

### workflow_status
Comprehensive project health check.

```
workflow_status
workflow_status with projectId: "steakholders"
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `projectId` | string | Project identifier (optional) |

**Returns:** git state, issues, health scores, friction, code quality, recommendations

---

### workflow_preflight
Pre-commit quality checks.

```
workflow_preflight
workflow_preflight with strict: true
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `projectId` | string | Project identifier (optional) |
| `strict` | boolean | Warnings become failures (default: false) |

**Checks:** Git status, data validation, code quality (auditor), blocked issues

---

### workflow_ship
Pre-release readiness check.

```
workflow_ship
workflow_ship with projectId: "apocalyptic"
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `projectId` | string | Project identifier (optional) |
| `dryRun` | boolean | Report only, no side effects |

**Returns:** ready/not-ready, blockers, warnings, checklist, next steps

---

### workflow_investigate
Gather debugging context.

```
workflow_investigate
workflow_investigate with context: "auth"
workflow_investigate with context: "payment failed"
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `projectId` | string | Project identifier (optional) |
| `context` | string | Hint about what broke (filters results) |

**Returns:** recent commits, issues, friction, learnings, suggestions

---

## Slash Commands

These are available in Claude Code via `/command`:

| Command | Tool | Use When |
|---------|------|----------|
| `/status` | workflow_status | Start of day, quick health check |
| `/preflight` | workflow_preflight | Before committing |
| `/ship` | workflow_ship | Before releasing |
| `/investigate` | workflow_investigate | Something broke |

---

## Quick Examples

```
# Morning check-in
workflow_status

# Before committing
workflow_preflight

# Find what changed recently
git_log_recent with count: 5

# Debug a regression
workflow_investigate with context: "login broken"
git_find_removal with search: "authenticateUser"

# Code health review
auditor_health_dashboard
auditor_refactor_score with limit: 3

# Pre-release
workflow_ship
```
