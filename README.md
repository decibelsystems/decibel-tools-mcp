# decibel-tools-mcp

MCP server that gives AI assistants structured access to project intelligence: epics, issues, ADRs, experiments, roadmaps, and more.

**108 tools** across 14 domains. Tested with Claude Desktop, Claude Code, and Cursor. [Learn more →](https://decibel.systems/tools)

<a href="cursor://anysphere.cursor-deeplink/mcp/install?name=decibel-tools&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsImRlY2liZWwtdG9vbHMtbWNwIl19">
  <img src="https://cursor.com/deeplink/mcp-install-dark.svg" alt="Add to Cursor" height="32" />
</a>

## What It Does

| Domain | Purpose | Example Tools |
|--------|---------|---------------|
| **Sentinel** | Work tracking | `sentinel_create_issue`, `sentinel_log_epic`, `sentinel_list_epics` |
| **Dojo** | AI incubator | `dojo_add_wish`, `dojo_create_proposal`, `dojo_run_experiment` |
| **Architect** | Decisions | `architect_createAdr`, `architect_createPolicy` |
| **Roadmap** | Strategy | `roadmap_get`, `roadmap_getHealth`, `roadmap_linkEpic` |
| **Oracle** | Recommendations | `oracle_next_actions`, `oracle_roadmap` |
| **Designer** | Design decisions | `designer_record_design_decision`, `designer_crit` |
| **Friction** | Pain points | `friction_log`, `friction_bump`, `friction_resolve` |
| **Learnings** | Knowledge base | `learnings_append`, `learnings_list` |
| **Context** | AI memory | `decibel_context_pin`, `decibel_context_refresh` |
| **Registry** | Project management | `project_init`, `registry_list`, `registry_add` |
| **Agentic** | Config compilation | `agentic_compile_pack`, `agentic_render` |
| **Provenance** | Audit trail | `provenance_list` |

## Quick Start

```bash
# Install globally
npm install -g decibel-tools-mcp

# Or run directly with npx
npx decibel-tools-mcp
```

## Platform Setup

### Cursor

**One-click:** Click the button at the top of this README.

**Manual:** Add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "decibel-tools": {
      "command": "npx",
      "args": ["-y", "decibel-tools-mcp"]
    }
  }
}
```

### Claude Code

**Plugin (recommended):**

```bash
# Add the marketplace
/plugin marketplace add decibelsystems/decibel-tools-mcp

# Install the plugin
/plugin install decibel-tools@decibel-marketplace
```

This gives you slash commands like `/decibel-tools:init`, `/decibel-tools:scan`, `/decibel-tools:next`.

**Manual:** Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "decibel-tools": {
      "command": "npx",
      "args": ["-y", "decibel-tools-mcp"]
    }
  }
}
```

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "decibel-tools": {
      "command": "npx",
      "args": ["-y", "decibel-tools-mcp"]
    }
  }
}
```

---

## Tools Reference

### Sentinel (16 tools)
*Work tracking: issues, epics, test specs*

| Tool | Description |
|------|-------------|
| `sentinel_create_issue` | Create a tracked issue with severity (low/med/high/critical) |
| `sentinel_close_issue` | Close an issue with resolution note |
| `sentinel_list_repo_issues` | List issues for a project, optionally filtered by status |
| `sentinel_listIssues` | List issues with filtering by epic or status |
| `sentinel_createIssue` | Create issue (YAML format with auto-generated ID) |
| `sentinel_log_epic` | Create a new epic (large feature) record |
| `sentinel_list_epics` | List all epics with optional filters |
| `sentinel_get_epic` | Get details of a specific epic |
| `sentinel_get_epic_issues` | Get all issues linked to an epic |
| `sentinel_resolve_epic` | Fuzzy search for epics by name or keyword |
| `sentinel_scan` | Scan project data for validation, orphans, stale items |
| `sentinel_scanData` | Scan using Python Sentinel Data Inspector |
| `sentinel_createTestSpec` | Create a test specification atom |
| `sentinel_listTestSpecs` | List all test specifications |
| `sentinel_compileTests` | Compile test specs into documentation |
| `sentinel_auditPolicies` | Audit policy compliance and freshness |

### Dojo (10 tools)
*AI Feature Incubator: wishes, proposals, experiments*

| Tool | Description |
|------|-------------|
| `dojo_add_wish` | Add a capability wish (what, why, inputs, outputs) |
| `dojo_list_wishes` | List wishes from the wishlist |
| `dojo_create_proposal` | Create a proposal for a feature or capability |
| `dojo_scaffold_experiment` | Create experiment skeleton from a proposal |
| `dojo_list` | List proposals, experiments, and wishes |
| `dojo_run_experiment` | Run an experiment in sandbox mode |
| `dojo_get_results` | Get results from a previous experiment run |
| `dojo_read_artifact` | Read artifact file from experiment results |
| `dojo_can_graduate` | Check if experiment can graduate to real tool |
| `dojo_projects` | List available projects for Dojo operations |

### Architect (6 tools)
*Architecture decisions and policies*

| Tool | Description |
|------|-------------|
| `architect_record_arch_decision` | Record an ADR (markdown format) |
| `architect_createAdr` | Create ADR (YAML format with auto ID) |
| `architect_createPolicy` | Create a policy with rules and enforcement |
| `architect_listPolicies` | List all policies, filter by severity/tags |
| `architect_getPolicy` | Get details of a specific policy |
| `architect_compileOversight` | Compile policies into documentation |

### Roadmap (6 tools)
*Strategic planning and health tracking*

| Tool | Description |
|------|-------------|
| `roadmap_get` | Get full roadmap (objectives, themes, milestones) |
| `roadmap_list` | List epics with roadmap context and health scores |
| `roadmap_getEpicContext` | Get strategic context for a specific epic |
| `roadmap_getHealth` | Get epics with low health scores needing attention |
| `roadmap_linkEpic` | Link epic to theme, milestone, objectives |
| `roadmap_init` | Initialize a new roadmap.yaml scaffold |

### Oracle (2 tools)
*AI-powered recommendations*

| Tool | Description |
|------|-------------|
| `oracle_next_actions` | Get recommended next actions for a project |
| `oracle_roadmap` | Evaluate roadmap progress against milestones |

### Designer (7 tools)
*Design decisions, Figma integration, and creative feedback*

| Tool | Description |
|------|-------------|
| `designer_record_design_decision` | Record a design decision |
| `designer_crit` | Log early creative feedback (gut reactions, hunches) |
| `designer_list_crits` | List crit observations, filter by area/sentiment |
| `designer_sync_tokens` | Sync design tokens from Figma variables |
| `designer_review_figma` | Review Figma component against design principles |
| `designer_upsert_principle` | Create or update a design principle |
| `designer_list_principles` | List design principles, filter by category |

### Friction (4 tools)
*Track recurring pain points*

| Tool | Description |
|------|-------------|
| `friction_log` | Log a friction point (context, description, impact) |
| `friction_list` | List friction points sorted by impact/signal |
| `friction_resolve` | Mark friction as resolved with solution reference |
| `friction_bump` | Bump signal count when encountering same friction |

### Learnings (2 tools)
*Living knowledge documents*

| Tool | Description |
|------|-------------|
| `learnings_append` | Append entry to project's learnings document |
| `learnings_list` | List entries, filter by category |

### Context (8 tools)
*AI memory: pinned facts, events, artifacts*

| Tool | Description |
|------|-------------|
| `decibel_context_refresh` | Compile full context pack for AI memory |
| `decibel_context_pin` | Pin a fact to persistent memory |
| `decibel_context_unpin` | Remove a pinned fact |
| `decibel_context_list` | List all pinned facts |
| `decibel_event_append` | Append event to activity journal |
| `decibel_event_search` | Search events in journal |
| `decibel_artifact_list` | List artifacts for a run |
| `decibel_artifact_read` | Read artifact content |

### Registry (7 tools)
*Project discovery and management*

| Tool | Description |
|------|-------------|
| `project_init` | Initialize .decibel/ folder in a project |
| `project_status` | Check project status and available tools |
| `registry_list` | List all registered projects |
| `registry_add` | Register a project in the registry |
| `registry_remove` | Remove project from registry |
| `registry_alias` | Add alias to a project |
| `registry_resolve` | Test resolution of project ID/alias |

### Agentic (4 tools)
*Configuration compilation and rendering*

| Tool | Description |
|------|-------------|
| `agentic_compile_pack` | Compile config into versioned, hashed pack |
| `agentic_render` | Transform payload into rendered text |
| `agentic_lint` | Validate output against renderer constraints |
| `agentic_golden_eval` | Run golden eval regression tests |

### Provenance (1 tool)
*Audit trail*

| Tool | Description |
|------|-------------|
| `provenance_list` | List provenance events for artifact/actor |

---

## Data Storage

Data is stored in project-local `.decibel/` folders:

```
{project}/
└── .decibel/
    ├── sentinel/
    │   ├── issues/      # ISS-{nnnn}.yml
    │   └── epics/       # EPIC-{nnnn}.yml
    ├── architect/
    │   ├── adrs/        # ADR-{nnnn}.yml
    │   └── policies/    # POL-{nnnn}.yaml
    ├── dojo/
    │   ├── proposals/   # DOJO-PROP-{nnnn}.yml
    │   ├── experiments/ # DOJO-EXP-{nnnn}/
    │   └── wishes/      # WISH-{nnnn}.yml
    ├── designer/        # Design decisions
    ├── friction/        # Pain point logs
    ├── learnings/       # Knowledge documents
    ├── context/         # Pinned facts, events
    └── voice/inbox/     # Voice messages
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `DECIBEL_ENV` | `dev` | Environment (dev, staging, prod) |
| `DECIBEL_ORG` | `mediareason` | Organization name |
| `DECIBEL_MCP_ROOT` | `~/.decibel` | Global data storage root |

Optional for cloud features:
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_SERVICE_KEY` - Supabase service role key
- `OPENAI_API_KEY` - For image generation
- `FIGMA_ACCESS_TOKEN` - For Figma integration (designer_sync_tokens, designer_review_figma)

## Usage Examples

### Example 1: Initialize a Project and Create an Epic

```
User: "Initialize decibel for this project and create an epic for user authentication"

AI uses: project_init → sentinel_log_epic

Result: Creates .decibel/ folder structure and EPIC-0001.yml for "User Authentication"
```

### Example 2: Track Work with Issues Linked to Epics

```
User: "Create issues for the auth epic: login form, password reset, and session management"

AI uses: sentinel_resolve_epic → sentinel_createIssue (×3)

Result: Creates ISS-0001, ISS-0002, ISS-0003 all linked to EPIC-0001
```

### Example 3: Record Architecture Decisions

```
User: "We decided to use JWT tokens instead of sessions. Document this ADR."

AI uses: architect_createAdr

Result: Creates ADR-0001.yml with context, decision, and consequences
```

### Example 4: AI Feature Incubation (Dojo)

```
User: "I wish we had a tool that detects rate limit patterns in logs"

AI uses: dojo_add_wish → dojo_create_proposal → dojo_scaffold_experiment

Result: WISH-0001.yml → DOJO-PROP-0001.yml → DOJO-EXP-0001/ with entrypoint ready to implement
```

### Example 5: Get Recommended Next Actions

```
User: "What should I work on next?"

AI uses: oracle_next_actions

Result: Prioritized list based on stale issues, epic health, pending experiments
```

## Privacy Policy

**Local Storage Only**: All project data is stored locally in `.decibel/` folders within your project directories. No data is sent to external servers by default.

**Optional Cloud Integrations**: Some tools optionally connect to external services when you explicitly configure API keys:
- **Figma API** (`designer_sync_tokens`, `designer_review_figma`) - requires `FIGMA_ACCESS_TOKEN`
- **Supabase** (voice inbox sync) - requires `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`

These optional integrations are clearly marked with `openWorldHint: true` in their tool annotations.

**No Telemetry**: This MCP server does not collect telemetry, usage analytics, or any form of tracking data.

## License

MIT - [Decibel Systems](https://decibel.systems)
