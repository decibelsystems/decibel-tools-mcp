# Claude Code Context - READ FIRST

This file contains critical information for any Claude instance working on this codebase.

## Environment

- **OS**: macOS
- **Python**: Use `python3` (not `python`)

---

## Quick Start: Use Workflow Tools

**Instead of remembering 80+ individual tools, start with these high-level workflows:**

| Intent | Tool | Slash Command |
|--------|------|---------------|
| "What's the state of this project?" | `workflow_status` | `/decibel-tools:status` |
| "Is this ready to commit?" | `workflow_preflight` | `/decibel-tools:preflight` |
| "Is this ready to release?" | `workflow_ship` | `/decibel-tools:ship` |
| "Something broke - what changed?" | `workflow_investigate` | `/decibel-tools:investigate` |
| "Run a health scan" | `sentinel_scan` | `/decibel-tools:scan` |
| "What should I work on next?" | `oracle_next_actions` | `/decibel-tools:next` |

### Git Forensics

| Intent | Tool |
|--------|------|
| "Show recent commits" | `git_log_recent` |
| "What files changed?" | `git_changed_files` |
| "When was this code removed?" | `git_find_removal` |
| "Who changed this line?" | `git_blame_context` |
| "List release tags" | `git_tags` |
| "Current git status" | `git_status` |

---

## Decibel Tools Taxonomy

**CRITICAL**: Decibel Tools is an MCP-based project intelligence system. When asked to create epics, issues, ADRs, proposals, or any tracked items—**always use the MCP tools**, never create manual folders or files.

### Module Responsibilities

| Module | Domain | What It Tracks | When to Use |
|--------|--------|----------------|-------------|
| **Workflow** | High-level intents | Composite operations | Start here for most tasks |
| **Git** | Version control | Commits, changes, history | Debugging, forensics |
| **Sentinel** | Work Tracking | Epics, Issues, Incidents | Tracking actual development work |
| **Architect** | Decisions | ADRs, architecture rationale | Recording *why* decisions were made |
| **Dojo** | Incubation | Wishes, Proposals, Experiments | Exploring new capabilities before committing |
| **Oracle** | Strategy | Roadmap, health scores, next actions | Understanding priorities and project health |
| **Designer** | Design | Design decisions, crits, tokens | UI/UX/visual design choices |
| **Friction** | Pain Points | Recurring problems, workarounds | Tracking persistent annoyances |

### Vocabulary → Tool Mapping

When you hear these words, use these tools:

| Term | Module | Tool | NOT This |
|------|--------|------|----------|
| "Status" / "health" | Workflow | `workflow_status` | ❌ multiple tool calls |
| "Ready to commit?" | Workflow | `workflow_preflight` | ❌ manual checks |
| "Ready to ship?" | Workflow | `workflow_ship` | ❌ multiple tool calls |
| "What broke?" | Workflow | `workflow_investigate` | ❌ manual git commands |
| "Epic" | Sentinel | `sentinel_log_epic` | ❌ mkdir epic |
| "Issue" | Sentinel | `sentinel_createIssue` | ❌ create issue.md |
| "ADR" / "decision" | Architect | `architect_createAdr` | ❌ docs/adr-001.md |
| "Proposal" | Dojo | `dojo_create_proposal` | ❌ proposals/ folder |
| "Wish" | Dojo | `dojo_add_wish` | ❌ wishlist.md |
| "Experiment" | Dojo | `dojo_scaffold_experiment` | ❌ experiments/ folder |
| "Design decision" | Designer | `designer_record_design_decision` | ❌ design-notes.md |
| "Friction" / "pain point" | Friction | `friction_log` | ❌ friction.md |

### Quick Decision Tree

```
User wants project status?
  └─▶ workflow_status (comprehensive health check)

User wants to commit/merge?
  └─▶ workflow_preflight (quality gates)

User wants to release?
  └─▶ workflow_ship (release readiness)

User is debugging?
  └─▶ workflow_investigate (gather context)
  └─▶ git_find_removal (when was code removed?)
  └─▶ git_blame_context (who changed this?)

User wants to track work?
  └─▶ Is it a large feature? → sentinel_log_epic
  └─▶ Is it a specific task/bug? → sentinel_createIssue

User wants to record a decision?
  └─▶ Architecture/technical? → architect_createAdr
  └─▶ Design/visual/UX? → designer_record_design_decision

User wants to explore something new?
  └─▶ Just an idea? → dojo_add_wish
  └─▶ Ready to propose? → dojo_create_proposal
  └─▶ Ready to test? → dojo_scaffold_experiment + dojo_run_experiment

User mentions recurring problem?
  └─▶ friction_log (or friction_bump if exists)

User asks "what should I work on?"
  └─▶ oracle_next_actions
```

### Anti-Patterns

- ❌ Using multiple individual tools when a workflow tool exists
- ❌ Creating folders named after Decibel concepts (epic/, proposals/, adrs/)
- ❌ Writing markdown files instead of using tools
- ❌ Running git commands manually when git tools exist
- ❌ Assuming "epic" means a folder structure
- ❌ Bypassing tools to "just create a quick file"

---

## Tool Implementation Architecture

**READ**: `docs/TOOLS_ARCHITECTURE.md` for full details.

### Core Principle: Self-Contained MCP Server

decibel-tools-mcp must be **self-contained**. All tools use native file operations, not external CLIs.

**Allowed**: 
- `git` commands (universally available)
- `python3` for specific tools (sentinel_scanData)

**Not allowed**:
- External `decibel` CLI
- Other project-specific CLIs

---

## File Locations

All data lives in project-local `.decibel/` folders:

```
{project_root}/
└── .decibel/
    ├── sentinel/
    │   ├── epics/       # EPIC-NNNN.yaml
    │   └── issues/      # ISS-NNNN.yaml
    ├── architect/
    │   ├── adrs/        # ADR-NNNN.yaml
    │   └── policies/    # POL-NNNN.yaml
    ├── dojo/
    │   ├── wishes/      # WISH-NNNN.yaml
    │   ├── proposals/   # DOJO-PROP-NNNN.yaml
    │   └── experiments/ # DOJO-EXP-NNNN/
    ├── friction/        # {timestamp}-{slug}.md
    ├── designer/        # Design decisions
    ├── learnings/       # Knowledge documents
    ├── context/         # Pinned facts, events
    └── provenance/      # Audit trail
```

---

## Common Workflows

### Starting a Work Session

```
1. workflow_status           → See overall health
2. oracle_next_actions       → What to focus on
3. sentinel_list_repo_issues → Review open items
```

### Before Committing

```
1. workflow_preflight        → Run all checks
2. Fix any failures/warnings
3. git commit
```

### Before Releasing

```
1. workflow_ship             → Full release check
2. Address all blockers
3. Review warnings
4. Follow next steps in output
```

### Debugging a Regression

```
1. workflow_investigate "what broke"  → Gather context
2. git_find_removal "functionName"    → When was it removed?
3. git_changed_files from=v1.0.0      → What changed since release?
4. git_blame_context file=src/auth.ts → Who touched this?
5. sentinel_createIssue               → Track the fix
```

### Recording a Decision

```
1. architect_createAdr        → Document the decision
2. sentinel_log_epic          → If it spawns work
3. learnings_append           → If there's a lesson learned
```
