# Decibel Tools MCP – System Design

> AI-ingestible reference for the decibel-tools-mcp server architecture.

---

## Vision: Persistent Project Intelligence for AI

**The Problem:** AI assistants are stateless. Every new Claude thread starts cold—no memory of past decisions, no understanding of project structure, no awareness of hard-won lessons. Teams rediscover the same context session after session.

**The Solution:** Make the project itself the memory. Structure institutional knowledge in a way AI can consume instantly.

```
┌─────────────────────────────────────────────────────────┐
│  Claude / Cursor / ChatGPT                              │
│  "Fix the auth bug" / "Add a new endpoint"              │
└─────────────────────┬───────────────────────────────────┘
                      │ MCP (stdio)
                      ▼
┌─────────────────────────────────────────────────────────┐
│  decibel-tools-mcp                                      │
│  ════════════════════════════════════════════════════   │
│  Unified MCP Gateway to Decibel Ecosystem               │
└───┬─────────┬─────────┬─────────┬───────────────────────┘
    │         │         │         │
    ▼         ▼         ▼         ▼
┌───────┐ ┌─────────┐ ┌──────────┐ ┌────────┐
│Decibel│ │Architect│ │ Sentinel │ │ Oracle │
│ Tools │ │         │ │          │ │        │
└───────┘ └─────────┘ └──────────┘ └────────┘
    │         │            │           │
    ▼         ▼            ▼           ▼
 Start/    Domains      Health      Synthesize
 Stop      Invariants   Scans       Insights
 Monitor   Components   Issues      Next Actions
           Protocols    Risk
```

**What Claude Gets:**

| Layer | Intelligence | Source |
|-------|--------------|--------|
| **Understanding** | What exists, how it's organized, what's protected | `manifest.yaml`, domains |
| **Memory** | Past decisions, why things are the way they are | ADRs, `decisions/` |
| **Best Practices** | How to do things correctly | `protocols/*.md` |
| **Hard Rules** | What must never be violated | `invariants.yaml` |
| **Health** | What's broken, risky, needs attention | Sentinel scans |
| **Synthesis** | Cross-project insights, prioritized next actions | Oracle analysis |

**The Result:** Every Claude session starts smart. A thread fixing a bug knows:
- "This touches a protected domain—check the protocol first"
- "We tried approach X before, here's why we chose Y"
- "These 3 invariants apply to the code you're changing"
- "Component Z exists but isn't wired yet—maybe that's the bug"

This is **institutional knowledge as a service**.

---

## The Decibel Ecosystem

| Tool | CLI | Purpose | Repo |
|------|-----|---------|------|
| **Decibel Tools** | `decibel` | Orchestration: start/stop/monitor components | [decibel-tools](https://github.com/mediareason/decibel-tools) |
| **Architect** | `arch` | Governance: domains, invariants, protocols, components | [decibel-architect](https://github.com/mediareason/decibel-architect) |
| **Sentinel** | `sentinel` | Health: repo scanning, issue tracking, risk scores | [decibel-sentinel](https://github.com/mediareason/decibel-sentinel) |
| **Oracle** | `oracle` | Strategy: cross-project synthesis, next actions | [decibel-oracle](https://github.com/mediareason/decibel-oracle) |

This MCP server is the **unified gateway** that exposes all tools to AI clients.

---

## Current Implementation (v0)

The current version is a file-based prototype. Tools write markdown files with YAML frontmatter.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DECIBEL_ENV` | `dev` | Environment: dev, staging, prod |
| `DECIBEL_ORG` | `mediareason` | Organization identifier |
| `DECIBEL_MCP_ROOT` | `./data` | Root directory for all file storage |

### Directory Structure

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
        ├── issues/
        │   └── {timestamp}-{slug}.md
        └── epics/
            └── EPIC-XXXX-{slug}.md
```

**Filename format:** `YYYY-MM-DDTHH-mm-ssZ-{slug}.md`

---

## Tools (v0)

**8 tools available:**
- `designer.record_design_decision` - Record design decisions
- `architect.record_arch_decision` - Create ADRs
- `sentinel.create_issue` - Track issues with severity
- `sentinel.log_epic` - Create epics for grouping issues
- `sentinel.list_epics` - List epics for a repo
- `sentinel.get_epic` - Get epic details
- `sentinel.get_epic_issues` - Get issues linked to an epic
- `oracle.next_actions` - Get prioritized recommendations

---

### 1. designer.record_design_decision

Record design decisions for a project.

```typescript
// Input
{
  project_id: string;  // Required
  area: string;        // Required - domain (UI, API, Database, etc.)
  summary: string;     // Required
  details?: string;    // Optional
}

// Output
{
  id: string;        // Filename
  timestamp: string; // ISO 8601
  path: string;      // Absolute path
}
```

### 2. architect.record_arch_decision

Create Architecture Decision Records (ADRs).

```typescript
// Input
{
  system_id: string;   // Required
  change: string;      // Required
  rationale: string;   // Required
  impact?: string;     // Optional
}

// Output
{
  id: string;
  timestamp: string;
  path: string;
}
```

### 3. sentinel.create_issue

Track issues with severity levels.

```typescript
// Input
{
  repo: string;                                  // Required
  severity: "low" | "med" | "high" | "critical"; // Required
  title: string;                                 // Required
  details: string;                               // Required
  epic_id?: string;                              // Optional - link to epic
}

// Output
{
  id: string;
  timestamp: string;
  path: string;
  status: "open";
  epic_id?: string;  // If linked
}
```

### 4. sentinel.log_epic

Create an epic for grouping related issues.

```typescript
// Input
{
  repo: string;                                              // Required
  title: string;                                             // Required
  summary: string;                                           // Required
  priority?: "low" | "med" | "high" | "critical";            // Optional, default: "med"
  status?: "planned" | "in_progress" | "shipped" | "on_hold" | "cancelled"; // Optional, default: "planned"
}

// Output
{
  epic_id: string;   // e.g., "EPIC-0001"
  timestamp: string;
  path: string;
}
```

### 5. sentinel.list_epics

List all epics for a repository.

```typescript
// Input
{
  repo: string;                                              // Required
  status?: "planned" | "in_progress" | "shipped" | "on_hold" | "cancelled"; // Optional filter
}

// Output
{
  epics: Array<{
    epic_id: string;
    title: string;
    status: string;
    priority: string;
    issue_count: number;
  }>;
}
```

### 6. sentinel.get_epic

Get full details of a specific epic.

```typescript
// Input
{
  repo: string;    // Required
  epic_id: string; // Required
}

// Output
{
  epic_id: string;
  title: string;
  summary: string;
  status: string;
  priority: string;
  created_at: string;
  path: string;
}
```

### 7. sentinel.get_epic_issues

Get all issues linked to an epic.

```typescript
// Input
{
  repo: string;    // Required
  epic_id: string; // Required
}

// Output
{
  epic_id: string;
  issues: Array<{
    id: string;
    title: string;
    severity: string;
    status: string;
  }>;
}
```

### 8. oracle.next_actions

Infer prioritized next actions from recent activity.

```typescript
// Input
{
  project_id: string;  // Required
  focus?: string;      // Optional - filter by type or keyword
}

// Output
{
  actions: Array<{
    description: string;
    source: string;
    priority: "low" | "med" | "high";
  }>;
}
```

---

## Future Tools (Planned)

When integrated with real CLIs:

### Orchestration (decibel)
- `decibel.up` - Start components
- `decibel.down` - Stop components
- `decibel.ps` - Show running status
- `decibel.health` - Check health signals

### Governance (architect)
- `architect.get_status` - Project overview
- `architect.get_components` - List all components with wiring status
- `architect.get_invariants` - List hard rules
- `architect.get_protocol` - Fetch protocol by name
- `architect.check_wiring` - Validate component connections
- `architect.update_component_status` - Change lifecycle state

### Health (sentinel)
- `sentinel.scan` - Full repo scan with recommendations
- `sentinel.health` - Quick health check
- `sentinel.get_issues` - List open issues

### Strategy (oracle)
- `oracle.synthesize` - Cross-project insights
- `oracle.next_actions` - Prioritized recommendations

---

## Key Data Structures (Full Ecosystem)

### Manifest (`architect/manifest.yaml`)
```yaml
id: my-project
name: My Project
domains:
  db:
    name: Database
    status: protected  # or 'normal'
    paths: [backend/config.py]
    protocols: [db_config_v1]
```

### Invariants (`architect/invariants.yaml`)
```yaml
invariants:
  - id: db.single_source
    level: critical
    domain: db
    statement: "Only DatabaseConfig defines connection strings"
    detection: ["grep -r 'sqlite:///' --include='*.py'"]
```

### Components (`architect/components.yaml`)
```yaml
components:
  - id: auth-service
    type: service
    domain: auth
    status: live  # planned → wired → live → deprecated
    entrypoints: [src/auth/main.py]
    health_signals: [metric: auth.requests_per_sec]
```

### Protocols (`docs/protocols/*.md`)
```markdown
---
id: db_config_v1
version: 1
domain: db
---
# Database Configuration Protocol
## The Rule
All database connections come from DatabaseConfig.
```

---

## MCP Protocol

**Transport:** JSON-RPC 2.0 over stdin/stdout (stdio)

**Server Info:**
```json
{"name": "decibel-tools-mcp", "version": "0.1.0"}
```

**Capabilities:**
```json
{"tools": {}}
```

---

## Integration

### Cursor (`mcp.json`)
```json
{
  "mcpServers": {
    "decibel-tools": {
      "command": "node",
      "type": "stdio",
      "args": ["/path/to/dist/server.js"],
      "env": {"DECIBEL_MCP_ROOT": "/path/to/data"}
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
      "env": {"DECIBEL_MCP_ROOT": "/path/to/data"}
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
npm test              # 90+ tests across unit/integration/e2e
npm run test:coverage # 100% line coverage on tools
```

**Test structure:**
- `tests/unit/` – Tool implementations (designer, architect, sentinel w/ epics, oracle)
- `tests/integration/` – MCP protocol via in-memory transport
- `tests/e2e/` – Full stdio spawn
- `tests/fixtures/` – Sample payloads and helpers
