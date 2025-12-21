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