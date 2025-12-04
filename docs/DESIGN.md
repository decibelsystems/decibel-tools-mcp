# Decibel Tools MCP – System Design

> AI-ingestible reference for the decibel-tools-mcp server architecture.

## Overview

**Purpose:** File-based decision tracking and issue management exposed via MCP (Model Context Protocol) over stdio.

**Transport:** JSON-RPC 2.0 over stdin/stdout (MCP stdio transport)

**Storage:** Markdown files with YAML frontmatter in `DECIBEL_MCP_ROOT`

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DECIBEL_ENV` | `dev` | Environment: dev, staging, prod |
| `DECIBEL_ORG` | `mediareason` | Organization identifier |
| `DECIBEL_MCP_ROOT` | `./data` | Root directory for all file storage |

---

## Directory Structure

```
{DECIBEL_MCP_ROOT}/
├── designer/
│   └── {project_id}/
│       └── {timestamp}-{slug}.md
├── architect/
│   └── {system_id}/
│       └── {timestamp}-{slug}.md
└── sentinel/
    └── {repo}/
        └── issues/
            └── {timestamp}-{slug}.md
```

**Filename format:** `YYYY-MM-DDTHH-mm-ssZ-{slug}.md`
- Timestamp: ISO 8601, colons replaced with hyphens
- Slug: Lowercase, alphanumeric + hyphens, max 50 chars

---

## Tools

### 1. designer.record_design_decision

**Purpose:** Record design decisions for a project.

**Input Schema:**
```typescript
{
  project_id: string;  // Required - project identifier
  area: string;        // Required - domain (UI, API, Database, etc.)
  summary: string;     // Required - brief description
  details?: string;    // Optional - extended explanation
}
```

**Output:**
```typescript
{
  id: string;        // Filename
  timestamp: string; // ISO 8601
  path: string;      // Absolute file path
}
```

**File Format:**
```markdown
---
project_id: {project_id}
area: {area}
summary: {summary}
timestamp: {ISO timestamp}
---

# {summary}

{details or summary}
```

---

### 2. architect.record_arch_decision

**Purpose:** Create Architecture Decision Records (ADRs).

**Input Schema:**
```typescript
{
  system_id: string;   // Required - system identifier
  change: string;      // Required - what is changing
  rationale: string;   // Required - why this change
  impact?: string;     // Optional - expected effects
}
```

**Output:**
```typescript
{
  id: string;
  timestamp: string;
  path: string;
}
```

**File Format:**
```markdown
---
system_id: {system_id}
change: {change}
timestamp: {ISO timestamp}
---

# ADR: {change}

## Change

{change}

## Rationale

{rationale}

## Impact

{impact or "No specific impact documented."}
```

---

### 3. sentinel.create_issue

**Purpose:** Track issues with severity levels.

**Input Schema:**
```typescript
{
  repo: string;                              // Required
  severity: "low" | "med" | "high" | "critical"; // Required
  title: string;                             // Required
  details: string;                           // Required
}
```

**Output:**
```typescript
{
  id: string;
  timestamp: string;
  path: string;
  status: "open";  // Always "open" for new issues
}
```

**File Format:**
```markdown
---
repo: {repo}
severity: {severity}
status: open
created_at: {ISO timestamp}
---

# {title}

**Severity:** {severity}
**Status:** open

## Details

{details}
```

---

### 4. oracle.next_actions

**Purpose:** Infer prioritized next actions from recent project activity.

**Input Schema:**
```typescript
{
  project_id: string;  // Required - scans designer/{project_id}, architect/{project_id}, sentinel/{project_id}
  focus?: string;      // Optional - filter by type ("designer", "architect", "sentinel") or keyword
}
```

**Output:**
```typescript
{
  actions: Array<{
    description: string;           // What to do
    source: string;                // File path
    priority: "low" | "med" | "high";
  }>;
}
```

**Behavior:**
1. Scans last 10 files (by timestamp) from designer, architect, sentinel dirs
2. Prioritizes: critical/high sentinel → architect → designer
3. Returns 3-7 actions sorted by priority
4. If no files found, returns guidance message

**Priority Assignment:**
- Sentinel critical/high → `high`
- Sentinel med → `med`
- Sentinel low → `low`
- Architect → `med`
- Designer → `low`

---

## MCP Protocol Details

**Server Info:**
```json
{
  "name": "decibel-tools-mcp",
  "version": "0.1.0"
}
```

**Capabilities:**
```json
{
  "tools": {}
}
```

**Error Response Format:**
```json
{
  "content": [{"type": "text", "text": "{\"error\": \"message\"}"}],
  "isError": true
}
```

---

## Integration Examples

### Cursor (mcp.json)
```json
{
  "mcpServers": {
    "decibel-tools": {
      "command": "node",
      "type": "stdio",
      "args": ["/path/to/dist/server.js"],
      "env": {
        "DECIBEL_MCP_ROOT": "/path/to/data"
      }
    }
  }
}
```

### Claude Desktop
```json
{
  "mcpServers": {
    "decibel-tools": {
      "command": "node",
      "args": ["/path/to/dist/server.js"],
      "env": {
        "DECIBEL_MCP_ROOT": "/path/to/data"
      }
    }
  }
}
```

---

## Source Files

```
src/
├── server.ts          # MCP entrypoint, tool routing
├── config.ts          # getConfig(), log()
└── tools/
    ├── designer.ts    # recordDesignDecision()
    ├── architect.ts   # recordArchDecision()
    ├── sentinel.ts    # createIssue()
    └── oracle.ts      # nextActions()
```

---

## Key Invariants

1. **Files are append-only** – No updates or deletes via tools
2. **Timestamps are deterministic** – Based on Date.now() at call time
3. **Slugs are filesystem-safe** – Only `[a-z0-9-]`, max 50 chars
4. **Frontmatter is valid YAML** – Parseable by any YAML library
5. **Directories auto-create** – `fs.mkdir(..., { recursive: true })`

---

## Testing

```bash
npm test              # 70 tests across unit/integration/e2e
npm run test:coverage # 100% line coverage on tools
```

**Test structure:**
- `tests/unit/` – Tool implementations
- `tests/integration/` – MCP protocol via in-memory transport
- `tests/e2e/` – Full stdio spawn
- `tests/fixtures/` – Sample payloads and helpers
