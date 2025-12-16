# MCP Integration Directive

Guide for integrating and testing decibel-tools-mcp with Claude Desktop and other MCP clients.

**Version:** 0.3.0
**Last Updated:** 2025-12-16

## Current State

### What Works
- HTTP server mode (`--http --port 8787`) - fully functional
- All 17 MCP tools exposed via HTTP endpoints
- Mother integration via HTTP (see MOTHER-INTEGRATION.md)
- stdio MCP mode for direct MCP client connections

### What's Broken / Known Issues
- **Claude Desktop PATH issues**: Claude Desktop runs in a sandboxed environment that doesn't inherit shell PATH. The `decibel` CLI must be accessible via absolute path or installed globally.
- **CLI dependency**: All tools shell out to `decibel` CLI - if CLI isn't found, tools fail silently or with cryptic errors.

## Claude Desktop Configuration

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "decibel-tools": {
      "command": "node",
      "args": ["/absolute/path/to/decibel-tools-mcp/dist/server.js"],
      "env": {
        "PATH": "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin",
        "DECIBEL_HOME": "/path/to/.decibel"
      }
    }
  }
}
```

**Critical**:
- Use absolute paths for everything
- Include PATH with locations where `decibel` CLI is installed
- Set DECIBEL_HOME if using non-default location

## Testing Checklist

After building the CLI, verify MCP integration:

### 1. Basic Connectivity
```bash
# Start HTTP server
node dist/server.js --http --port 8787

# Health check
curl http://localhost:8787/health
# Expected: {"status":"ok","version":"0.3.0","api_version":"v1"}

# List tools
curl http://localhost:8787/tools | jq '.[] | .name'
```

### 2. Dojo Tools
```bash
# List wishes (should work even if empty)
curl -X POST http://localhost:8787/dojo/wishes \
  -H "Content-Type: application/json" \
  -d '{"project_id": "senken"}'

# Add a test wish
curl -X POST http://localhost:8787/dojo/wish \
  -H "Content-Type: application/json" \
  -d '{
    "project_id": "senken",
    "capability": "Test capability",
    "reason": "Testing MCP integration",
    "inputs": ["test"],
    "outputs": {"result": "test"}
  }'
```

### 3. Context Pack Tools
```bash
# Pin a fact
curl -X POST http://localhost:8787/context/pin \
  -H "Content-Type: application/json" \
  -d '{
    "project_id": "senken",
    "title": "Test fact",
    "body": "Testing context pack",
    "trust": "low"
  }'

# List facts
curl -X POST http://localhost:8787/context/list \
  -H "Content-Type: application/json" \
  -d '{"project_id": "senken"}'

# Append event
curl -X POST http://localhost:8787/event/append \
  -H "Content-Type: application/json" \
  -d '{
    "project_id": "senken",
    "title": "MCP test event",
    "tags": ["test", "integration"]
  }'

# Search events
curl -X POST http://localhost:8787/event/search \
  -H "Content-Type: application/json" \
  -d '{"project_id": "senken", "query": "test"}'
```

### 4. Claude Desktop Integration
1. Update `claude_desktop_config.json` with absolute paths
2. Restart Claude Desktop completely (quit and reopen)
3. In Claude Desktop, check MCP server status (gear icon → MCP)
4. Test with: "Use the decibel tools to list wishes for senken"

## Common Issues

### "decibel: command not found"
The CLI isn't in PATH. Solutions:
1. Add CLI location to PATH in claude_desktop_config.json
2. Install CLI globally: `npm install -g decibel-cli` (when available)
3. Use symlink: `ln -s /path/to/decibel /usr/local/bin/decibel`

### "Project not found"
The project_id doesn't match a registered project. Check:
```bash
decibel project list
```

### Tools return empty results
The CLI commands may be failing silently. Check server logs:
```bash
DEBUG=true node dist/server.js --http --port 8787
```

### Claude Desktop doesn't see the server
1. Verify JSON syntax in config file
2. Check absolute paths are correct
3. Restart Claude Desktop (full quit, not just close window)
4. Check Console.app for MCP-related errors

## Future: decibel dojo Subcommands

When the CLI matures, consider adding direct subcommands:

```bash
# Instead of MCP server, direct CLI access
decibel dojo wish add --capability "..." --reason "..."
decibel dojo propose --title "..." --problem "..."
decibel dojo run DOJO-EXP-0001
decibel dojo results DOJO-EXP-0001 --run-id 20251216-070615
```

This would allow:
- Shell scripting without HTTP server
- CI/CD integration
- Direct human access without MCP

The MCP server would remain for AI agent access with rate limiting and policy enforcement.

## Architecture Notes

### Current: Shell to CLI
```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────┐
│  Claude Desktop │────▶│  MCP Server      │────▶│ decibel CLI │
│  (MCP Client)   │     │  (stdio or HTTP) │     │  (spawn)    │
└─────────────────┘     └──────────────────┘     └─────────────┘
                                │
┌─────────────────┐             │
│  Mother AI      │─────────────┘
│  (HTTP Client)  │     (HTTP mode only)
└─────────────────┘
```

### Preferred: Direct Import (when @decibel/cli published)
```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Claude Desktop │────▶│  MCP Server      │────▶│ @decibel/cli    │
│  Mother AI      │     │  (imports lib)   │     │ (lib/compiler)  │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

```typescript
// MCP tool can call CLI lib directly - no spawn needed
import { compileContextPack } from '@decibel/cli/lib/compiler';

const pack = compileContextPack('/path/to/project');
```

**Benefits of direct import:**
- Eliminates PATH issues entirely
- Faster - no spawn/exec overhead
- Better errors - native JS errors instead of parsing stderr
- Works in sandboxed environments (Claude Desktop)

- **stdio mode**: Direct MCP protocol, used by Claude Desktop
- **HTTP mode**: REST endpoints, used by Mother and other HTTP clients
- Both modes use the same tool implementations, just different transports
