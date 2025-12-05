# decibel-tools-mcp

MCP (Model Context Protocol) server exposing Decibel tools (Designer, Architect, Sentinel, Oracle, Learnings) over stdio. Connect from Cursor, Claude, ChatGPT, and other MCP-compatible clients.

## Features

- **Designer** - Record design decisions with project tracking
- **Architect** - Create Architecture Decision Records (ADRs)
- **Sentinel** - Track issues and epics with severity levels
- **Oracle** - Get AI-powered next action recommendations
- **Learnings** - Maintain living technical learnings documents

## Quick Start

### Installation

```bash
npm install
```

### Development

Run the server in development mode:

```bash
npm run dev
```

### Production Build

```bash
npm run build
npm start
```

### Testing

Run the test script to verify all tools work:

```bash
npm test
```

## Configuration

The server uses environment variables for configuration:

| Variable | Default | Description |
|----------|---------|-------------|
| `DECIBEL_ENV` | `dev` | Environment (dev, staging, prod) |
| `DECIBEL_ORG` | `mediareason` | Organization name |
| `DECIBEL_MCP_ROOT` | `./data` | Root directory for data storage |

Copy `.env.example` to `.env` and configure as needed:

```bash
cp .env.example .env
```

## Connecting to Clients

### Cursor

Add to your Cursor MCP configuration (`~/.cursor/mcp.json` or project `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "decibel-tools": {
      "command": "node",
      "type": "stdio",
      "args": ["/path/to/decibel-tools-mcp/dist/server.js"],
      "env": {
        "DECIBEL_MCP_ROOT": "/path/to/decibel-mcp-data"
      }
    }
  }
}
```

### Claude Desktop

Add to your Claude configuration (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "decibel-tools": {
      "command": "node",
      "args": ["/path/to/decibel-tools-mcp/dist/server.js"],
      "env": {
        "DECIBEL_MCP_ROOT": "/path/to/decibel-mcp-data"
      }
    }
  }
}
```

## Tools Reference

### designer_record_design_decision

Record a design decision for a project.

**Input:**
- `project_id` (required): Project identifier
- `area` (required): Design area (e.g., "UI", "API", "Database")
- `summary` (required): Brief summary of the decision
- `details` (optional): Detailed explanation

**Output:**
- `id`: Filename of the created record
- `timestamp`: ISO timestamp
- `path`: Full path to the file

**File Location:** `{ROOT_DIR}/designer/{project_id}/YYYY-MM-DDTHH-mm-ssZ-{slug}.md`

---

### architect_record_arch_decision

Record an Architecture Decision Record (ADR).

**Input:**
- `system_id` (required): System identifier
- `change` (required): Description of the architectural change
- `rationale` (required): Reasoning behind the decision
- `impact` (optional): Expected impact description

**Output:**
- `id`: Filename of the created ADR
- `timestamp`: ISO timestamp
- `path`: Full path to the file

**File Location:** `{ROOT_DIR}/architect/{system_id}/YYYY-MM-DDTHH-mm-ssZ-{slug}.md`

---

### sentinel_create_issue

Create a tracked issue for a repository.

**Input:**
- `repo` (required): Repository name
- `severity` (required): One of `low`, `med`, `high`, `critical`
- `title` (required): Issue title
- `details` (required): Detailed description
- `epic_id` (optional): Parent epic ID (e.g., "EPIC-0001")

**Output:**
- `id`: Filename of the created issue
- `timestamp`: ISO timestamp
- `path`: Full path to the file
- `status`: Issue status (always "open" for new issues)

**File Location:** `{ROOT_DIR}/sentinel/{repo}/issues/YYYY-MM-DDTHH-mm-ssZ-{slug}.md`

---

### sentinel_log_epic

Create a new epic (large feature) record.

**Input:**
- `title` (required): Epic title
- `summary` (required): Brief summary
- `motivation` (optional): Array of motivation statements
- `outcomes` (optional): Array of desired outcomes
- `acceptance_criteria` (optional): Array of acceptance criteria
- `priority` (optional): One of `low`, `medium`, `high`, `critical`
- `tags` (optional): Array of tags
- `owner` (optional): Epic owner
- `squad` (optional): Team responsible

**Output:**
- `epic_id`: Generated epic ID (e.g., "EPIC-0001")
- `timestamp`: ISO timestamp
- `path`: Full path to the file

---

### sentinel_list_epics

List all epics with optional filters.

**Input:**
- `status` (optional): Filter by status (`planned`, `in_progress`, `shipped`, `on_hold`, `cancelled`)
- `priority` (optional): Filter by priority
- `tags` (optional): Filter by tags (matches any)

---

### sentinel_get_epic

Get details of a specific epic.

**Input:**
- `epic_id` (required): Epic ID (e.g., "EPIC-0001")

---

### sentinel_get_epic_issues

Get all issues linked to an epic.

**Input:**
- `epic_id` (required): Epic ID

---

### sentinel_resolve_epic

Fuzzy search for epics by name or keyword.

**Input:**
- `query` (required): Search query
- `limit` (optional): Maximum matches to return (default: 5)

---

### oracle_next_actions

Get recommended next actions based on recent project activity.

**Input:**
- `project_id` (required): Project to analyze
- `focus` (optional): Filter by area (e.g., "architect", "sentinel", or keyword)

**Output:**
- `actions`: Array of recommended actions
  - `description`: What to do
  - `source`: File path reference
  - `priority`: One of `low`, `med`, `high`

---

### learnings_append

Append a new entry to a project's technical learnings document. Creates a living document that accumulates lessons learned, gotchas, and insights over time.

**Input:**
- `project_id` (required): Project identifier
- `category` (required): One of `debug`, `integration`, `architecture`, `tooling`, `process`, `other`
- `title` (required): Brief title for the learning
- `content` (required): The learning content - what happened, what was learned
- `tags` (optional): Array of tags for searchability

**Output:**
- `timestamp`: ISO timestamp
- `path`: Full path to the file
- `entry_count`: Total number of entries in the document

**File Location:** `{ROOT_DIR}/learnings/{project_id}.md`

---

### learnings_list

List entries from a project's technical learnings document.

**Input:**
- `project_id` (required): Project identifier
- `category` (optional): Filter by category
- `limit` (optional): Maximum entries to return (most recent first)

**Output:**
- `path`: Path to the learnings file
- `entries`: Array of learning entries
- `total_count`: Total number of entries

---

## Data Storage

All data is stored as Markdown files with YAML frontmatter:

```
{DECIBEL_MCP_ROOT}/
├── designer/
│   └── {project_id}/
│       └── YYYY-MM-DDTHH-mm-ssZ-{slug}.md
├── architect/
│   └── {system_id}/
│       └── YYYY-MM-DDTHH-mm-ssZ-{slug}.md
├── sentinel/
│   ├── epics/
│   │   └── EPIC-{nnnn}-{slug}.md
│   └── {repo}/
│       └── issues/
│           └── YYYY-MM-DDTHH-mm-ssZ-{slug}.md
└── learnings/
    └── {project_id}.md
```

## Development

### Project Structure

```
src/
├── server.ts      # MCP server entrypoint
├── config.ts      # Environment configuration
├── test.ts        # Test script
└── tools/
    ├── designer.ts   # Design decision recording
    ├── architect.ts  # Architecture decision recording
    ├── sentinel.ts   # Issue and epic tracking
    ├── oracle.ts     # Next actions inference
    └── learnings.ts  # Living learnings documents
```

### Building

```bash
npm run build   # Compile TypeScript to dist/
```

### Running in Development

```bash
npm run dev     # Run with tsx (no build required)
```

## License

MIT
