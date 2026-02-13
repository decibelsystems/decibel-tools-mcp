# New Decibel Tools - January 2026

This document summarizes the new tools added to @decibel/tools in the `feature/code-health-auditor` branch.

---

## Git Domain

**Files:** `src/tools/git.ts` + `src/tools/git/index.ts`

Native git operations for project forensics and history tracking.

| Tool | Description |
|------|-------------|
| `git_log_recent` | Get recent commits with filters (author, date, path, grep) |
| `git_changed_files` | List files changed between commits/tags/branches |
| `git_find_removal` | Find when code was removed (pickaxe search via `git log -S`) |
| `git_blame_context` | Get blame info for file or line range |
| `git_tags` | List tags sorted by date |
| `git_status` | Current branch, ahead/behind remote, uncommitted changes |

### Example Usage

```
git_log_recent with count: 10, grep: "auth"
git_find_removal with search: "validateToken"
git_blame_context with file: "src/auth.ts", startLine: 50, endLine: 60
```

---

## Auditor Domain

**Files:** `src/tools/auditor.ts` + `src/tools/auditor/index.ts`

Code health assessment: smell detection, naming audits, health dashboards. These tools analyze actual source code, complementing Sentinel's work tracking.

| Tool | Description |
|------|-------------|
| `auditor_triage` | Quick code smell scan (god files, deep nesting, magic numbers, hardcoded values, buried legacy) |
| `auditor_health_dashboard` | Project-wide code health metrics (total files, god files count, smell counts, top offenders) |
| `auditor_refactor_score` | Rank files by refactoring urgency with recommendations (split, extract, simplify) |
| `auditor_naming_audit` | Check file naming against conventions (detects anti-patterns like "utils", "helpers") |
| `auditor_init` | Create `naming-conventions.yml` scaffold |

### Code Smell Types Detected

- `god_file` - Files over 400 lines
- `rule_sprawl` - Deep nesting (> 4 levels)
- `hidden_rules` - Magic numbers, hardcoded URLs
- `hardcoded_values` - Potential API keys/secrets
- `buried_legacy` - TODOs, FIXMEs, commented-out code

### Example Usage

```
auditor_triage with path: "src/services"
auditor_health_dashboard
auditor_refactor_score with limit: 5
```

---

## Workflow Domain

**Files:** `src/tools/workflow.ts` + `src/tools/workflow/index.ts`

High-level workflow tools that chain multiple Decibel tools. These are the primary interface for AI assistants.

| Tool | Description |
|------|-------------|
| `workflow_status` | Comprehensive project health check (git, issues, roadmap health, friction, code quality, recommendations) |
| `workflow_preflight` | Pre-commit quality checks with Auditor integration |
| `workflow_ship` | Pre-release readiness check (blockers, warnings, checklist, next steps) |
| `workflow_investigate` | Gather debugging context when something broke |

### workflow_status

Returns:
- Git state (branch, changes, ahead/behind)
- Issue counts (open, in-progress, blocked)
- Roadmap health scores
- Friction points sorted by signal
- Code quality metrics from Auditor
- Oracle's recommended next actions

### workflow_preflight

Checks performed:
1. Git Status - uncommitted changes warning
2. Data Validation - Sentinel scan for orphans/stale items
3. Code Quality - Auditor triage for god files and high-severity issues
4. Blocked Issues - unresolved blockers

With `strict: true`, warnings become failures (for CI/CD).

### workflow_ship

Returns:
- Ready/Not Ready status
- Blockers (must fix)
- Warnings (should address)
- Checklist with status
- Next steps

### workflow_investigate

Parameters:
- `context` - Optional hint about what broke (filters commits and friction)

Returns:
- Recent commits (filtered by context if provided)
- Recent issues
- Related friction points
- Recent learnings
- Suggested follow-up tools

---

## Slash Commands

**Location:** `.claude/commands/`

| Command | Tool | Description |
|---------|------|-------------|
| `/status` | `workflow_status` | Quick project health check |
| `/preflight` | `workflow_preflight` | Pre-commit quality checks |
| `/ship` | `workflow_ship` | Pre-release readiness |
| `/investigate` | `workflow_investigate` | Debug when something broke |

---

## Architecture

### Module Relationships

```
┌─────────────────────────────────────────────────────────────┐
│                      WORKFLOW LAYER                         │
│  workflow_status, workflow_preflight, workflow_ship,        │
│  workflow_investigate                                       │
└─────────────────────────────────────────────────────────────┘
          │              │              │              │
          ▼              ▼              ▼              ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│     GIT      │ │   AUDITOR    │ │   SENTINEL   │ │    ORACLE    │
│  git_status  │ │auditor_triage│ │ listIssues   │ │ nextActions  │
│  git_log_*   │ │auditor_health│ │ scanData     │ │roadmapHealth │
└──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘
                                          │              │
                                          ▼              ▼
                                  ┌──────────────┐ ┌──────────────┐
                                  │   FRICTION   │ │  LEARNINGS   │
                                  │ listFriction │ │listLearnings │
                                  └──────────────┘ └──────────────┘
```

### Key Design Decisions

1. **Auditor is code-focused** - Unlike Sentinel (work tracking) or Oracle (project health), Auditor analyzes actual source code
2. **Workflow tools chain existing tools** - They orchestrate multiple domain tools for common workflows
3. **Git tools are native** - Use `child_process.spawn` with git (no external dependencies)
4. **Preflight integrates Auditor** - Code quality checks are part of the pre-commit workflow

---

## Files Changed

```
src/tools/
├── git.ts                 # NEW - Git domain core functions
├── git/
│   └── index.ts           # NEW - Git MCP tool definitions
├── auditor.ts             # NEW - Auditor domain core functions
├── auditor/
│   └── index.ts           # NEW - Auditor MCP tool definitions
├── workflow.ts            # NEW - Workflow domain core functions
├── workflow/
│   └── index.ts           # NEW - Workflow MCP tool definitions
└── index.ts               # MODIFIED - Added git, auditor, workflow imports

.claude/commands/
├── status.md              # NEW - Slash command
├── preflight.md           # NEW - Slash command
├── ship.md                # NEW - Slash command
└── investigate.md         # NEW - Slash command
```

---

## Testing

To test the new tools:

```bash
# Build
npm run build

# Run MCP server
npx @decibel/tools

# Test individual tools via MCP client
workflow_status
auditor_triage
git_log_recent with count: 5
```
