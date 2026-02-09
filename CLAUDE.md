# Claude Code Context - READ FIRST

This file contains critical information for any Claude instance working on this codebase.

## Environment

- **OS**: macOS
- **Python**: Use `python3` (not `python`)

---

## Decibel Tools Taxonomy

**CRITICAL**: Decibel Tools is an MCP-based project intelligence system. When asked to create epics, issues, ADRs, proposals, or any tracked items—**always use the MCP tools**, never create manual folders or files.

### Module Responsibilities

| Module | Domain | What It Tracks | When to Use |
|--------|--------|----------------|-------------|
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

- ❌ Creating folders named after Decibel concepts (epic/, proposals/, adrs/)
- ❌ Writing markdown files instead of using tools
- ❌ Assuming "epic" means a folder structure
- ❌ Bypassing tools to "just create a quick file"

---

## Tool Implementation Architecture

**READ**: `docs/TOOLS_ARCHITECTURE.md` for full details.

### Core Principle: Self-Contained MCP Server

decibel-tools-mcp must be **self-contained**. All tools use **native file operations** (fs, YAML).

```
✅ CORRECT: Native file operations
   import fs from 'fs/promises';
   await fs.writeFile(wishPath, YAML.stringify(data));

❌ WRONG: Shelling out to external CLI
   spawn('decibel', ['dojo', 'wish', ...]);  // CLI doesn't exist!
```

### Reference Implementations

Follow the pattern in these files:
- `src/tools/friction.ts` - cleanest example
- `src/tools/sentinel.ts` - epics and issues
- `src/tools/architect.ts` - ADRs

### Known Issue: dojo.ts

`src/tools/dojo.ts` incorrectly shells out to a `decibel` CLI that doesn't exist. This needs conversion to native file operations. See `docs/TOOLS_ARCHITECTURE.md` for the conversion checklist.

### Key Helpers

```typescript
import { resolveProjectPaths } from '../projectRegistry.js';
import { ensureDir } from '../dataRoot.js';

const resolved = resolveProjectPaths(projectId);  // Get .decibel path
const wishDir = resolved.subPath('dojo/wishes');  // Build subpath
ensureDir(wishDir);                                // Create if needed
```

---

## MCP Server Infrastructure — Critical Path

The MCP server has a **dual transport architecture** and a layered tool loading system. Breaking any of these will silently disable tools for users. Read this before touching `server.ts`, `httpServer.ts`, `tools/index.ts`, or `projectRegistry.ts`.

### Dual Transport: stdio vs HTTP

| Mode | Entry | Transport | Used By |
|------|-------|-----------|---------|
| **stdio** (default) | `server.ts` | `StdioServerTransport` | Claude Code, Cursor, Claude Desktop |
| **HTTP** (`--http`) | `server.ts` → `httpServer.ts` | `StreamableHTTPServerTransport` + REST | ChatGPT, Mother, iOS app, external agents |

Both modes must expose the **exact same tool set**. If you add a tool and it only appears in one transport, it's a bug.

### Tool Loading: Sync vs Async

```
tools/index.ts exports:
  modularTools (sync)  → core tools only (always loaded)
  getAllTools() (async) → core + pro tools (voice, studio, corpus)
```

- `server.ts` calls `getAllTools()` at startup — correct, gets everything
- `httpServer.ts` calls `getAllTools()` at startup — correct, gets everything
- **Never import `modularTools` directly if you need the full set.** Use `getAllTools()`.

Pro tools are gated by `DECIBEL_PRO=1` in production, always enabled in dev.

### Project Discovery

`projectRegistry.ts` resolves project IDs through 7 strategies in order:

1. Exact ID match in `projects.json`
2. Alias match in `projects.json`
3. `DECIBEL_PROJECT_ROOT` env var (basename match)
4. Absolute path with `.decibel/`
5. Walk up from cwd (basename match)
6. `DECIBEL_PROJECT_ROOT` fallback (any ID treated as label)
7. cwd fallback (use discovered project even if ID doesn't match)

When all fail, the error message tells the user to run `project_init` or `registry_add`.

### Rules for MCP Infrastructure

1. **Both transports must stay in sync.** If you add a tool to `tools/index.ts`, it automatically appears in both stdio and HTTP. If you add a REST shorthand endpoint in `httpServer.ts`, the tool must also be in the modular registry.

2. **Never eagerly connect to external services at import time.** Tools that need databases (senken → Postgres), APIs (studio → Together/Kling), or Supabase must lazy-init. The server must boot even when env vars are missing.

3. **The `executeDojoTool` switch statement in httpServer.ts is legacy.** New tools should go through the modular `httpToolMap` fallback (the `default` case). Don't add new cases to that switch — register tools properly in `tools/index.ts` instead.

4. **Project resolution errors must be actionable.** Never throw a bare "project not found." Always include: what was tried, what projects exist, and what tool to run to fix it (`project_init` or `registry_add`).

5. **The plugin cache entry point is `dist/server.js`.** Not `dist/index.js`. If you rename or move the entry point, update `.claude/plugins/cache/decibel-tools-marketplace/decibel-tools/0.1.0/.mcp.json` and the project-level `.mcp.json`.

### What You MUST NOT Do

- ❌ Import `modularTools` (sync) when you need pro tools — use `getAllTools()`
- ❌ Add tool registration in `httpServer.ts` only — add to `tools/index.ts`
- ❌ Make project resolution throw without actionable hints
- ❌ Add eager connections that break boot when env vars are missing
- ❌ Add new cases to the `executeDojoTool` switch — use the modular tool map

---

## Senken Module — Handle With Care

**Senken** (`src/tools/senken.ts`) is the trade analysis module for the Mother trading system. Unlike every other module in this codebase, senken talks to **Postgres** (not local YAML files). This makes it high-risk for logic errors.

### Architecture Difference

| Other Modules | Senken |
|---------------|--------|
| Local `.decibel/` YAML files | Remote Postgres via `SENKEN_DATABASE_URL` |
| `resolveProjectPaths()` + `fs` | `pg.Pool` with lazy init |
| Idempotent file writes | SQL queries against live trade data |
| Safe to test locally | Requires a running database |

### The 5 Tools

| Tool | Type | Risk | What It Does |
|------|------|------|-------------|
| `senken_trade_summary` | READ | Low | Aggregates trades by strategy (count, win rate, avg R, PnL) |
| `senken_giveback_report` | READ | Low | MFE capture analysis — how much profit was left on the table |
| `senken_trade_review` | READ | Low | Individual trade grading (A–F) with counterfactual exits |
| `senken_list_overrides` | READ | Low | Shows active parameter overrides |
| `senken_apply_override` | WRITE | **HIGH** | Modifies live strategy parameters — rolls back previous, inserts new |

### Rules for Modifying Senken

1. **Never change SQL query logic without the user explicitly asking.** The queries join `mother_trades` ↔ `signal_outcomes` and use specific column names (`r_multiple`, `max_favorable_excursion`, `exit_reason`, etc.). Changing a column name or join condition silently breaks everything.

2. **Never add `ON DELETE CASCADE` or destructive SQL.** The `senken_apply_override` tool already does a careful rollback-then-insert pattern. Don't simplify this — the changelog matters.

3. **Preserve the grading logic exactly.** `senken_trade_review` grades trades A–F based on MFE capture percentage:
   - A: ≥80%, B: ≥60%, C: ≥40%, D: ≥20%, F: <20%
   - These thresholds are deliberate. Don't "improve" them.

4. **Preserve the giveback calculation.** Giveback = `MFE - realized R`. The percentage is `(MFE - realized) / MFE * 100`. Don't invert this or change the denominator.

5. **The `applied_by` field is always `'agent'`.** This is intentional — it marks that an AI made the override. Don't change this to a dynamic value.

6. **All SQL is parameterized.** Keep it that way. Never interpolate user input into query strings.

7. **The Pool is lazy-initialized.** If `SENKEN_DATABASE_URL` is not set, the tools error at call time, not at boot. This is correct — don't eagerly connect.

### What You CAN Do

- Add new READ-only query tools (following the existing pattern)
- Improve error messages
- Add input validation before queries execute
- Add new columns to SELECT clauses (if the schema has them)

### What You MUST NOT Do

- ❌ Change the grading thresholds or giveback formula
- ❌ Modify the override rollback-then-insert pattern
- ❌ Add DELETE or TRUNCATE statements
- ❌ Change parameterized queries to string interpolation
- ❌ Make the Pool connect eagerly at import time
- ❌ Add write operations without explicit user request

---

## Debugging Protocol

When investigating issues, bugs, or unexpected behavior:

### Required Structure

1. **Symptom Statement**: Describe the observed behavior precisely (not interpretations)

2. **Evidence Inventory**: List what we actually know with citations
   - File + function + line number for code claims
   - Exact log output for runtime claims
   - "Unverified" tag for anything inferred

3. **Hypothesis Set** (minimum 3):
   For each plausible explanation:
   - **H1/H2/H3**: [Description]
   - **Confirms if**: [Specific evidence that would prove this]
   - **Falsifies if**: [Specific evidence that would rule this out]

4. **Evidence Gaps**: What we don't know but need to
   - Exact instrumentation to add (log line, breakpoint, assertion)
   - Exact query/command to run

5. **Current Assessment**:
   > Most likely: [Hypothesis] (confidence: X%)
   > Because: [Specific evidence supporting this]
   > I could be wrong if: [What would change my mind]

### Anti-Patterns to Avoid
- ❌ "The problem is X" without citing evidence
- ❌ Jumping to solutions before completing hypothesis set
- ❌ Treating absence of evidence as evidence of absence
- ❌ Confidence > 80% without call chain or log confirmation

---

## Voice Inbox Protocol

Human sends voice notes via iOS → Supabase. **Messages don't go to local files directly.**

**At session start**, run:
```
voice_inbox_sync with project_id: "decibel-tools-mcp"
```

This pulls queued messages from Supabase → local `.decibel/voice/inbox/` so you can see and act on them.