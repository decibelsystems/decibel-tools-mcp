# Cursor Integration

Decibel Tools integrates with [Cursor](https://cursor.com) via the Model Context Protocol (MCP).

## Quick Start

### One-Click Install

Click this button to install Decibel Tools in Cursor:

<a href="cursor://anysphere.cursor-deeplink/mcp/install?name=decibel-tools&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsImRlY2liZWwtdG9vbHMtbWNwIl19">
  <img src="https://cursor.com/deeplink/mcp-install-dark.svg" alt="Add Decibel Tools to Cursor" height="32" />
</a>

Or paste this deep link in your browser:
```
cursor://anysphere.cursor-deeplink/mcp/install?name=decibel-tools&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsImRlY2liZWwtdG9vbHMtbWNwIl19
```

### Manual Setup

#### Global Installation

Add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "decibel-tools": {
      "command": "npx",
      "args": ["-y", "decibel-tools-mcp"]
    }
  }
}
```

#### Project-Local Installation

For project-specific configuration, add to `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "decibel-tools": {
      "command": "npx",
      "args": ["-y", "decibel-tools-mcp"]
    }
  }
}
```

Or use `project_init` with the `--cursor` flag:

```bash
# Via MCP tool call
project_init path="/path/to/your/project" cursor=true
```

This creates `.cursor/mcp.json` automatically.

## Verifying Connection

1. Open Cursor
2. Look for the MCP indicator in the status bar (bottom right)
3. A **green dot** indicates successful connection
4. Click the indicator to see connected servers

If you see "decibel-tools" listed with a green status, you're connected.

## Using in Agent Mode

Decibel Tools works best in Cursor's Agent mode (Cmd+I or Ctrl+I):

1. Open Agent mode
2. Ask the agent to use Decibel tools:
   - "Create an epic for user authentication"
   - "Log an issue about the login bug"
   - "What should I work on next?"

The agent will automatically call the appropriate MCP tools.

### Available Tools

| Tool | Description |
|------|-------------|
| `sentinel_log_epic` | Create a new epic |
| `sentinel_createIssue` | Create an issue |
| `sentinel_listIssues` | List project issues |
| `architect_createAdr` | Record architecture decision |
| `designer_record_design_decision` | Record design decision |
| `dojo_add_wish` | Add a capability wish |
| `dojo_create_proposal` | Create a proposal |
| `oracle_next_actions` | Get recommended next actions |
| `friction_log` | Log a pain point |
| `learnings_append` | Add a learning |

## Troubleshooting

### Server Not Connecting

**Symptoms:** No MCP indicator, or red/yellow status

**Solutions:**
1. Restart Cursor completely (Cmd+Q, then reopen)
2. Check your `mcp.json` syntax is valid JSON
3. Verify npx is available: `which npx`
4. Check Cursor logs: Help → Toggle Developer Tools → Console

### Tools Not Appearing

**Symptoms:** Connected but no tools listed

**Solutions:**
1. Ensure you have a `.decibel/` folder in your project or a registered project
2. Run `project_init` to initialize a project
3. Check the MCP panel in Cursor settings

### Permission Errors

**Symptoms:** "EACCES" or permission denied errors

**Solutions:**
1. Check npm global permissions: `npm config get prefix`
2. Fix npm permissions: https://docs.npmjs.com/resolving-eacces-permissions-errors

### Slow Startup

**Symptoms:** Long delay before tools become available

**Solutions:**
1. First run downloads the package - subsequent runs are faster
2. Consider local installation instead of npx:
   ```bash
   npm install -g decibel-tools-mcp
   ```
   Then update mcp.json:
   ```json
   {
     "mcpServers": {
       "decibel-tools": {
         "command": "decibel-tools-mcp"
       }
     }
   }
   ```

## Environment Variables

You can configure the server via environment variables in `mcp.json`:

```json
{
  "mcpServers": {
    "decibel-tools": {
      "command": "npx",
      "args": ["-y", "decibel-tools-mcp"],
      "env": {
        "DECIBEL_ENV": "prod",
        "DECIBEL_MCP_ROOT": "/custom/path"
      }
    }
  }
}
```

| Variable | Default | Description |
|----------|---------|-------------|
| `DECIBEL_ENV` | `dev` | Environment (dev, staging, prod) |
| `DECIBEL_MCP_ROOT` | `~/.decibel` | Global data storage root |

## Support

- [GitHub Issues](https://github.com/anthropics/decibel-tools-mcp/issues)
- [MCP Documentation](https://modelcontextprotocol.io)
- [Cursor MCP Docs](https://docs.cursor.com/context/model-context-protocol)
