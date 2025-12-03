# decibel-tools-mcp

MCP (Model Context Protocol) server exposing Decibel tools (Designer, Architect, Sentinel, Oracle) over stdio. Connect from Cursor, Claude, ChatGPT, and other MCP-compatible clients.

## Features

- **Designer** - Record design decisions with project tracking
- **Architect** - Create Architecture Decision Records (ADRs)
- **Sentinel** - Track issues with severity levels
- **Oracle** - Get AI-powered next action recommendations

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

### designer.record_design_decision

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

### architect.record_arch_decision

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

### sentinel.create_issue

Create a tracked issue for a repository.

**Input:**
- `repo` (required): Repository name
- `severity` (required): One of `low`, `med`, `high`, `critical`
- `title` (required): Issue title
- `details` (required): Detailed description

**Output:**
- `id`: Filename of the created issue
- `timestamp`: ISO timestamp
- `path`: Full path to the file
- `status`: Issue status (always "open" for new issues)

**File Location:** `{ROOT_DIR}/sentinel/{repo}/issues/YYYY-MM-DDTHH-mm-ssZ-{slug}.md`

---

### oracle.next_actions

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
└── sentinel/
    └── {repo}/
        └── issues/
            └── YYYY-MM-DDTHH-mm-ssZ-{slug}.md
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
    ├── sentinel.ts   # Issue tracking
    └── oracle.ts     # Next actions inference
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
