# MCP Integration Directive

Guide for integrating and testing decibel-tools-mcp with Claude Desktop and other MCP clients.

**Version:** 0.3.0
**Last Updated:** 2025-12-21

## Current State

### What Works
- HTTP server mode (`--http --port 8787`) - fully functional
- All 17 MCP tools exposed via HTTP endpoints
- Mother integration via HTTP (see MOTHER-INTEGRATION.md)
- stdio MCP mode for direct MCP client connections
- Native file operations for most tools (friction, sentinel, architect, etc.)

### What's Broken / Known Issues
- **dojo.ts CLI dependency**: The Dojo tools incorrectly shell out to a `decibel` CLI that doesn't exist. This is being converted to native file operations.

## Claude Desktop Configuration

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "decibel-tools": {
      "command": "node",
      "args": ["/absolute/path/to/decibel-tools-mcp/dist/server.js"],
      "env": {
        "DECIBEL_HOME": "/path/to/.decibel"
      }
    }
  }
}
```

**Critical**:
- Use absolute paths for everything
- Set DECIBEL_HOME if using non-default location

## Testing Checklist

Verify MCP integration:

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

### 2. Working Tools (Native)
```bash
# Log friction (works - native implementation)
curl -X POST http://localhost:8787/friction/log \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "decibel-tools-mcp",
    "context": "testing",
    "description": "Test friction"
  }'

# Create issue (works - native implementation)
curl -X POST http://localhost:8787/sentinel/issue \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "decibel-tools-mcp",
    "title": "Test issue",
    "description": "Testing"
  }'
```

### 3. Dojo Tools (Currently Broken)
```bash
# These will fail with "spawn decibel ENOENT" until converted
curl -X POST http://localhost:8787/dojo/wishes \
  -H "Content-Type: application/json" \
  -d '{"project_id": "senken"}'
```

### 4. Claude Desktop Integration
1. Update `claude_desktop_config.json` with absolute paths
2. Restart Claude Desktop completely (quit and reopen)
3. In Claude Desktop, check MCP server status (gear icon → MCP)
4. Test with: "Use the decibel tools to log some friction"

## Common Issues

### "spawn decibel ENOENT"
The Dojo tools are trying to shell out to a CLI that doesn't exist. This is a known bug being fixed. Other tools (friction, sentinel, architect) work correctly.

### "Project not found"
The project_id doesn't match a registered project. Use `registry_list` tool to see available projects.

### Claude Desktop doesn't see the server
1. Verify JSON syntax in config file
2. Check absolute paths are correct
3. Restart Claude Desktop (full quit, not just close window)
4. Check Console.app for MCP-related errors

## Architecture Notes

### CORRECT: Native File Operations

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Claude Desktop │────▶│  MCP Server      │────▶│ .decibel/       │
│  (MCP Client)   │     │  (native fs ops) │     │ (YAML files)    │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

The MCP server reads/writes directly to `.decibel/` folders using Node.js `fs` module.
No external CLI dependencies. See `docs/TOOLS_ARCHITECTURE.md`.

### WRONG: Shell to CLI (legacy bug in dojo.ts)

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────┐
│  Claude Desktop │────▶│  MCP Server      │────▶│ decibel CLI │  ← DOESN'T EXIST
│  (MCP Client)   │     │  (spawn)         │     │  (broken)   │
└─────────────────┘     └──────────────────┘     └─────────────┘
```

The `dojo.ts` file incorrectly shells out to a `decibel` CLI. This is being converted
to native file operations to match other tools (friction.ts, sentinel.ts, etc.).

### Project-Specific Extensions

Project-specific CLIs (like senken's "mother") can build ON TOP of decibel-tools-mcp:

```
┌─────────────────┐
│  mother CLI     │  ← senken-specific, CAN have its own dojo commands
│  (senken only)  │
└────────┬────────┘
         │ imports/extends
         ▼
┌─────────────────┐
│ decibel-tools   │  ← foundation layer, must be self-contained
│ (MCP server)    │
└─────────────────┘
```

- **stdio mode**: Direct MCP protocol, used by Claude Desktop
- **HTTP mode**: REST endpoints, used by Mother and other HTTP clients
- Both modes use the same tool implementations, just different transports
