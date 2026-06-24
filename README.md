# @decibelsystems/tools

**Project intelligence for AI coding sessions.** A single MCP server that gives Claude (or any MCP client) a durable memory for your project — issues, decisions, friction, roadmap, and more — stored as plain files inside your repo, so the context survives when the chat window doesn't.

> 29 facade tools (170+ internal handlers) across work tracking, architecture, experiments, design, git forensics, agent coordination, and security. Tested with Claude Desktop, Claude Code, and Cursor. [Learn more →](https://decibel.systems/tools)

<a href="https://github.com/decibelsystems/decibel-tools-mcp#cursor">
  <img src="https://cursor.com/deeplink/mcp-install-dark.svg" alt="Add to Cursor" height="32" />
</a>

---

## What is this?

When you work with an AI assistant, everything it "knows" about your project lives in the chat — and vanishes when the session ends. The next session starts cold: it re-discovers the same bugs, re-makes the same decisions, forgets why you chose Postgres over SQLite three weeks ago.

Decibel fixes that. It’s an MCP server that lets your AI **write project knowledge to disk** in a structured way and **read it back** in any future session. Track an issue in one conversation; a week later, a fresh session asks "what should I work on?" and gets the answer. Record an architecture decision once; it’s there forever. No database to run, no account to create — it’s just YAML and Markdown in a `.decibel/` folder in your repo.

## Objectives

Decibel is built around a few goals:

- **Persistence over recall.** Project state should outlive a single chat — so knowledge accrues instead of evaporating.
- **Local-first and private.** Everything is plain files in *your* repo. No telemetry, no cloud dependency, no lock-in. You can read, diff, and commit it like any other source.
- **One tool, many domains.** A handful of "facade" tools (each with an `action`) cover tracking, decisions, design, security, and coordination — instead of 170 separate tools cluttering the model’s context.
- **AI-native, human-readable.** Designed for an assistant to drive, but every artifact is something a person can open and understand.
- **Works everywhere MCP does.** Same tool set across Claude Code, Claude Desktop, Cursor, and custom agents over HTTP.

## Contents

- [Requirements](#requirements)
- [Quick Start](#quick-start)
- [Connect your AI client](#connect-your-ai-client) — [Claude Code](#claude-code) · [Claude Desktop](#claude-desktop) · [Cursor](#cursor)
- [Your first 5 minutes](#your-first-5-minutes)
- [The tools](#the-tools)
- [Daemon mode](#daemon-mode)
- [Configuration & Pro license](#configuration--pro-license)
- [Data storage](#data-storage)
- [Environment variables](#environment-variables)
- [Troubleshooting](#troubleshooting)
- [Privacy](#privacy)

---

## Requirements

- **Node.js ≥ 18** (`node --version` to check). On macOS, the easiest path is [Homebrew](https://brew.sh): `brew install node`.
- An MCP-capable client: Claude Code, Claude Desktop, Cursor, or your own.

## Quick Start

```bash
# Install globally…
npm install -g @decibelsystems/tools

# …or run on demand with npx (no install)
npx @decibelsystems/tools
```

Then wire it into your AI client below, and [initialize your first project](#your-first-5-minutes).

---

## Connect your AI client

The tool set is identical across every client — only the config file location differs.

### Claude Code

Add to `.mcp.json` in your project root (or `~/.claude/settings.json` to make it global):

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

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS). If the file doesn’t exist yet, create it.

> **Important — use the login-shell wrapper.** Claude Desktop launches with a stripped `PATH` and often can’t find a bare `npx`, so the server silently fails to start. Wrapping the command in `zsh -lc` makes it load your shell profile and find Node, wherever it’s installed:

```json
{
  "mcpServers": {
    "decibel-tools": {
      "command": "/bin/zsh",
      "args": ["-lc", "npx -y @decibelsystems/tools"]
    }
  }
}
```

After saving, **fully quit Claude Desktop (⌘Q, not just the window) and reopen.** The server appears under the **Desktop** group in *Settings → Connectors*. First launch is slow while `npx` downloads the package — give it 30–60s.

*Prefer a background service?* Run the [daemon](#daemon-mode) and add it as a **custom connector** (URL `http://127.0.0.1:4888/mcp`) instead — no per-app process, shared across clients.

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

---

## Your first 5 minutes

**1. Register a project.** Tools are scoped to a project, so this comes first. Just ask your assistant:

> "Run `project_init` for this folder."

That creates a `.decibel/` directory and registers the project. (Prefer files? Copy `projects.example.json` to `projects.json` and add your paths.)

**2. Start using it.** Everything is plain-language — the assistant maps your request to the right tool:

| You say… | What happens |
|----------|--------------|
| "Track a bug: the daemon doesn’t reconnect after sleep" | `sentinel` logs an issue |
| "Record why we chose Postgres over SQLite" | `architect` writes an ADR |
| "This build step keeps breaking — log it" | `friction` captures the pain point |
| "What should I work on next?" | `oracle` returns prioritized actions |
| "How healthy is this project?" | `workflow status` / `oracle` report |

**3. Come back later.** In a brand-new session, ask *"what’s open and what should I work on?"* — and the assistant reads back everything from `.decibel/`. That’s the whole point.

> 💡 **Tip:** Add a short note to your `CLAUDE.md` (Claude Code) or project instructions (Claude Desktop) telling the assistant to prefer Decibel tools for tracking work — so it reaches for them automatically.

---

## The tools

Every tool is a **facade**: one tool per domain, with an `action` parameter selecting the operation (e.g. `sentinel` + action `create_issue`).

### Core — always available

| Facade | Domain | Key actions |
|--------|--------|-------------|
| **sentinel** | Work tracking | `create_issue`, `close_issue`, `log_epic`, `list_epics`, `scan` |
| **architect** | Decisions (ADRs) | `create_adr`, `create_policy`, `list_policies`, `compile_oversight` |
| **dojo** | Incubation | `add_wish`, `create_proposal`, `scaffold_experiment`, `run_experiment` |
| **designer** | Design decisions | `record_design_decision`, `crit`, `sync_tokens`, `review_figma` |
| **oracle** | Recommendations | `next_actions`, `portfolio_summary`, `roadmap` |
| **roadmap** | Strategy | `get`, `list`, `get_health`, `link_epic`, `init` |
| **git** | Git forensics | `history`, `changes`, `link_issue` |
| **workflow** | Composites | `status`, `preflight`, `ship`, `investigate` |
| **vector** | Agent run tracking | `track`, `drift`, `score` |
| **context** | AI memory | `pin`, `unpin`, `list`, `event_append`, `event_search` |
| **auditor** | Code quality | `health`, `refactor_score` |
| **forecast** | Estimation | `estimate`, `decompose`, `capacity` |
| **velocity** | Metrics | `trends`, `contributors` |
| **coordinator** | Multi-agent locks | `lock`, `unlock`, `heartbeat`, `log`, `message` |
| **swarm** | Agent sessions | `start_session`, `join_session`, `emit_signal`, `claim_signal` |
| **peers** | Peer discovery | agent-to-agent presence & messaging |
| **concepts** | Concept graph | relate and query project concepts |
| **friction** | Pain points | `log`, `list`, `resolve`, `bump` |
| **registry** | Projects | `add`, `remove`, `list`, `alias`, `init`, `status` |
| **feedback** | Tool feedback | `submit`, `list` |
| **learnings** | Knowledge base | `append`, `list` |
| **provenance** | Audit trail | `list` |
| **bench** | Benchmarks | `run`, `compare` |
| **guardian** | Security scanning | `scan_deps`, `scan_secrets`, `scan_http`, `scan_config`, `report` |

### Pro — requires a license key

| Facade | Domain | Key actions |
|--------|--------|-------------|
| **voice** | Voice inbox | `sync`, `list`, `process` |
| **studio** | Creative assets | `generate_image`, `generate_video` |
| **corpus** | Code patterns | `search`, `index` |
| **agentic** | Config compilation | `compile_pack`, `render`, `lint`, `golden_eval` |

> Add your license key to `~/.decibel/config.yaml` under `license.key` to unlock Pro. See [Configuration](#configuration--pro-license).

---

## Daemon mode

Run Decibel as a persistent background service with an HTTP transport — useful when several clients (Desktop, Cursor, custom agents) should share one server and one set of `.decibel` data.

```bash
# Start the daemon (default 127.0.0.1:4888)
npx @decibelsystems/tools --daemon

# Both transports (stdio + HTTP) from one process
npx @decibelsystems/tools --daemon --stdio

# Manage it as a macOS launchd service (auto-start on login)
npx @decibelsystems/tools --daemon install
npx @decibelsystems/tools --daemon uninstall
npx @decibelsystems/tools --daemon status
```

The daemon includes log rotation, crash-loop protection (5 crashes in 60s), graceful shutdown with request draining, and a `/health` endpoint. MCP clients connect at **`http://127.0.0.1:4888/mcp`**; check it’s alive with `curl http://127.0.0.1:4888/health`.

---

## Configuration & Pro license

Create `~/.decibel/config.yaml`:

```yaml
daemon:
  port: 4888
  host: 127.0.0.1
  auth_token: your-secret-token   # optional; required for non-localhost
  log_max_size_mb: 10
  log_max_files: 3
  rate_limit_rpm: 60
license:
  key: your-license-key           # unlocks Pro facades
```

CLI flags override config-file values. Send `SIGHUP` to reload config without restarting.

---

## Data storage

Everything lives in a project-local `.decibel/` folder — readable, diffable, commit-able:

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
    └── voice/inbox/     # Voice messages (Pro)
```

## Environment variables

### Core

| Variable | Default | Description |
|----------|---------|-------------|
| `DECIBEL_ENV` | `dev` | Environment (`dev`, `staging`, `prod`) |
| `DECIBEL_ORG` | `default` | Organization name |
| `DECIBEL_MCP_ROOT` | `~/.decibel` | Global data storage root |
| `DECIBEL_PROJECT_ROOT` | — | Current project root path |
| `DECIBEL_REGISTRY_PATH` | — | Custom registry file location |
| `DECIBEL_PRO` | — | Set to `1` to enable Pro facades in dev |

### Optional integrations

| Variable | Used by |
|----------|---------|
| `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` | Voice inbox, swarm sessions |
| `FIGMA_ACCESS_TOKEN` | Designer: `sync_tokens`, `review_figma` |
| `OPENAI_API_KEY` | Studio: image generation |
| `TOGETHER_API_KEY` | Studio: alternative image generation |

---

## Troubleshooting

**Tools don’t show up in Claude Desktop.**
1. You almost certainly hit the `PATH` problem — use the [`zsh -lc` wrapper](#claude-desktop), not a bare `npx`.
2. **Fully quit** (⌘Q) and reopen — a closed window isn’t a restart.
3. First launch downloads the package; wait 30–60s.
4. Check the log: `~/Library/Logs/Claude/mcp-server-decibel-tools.log`.

**`PROJECT_NOT_FOUND` errors.** Nothing’s registered yet — run `project_init` (or `registry add`) for your project before calling other tools.

**Local server vs. hosted connector.** decibel-tools is a *local* MCP server — it’s configured in the JSON file and only appears once you add it there. It won’t show up in the connector *search* (that only lists Anthropic’s hosted catalog). Hosted connectors (GitHub, Gmail) are separate, account-scoped, and enabled per-app and per-conversation.

**Pro facades missing.** They need a `license.key` in `~/.decibel/config.yaml` (or `DECIBEL_PRO=1` in dev).

---

## Privacy

- **Local storage only.** All project data stays in `.decibel/` folders in your repos. Nothing is sent anywhere by default.
- **Optional cloud integrations** activate only when you configure API keys (Figma, Supabase, OpenAI) — marked `openWorldHint: true` in their tool annotations.
- **No telemetry.** No usage analytics, no tracking.

## License

MIT — [Decibel Systems](https://decibel.systems)
