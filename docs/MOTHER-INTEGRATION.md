# Mother Integration Guide

How to integrate Senken's Mother AI with Decibel MCP tools via HTTP.

**Current Version:** 0.2.0
**API Version:** v1

## Endpoints

```
Base URL: http://localhost:8787
```

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check (returns version) |
| GET | `/tools` | List available tools |
| POST | `/call` | Execute any tool (generic) |
| POST | `/dojo/wish` | Shorthand for dojo_add_wish |
| POST | `/dojo/propose` | Shorthand for dojo_create_proposal |
| POST | `/dojo/scaffold` | Shorthand for dojo_scaffold_experiment |
| POST | `/dojo/run` | Shorthand for dojo_run_experiment |
| POST | `/dojo/results` | Shorthand for dojo_get_results |
| GET/POST | `/dojo/list` | List all (GET supports `?project_id=`) |
| GET/POST | `/dojo/wishes` | List wishes |
| POST | `/dojo/can-graduate` | Check graduation eligibility |
| POST | `/mcp` | Full MCP protocol endpoint |

## Authentication

Currently none (local use only).

Future: Start server with `--auth-token <token>` and include `Authorization: Bearer <token>` header.

## Response Format (Status Envelope)

All responses use a normalized status envelope:

```json
// Success
{"status": "executed", ...data}

// Error
{"status": "error", "error": "message", "code": "ERROR_CODE"}
```

Error codes:
- `RATE_LIMITED` - Too many requests
- `ACCESS_DENIED` - Tool blocked for caller role
- `NOT_FOUND` - Resource not found
- `UNKNOWN_TOOL` - Invalid tool name
- `PARSE_ERROR` - Invalid JSON
- `EXIT_N` - CLI exited with code N

## Request Format

```json
POST /call
Content-Type: application/json

{
  "tool": "dojo_add_wish",
  "arguments": {
    "project_id": "senken",
    "caller_role": "mother",
    "agent_id": "mother-v1",
    ...tool-specific params
  }
}
```

Or use shorthand endpoints directly:

```json
POST /dojo/wish
Content-Type: application/json

{
  "project_id": "senken",
  "caller_role": "mother",
  "agent_id": "mother-v1",
  "capability": "Dynamic stop-loss",
  "reason": "Static SL causes losses"
}
```

## Required Parameters (All Dojo Tools)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `project_id` | string | Yes | Project ID (e.g., "senken") |
| `caller_role` | string | No | `"human"` \| `"mother"` \| `"ai"` (default: human) |
| `agent_id` | string | No | Agent identifier for audit trails |

**Always set `caller_role: "mother"` and `agent_id: "mother-v1"` (or similar) for proper access control and audit logging.**

## Available Dojo Tools

### dojo_add_wish
Log a capability wish with optional context.

```json
{
  "tool": "dojo_add_wish",
  "arguments": {
    "project_id": "senken",
    "caller_role": "mother",
    "agent_id": "mother-v1",
    "capability": "Dynamic stop-loss adjustment",
    "reason": "Static SL causes losses in high-vol periods",
    "context": {"recent_losses": 3, "volatility_spike": true}
  }
}
```

Response:
```json
{
  "wish_id": "WISH-0001",
  "capability": "Dynamic stop-loss adjustment",
  "timestamp": "2025-12-15T10:30:00Z"
}
```

### dojo_create_proposal
Create a proposal, optionally linked to a wish.

```json
{
  "tool": "dojo_create_proposal",
  "arguments": {
    "project_id": "senken",
    "caller_role": "mother",
    "agent_id": "mother-v1",
    "title": "Dynamic Stop-Loss Adjuster",
    "problem": "Static SL causes losses in volatile markets",
    "hypothesis": "Volatility-aware SL adjustment will reduce drawdown",
    "wish_id": "WISH-0001",
    "owner": "ai",
    "target_module": "sentinel"
  }
}
```

When `wish_id` is provided:
- Problem auto-fills from wish's reason (if not specified)
- Wish is marked as resolved -> proposal ID

### dojo_scaffold_experiment
Create experiment skeleton from a proposal.

```json
{
  "tool": "dojo_scaffold_experiment",
  "arguments": {
    "project_id": "senken",
    "caller_role": "mother",
    "agent_id": "mother-v1",
    "proposal_id": "DOJO-PROP-0001",
    "script_type": "py",
    "experiment_type": "script"
  }
}
```

`experiment_type` options: `script` | `tool` | `check` | `prompt`

### dojo_run_experiment
Run experiment in sandbox mode. Results written to `{project}/.decibel/dojo/results/`.

```json
{
  "tool": "dojo_run_experiment",
  "arguments": {
    "project_id": "senken",
    "caller_role": "mother",
    "agent_id": "mother-v1",
    "experiment_id": "DOJO-EXP-0001"
  }
}
```

Response:
```json
{
  "experiment_id": "DOJO-EXP-0001",
  "status": "success",
  "exit_code": 0,
  "duration_seconds": 45,
  "results_dir": ".decibel/dojo/results/DOJO-EXP-0001/20251215-103000",
  "output": {
    "metrics": {"improvement": 0.15},
    "artifacts": ["results.json", "plot.png"]
  }
}
```

### dojo_get_results
Get results from a previous run.

```json
{
  "tool": "dojo_get_results",
  "arguments": {
    "project_id": "senken",
    "caller_role": "mother",
    "agent_id": "mother-v1",
    "experiment_id": "DOJO-EXP-0001",
    "run_id": "20251215-103000"
  }
}
```

### dojo_list
List proposals, experiments, and wishes.

```json
{
  "tool": "dojo_list",
  "arguments": {
    "project_id": "senken",
    "caller_role": "mother",
    "agent_id": "mother-v1",
    "filter": "all"
  }
}
```

`filter` options: `all` | `proposals` | `experiments` | `wishes`

### dojo_list_wishes
List wishes from the wishlist.

```json
{
  "tool": "dojo_list_wishes",
  "arguments": {
    "project_id": "senken",
    "caller_role": "mother",
    "agent_id": "mother-v1",
    "unresolved_only": true
  }
}
```

### dojo_can_graduate
Check if experiment is eligible for graduation.

```json
{
  "tool": "dojo_can_graduate",
  "arguments": {
    "project_id": "senken",
    "caller_role": "mother",
    "agent_id": "mother-v1",
    "experiment_id": "DOJO-EXP-0001"
  }
}
```

Response:
```json
{
  "experiment_id": "DOJO-EXP-0001",
  "can_graduate": false,
  "has_tool_definition": true,
  "is_enabled": false,
  "reasons": ["Experiment not enabled yet", "Has tool definition"]
}
```

## Blocked Tools (Human-Only)

These tools exist in CLI but are **never exposed to AI callers**:

- `dojo_enable_experiment` - Flip experiment to enabled mode
- `dojo_disable_experiment` - Disable an experiment
- `dojo_graduate_experiment` - Promote to real tool

Mother can propose and test, but humans approve for production.

## Rate Limits

| Role | Requests/min | Max Concurrent |
|------|--------------|----------------|
| human | unlimited | unlimited |
| mother | 30 | 3 |
| ai | 20 | 2 |

When rate limited, response includes:
```json
{
  "error": "Rate limit: Rate limit exceeded (30 requests/minute). Try again in 45s.",
  "retryAfterMs": 45000
}
```

## Mother's Typical Workflow

```
1. Encounter limitation
   └─> dojo_add_wish (with context)

2. Have solution idea
   └─> dojo_create_proposal (link to wish_id)

3. Proposal approved (by human or auto)
   └─> dojo_scaffold_experiment

4. Implement experiment code
   └─> (Mother writes to experiment files)

5. Test in sandbox
   └─> dojo_run_experiment
   └─> dojo_get_results

6. Check graduation eligibility
   └─> dojo_can_graduate

7. Request human review
   └─> (Human runs: decibel dojo enable/graduate)
```

## Error Handling

All errors return:
```json
{
  "error": "Error message",
  "exitCode": 1,
  "stderr": "CLI stderr output (truncated to 500 chars)"
}
```

Common errors:
- `Rate limit: ...` - Too many requests, wait and retry
- `Access denied: ...` - Tool not allowed for caller_role
- `Project not found: ...` - Invalid project_id
- `Experiment not found: ...` - Invalid experiment_id

## Starting the Server

```bash
# Development
node dist/server.js --http --port 8787

# With auth (future)
node dist/server.js --http --port 8787 --auth-token secret123
```

## Version Checking

Mother should check version on startup:

```python
def check_dojo_available() -> dict | None:
    try:
        resp = requests.get("http://localhost:8787/health", timeout=2)
        if resp.status_code == 200:
            data = resp.json()
            # {"status": "ok", "version": "0.2.0", "api_version": "v1"}
            return data
        return None
    except:
        return None

# On startup
caps = check_dojo_available()
if caps and caps.get("api_version") == "v1":
    print(f"✓ DOJO connected (v{caps['version']})")
else:
    print("○ DOJO offline")
```

## Testing Connection

```bash
# Health check (shows version)
curl http://localhost:8787/health
# {"status":"ok","version":"0.2.0","api_version":"v1"}

# List tools
curl http://localhost:8787/tools

# Test wish via shorthand endpoint
curl -X POST http://localhost:8787/dojo/wish \
  -H "Content-Type: application/json" \
  -d '{
    "project_id": "senken",
    "caller_role": "mother",
    "agent_id": "mother-test",
    "capability": "Test capability",
    "reason": "Testing integration"
  }'

# Or via generic /call
curl -X POST http://localhost:8787/call \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "dojo_add_wish",
    "arguments": {
      "project_id": "senken",
      "caller_role": "mother",
      "agent_id": "mother-test",
      "capability": "Test capability",
      "reason": "Testing integration"
    }
  }'
```
