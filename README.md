# @decibelsystems/tools

MCP server for project intelligence. 27 facade tools (170+ internal handlers) across work tracking, architecture, experiments, design, git forensics, agent coordination, and more.

Tested with Claude Desktop, Claude Code, and Cursor. [Learn more](https://decibel.systems/tools)

<a href="https://github.com/decibelsystems/decibel-tools-mcp#cursor">
  <img src="https://cursor.com/deeplink/mcp-install-dark.svg" alt="Add to Cursor" height="32" />
</a>

> **Note:** The one-click Cursor install only works on GitHub. [Click here](https://github.com/decibelsystems/decibel-tools-mcp#cursor) or see manual setup below.

## Quick Start

```bash
# Install globally
npm install -g @decibelsystems/tools

# Or run directly with npx
npx @decibelsystems/tools
```

### Project Setup

After installing, initialize your first project:

```bash
# Copy the example registry (one-time setup)
cp projects.example.json projects.json
# Edit projects.json with your project paths
```

Or use the MCP tools directly — call `project_init` with your project path and it will create the `.decibel/` folder and register the project automatically.

## Platform Setup

### Claude Code

Add to `.mcp.json` in your project root or `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "decibel-tools": {
      "command": "npx",
      "args": ["-y", "@decibelsystems/tools"]
    }
  }
}
```

### Cursor

Add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "decibel-tools": {
      "command": "npx",
      "args": ["-y", "@decibelsystems/tools"]
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
      "args": ["-y", "@decibelsystems/tools"]
    }
  }
}
```

---

## Facade Tools

All tools are accessed through **facade commands** — one tool per domain, with an `action` parameter to select the operation. For example: `sentinel` with action `create_issue`.

### Core (always available)

| Facade | Domain | Key Actions |
|--------|--------|-------------|
| **sentinel** | Work tracking | `create_issue`, `close_issue`, `log_epic`, `list_epics`, `scan` |
| **architect** | Decisions | `create_adr`, `create_policy`, `list_policies`, `compile_oversight` |
| **dojo** | Incubation | `add_wish`, `create_proposal`, `scaffold_experiment`, `run_experiment` |
| **designer** | Design | `record_design_decision`, `crit`, `sync_tokens`, `review_figma` |
| **oracle** | Recommendations | `next_actions`, `roadmap` |
| **roadmap** | Strategy | `get`, `list`, `get_health`, `link_epic`, `init` |
| **git** | Git forensics | `history`, `changes`, `link_issue` |
| **workflow** | Composites | `status`, `preflight`, `ship`, `investigate` |
| **vector** | Agent runs | `track`, `drift`, `score` |
| **context** | AI memory | `pin`, `unpin`, `list`, `refresh`, `event_append`, `event_search` |
| **auditor** | Code quality | `health`, `refactor_score` |
| **forecast** | Estimation | `estimate`, `decompose`, `capacity` |
| **velocity** | Metrics | `trends`, `contributors` |
| **coordinator** | Multi-agent | `lock`, `unlock`, `heartbeat`, `log`, `message` |
| **swarm** | Agent sessions | `start_session`, `join_session`, `emit_signal`, `claim_signal` |
| **friction** | Pain points | `log`, `list`, `resolve`, `bump` |
| **registry** | Projects | `add`, `remove`, `list`, `alias`, `init`, `status` |
| **feedback** | Tool feedback | `submit`, `list` |
| **learnings** | Knowledge | `append`, `list` |
| **provenance** | Audit trail | `list` |
| **bench** | Benchmarks | `run`, `compare` |
| **guardian** | Security | `scan_deps`, `scan_secrets`, `scan_http`, `scan_config`, `report` |

### Pro (requires license key)

| Facade | Domain | Key Actions |
|--------|--------|-------------|
| **voice** | Voice inbox | `sync`, `list`, `process` |
| **studio** | Creative assets | `generate_image`, `generate_video` |
| **corpus** | Code patterns | `search`, `index` |
| **agentic** | Config compilation | `compile_pack`, `render`, `lint`, `golden_eval` |

> Add your license key to `~/.decibel/config.yaml` under `license.key` to enable pro features.

---

## Daemon Mode

Run as a persistent background service with HTTP transport:

```bash
# Start daemon (default port 4888)
npx @decibelsystems/tools --daemon

# Dual mode: stdio + HTTP from one process
npx @decibelsystems/tools --daemon --stdio

# macOS launchd management
npx @decibelsystems/tools --daemon install
npx @decibelsystems/tools --daemon uninstall
npx @decibelsystems/tools --daemon status
```

The daemon includes log rotation, crash loop protection (5 crashes in 60s), graceful shutdown with request draining, and a `/health` endpoint.

### Configuration

Create `~/.decibel/config.yaml` to configure the daemon:

```yaml
daemon:
  port: 4888
  host: localhost
  auth_token: your-secret-token
  log_max_size_mb: 10
  log_max_files: 3
  rate_limit_rpm: 60
license:
  key: your-license-key
```

CLI flags override config file values. Send `SIGHUP` to reload config without restarting.

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
    ├── designer/        # Design decisions, principles, crits
    ├── friction/        # Pain point logs
    ├── learnings/       # Knowledge documents
    ├── context/         # Pinned facts, events
    ├── guardian/        # Security scan results, allowlists
    └── voice/inbox/     # Voice messages
```

## Environment Variables

### Core

| Variable | Default | Description |
|----------|---------|-------------|
| `DECIBEL_ENV` | `dev` | Environment (dev, staging, prod) |
| `DECIBEL_ORG` | `default` | Organization name |
| `DECIBEL_MCP_ROOT` | `~/.decibel` | Global data storage root |
| `DECIBEL_PROJECT_ROOT` | — | Current project root path |
| `DECIBEL_REGISTRY_PATH` | — | Custom registry file location |

### Optional Integrations

| Variable | Used By |
|----------|---------|
| `SUPABASE_URL` | Voice inbox, swarm sessions |
| `SUPABASE_SERVICE_KEY` | Supabase service role key |
| `FIGMA_ACCESS_TOKEN` | Designer: `sync_tokens`, `review_figma` |
| `OPENAI_API_KEY` | Studio: image generation |
| `TOGETHER_API_KEY` | Studio: alternative image generation |

## Privacy Policy

**Local Storage Only**: All project data is stored locally in `.decibel/` folders within your project directories. No data is sent to external servers by default.

**Optional Cloud Integrations**: Some tools optionally connect to external services when you explicitly configure API keys (Figma, Supabase, OpenAI). These are clearly marked with `openWorldHint: true` in their tool annotations.

**No Telemetry**: This MCP server does not collect telemetry, usage analytics, or any form of tracking data.

## License

MIT - [Decibel Systems](https://decibel.systems)
