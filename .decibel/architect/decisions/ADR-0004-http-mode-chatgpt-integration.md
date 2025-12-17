# ADR-0004: HTTP Mode for ChatGPT Integration

**Status:** Accepted
**Date:** 2025-12-14
**Authors:** Human + Claude Code

## Context

ChatGPT (via OpenAI's GPT interface) cannot use MCP's stdio transport. It requires HTTP-based tool access. We needed to enable ChatGPT to use Decibel tools (Sentinel, Architect, Designer, Oracle, Dojo) for project analysis and documentation.

Additionally, ChatGPT sends parameters with inconsistent casing and sometimes appends suffixes like "(summary)" to parameter names, causing 424 errors when parameters don't match expected schemas.

## Decision

### 1. HTTP Server Mode

Added `--http` flag to server startup that runs Express-based HTTP server alongside (or instead of) stdio MCP:

```bash
node dist/server.js --http --port 8787
```

Endpoints:
- `GET /health` - Health check
- `GET /tools` - List available tools
- `POST /call` - Execute tool: `{ tool: string, arguments: object }`

### 2. Parameter Normalization

Created `normalizeParams<T>()` helper to handle ChatGPT's parameter quirks:

```typescript
function normalizeParams<T>(params: Record<string, unknown>, expectedKeys: string[]): T {
  const normalized: Record<string, unknown> = {};
  const lowerExpected = expectedKeys.map(k => k.toLowerCase());

  for (const [key, value] of Object.entries(params)) {
    // Strip suffixes like "(summary)" and lowercase
    const cleanKey = key.replace(/\s*\([^)]*\)\s*$/g, '').toLowerCase();
    const matchIdx = lowerExpected.indexOf(cleanKey);
    if (matchIdx !== -1) {
      normalized[expectedKeys[matchIdx]] = value;
    }
  }
  return normalized as T;
}
```

Applied to tools that ChatGPT frequently uses:
- `architect_createAdr`
- `designer_record_design_decision`
- `architect_record_arch_decision`

### 3. Project-Scoped Sentinel

Added required `projectId` parameter to `sentinel_scan` tool since HTTP callers can't rely on cwd context:

```typescript
{
  name: 'sentinel_scan',
  inputSchema: {
    properties: {
      projectId: {
        type: 'string',
        description: 'Project ID to scan (e.g., "senken")'
      }
    },
    required: ['projectId']
  }
}
```

## Implementation

### Files Modified
- `src/server.ts`:
  - Added Express HTTP server with `/health`, `/tools`, `/call` endpoints
  - Added `--http` and `--port` CLI flags
  - Added `normalizeParams()` helper
  - Updated `sentinel_scan` to require `projectId`
  - Applied parameter normalization to architect/designer tools

### Usage

```bash
# Start in HTTP mode
node dist/server.js --http --port 8787

# Health check
curl http://localhost:8787/health

# List tools
curl http://localhost:8787/tools

# Call a tool
curl -X POST http://localhost:8787/call \
  -H "Content-Type: application/json" \
  -d '{"tool": "sentinel_scan", "arguments": {"projectId": "senken"}}'
```

## Consequences

### Positive
- ChatGPT can now use all Decibel tools via HTTP
- Parameter normalization handles ChatGPT's inconsistent casing gracefully
- Project-scoped operations work without filesystem context
- Same server binary serves both Claude (stdio) and ChatGPT (HTTP)

### Negative
- HTTP mode has no authentication (suitable for local use only)
- Parameter normalization adds overhead to affected tools
- `sentinel_scan` breaking change: now requires `projectId`

### ChatGPT Capabilities Enabled
- Scan projects for code analysis
- Create ADRs and design decisions
- Record architectural decisions
- File issues via Sentinel
- Query Oracle for context
- Access Dojo for experimentation (with role restrictions)

## Future Considerations

1. **Authentication:** Add API key or OAuth for production HTTP deployment
2. **CORS:** Configure for browser-based access if needed
3. **Rate limiting:** HTTP-level rate limiting (separate from role-based Dojo limits)
4. **WebSocket:** Consider WebSocket transport for streaming responses

## Testing

ChatGPT successfully:
1. Scanned Senken project
2. Generated comprehensive Decibel Report
3. Created design decisions
4. Filed issues

Sample successful flow:
```
ChatGPT → sentinel_scan(projectId: "senken") → scan results
ChatGPT → designer_record_design_decision(...) → recorded
ChatGPT → Generated markdown report with findings
```
