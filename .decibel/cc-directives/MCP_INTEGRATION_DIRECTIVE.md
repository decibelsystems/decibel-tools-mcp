# Directive: MCP Server Updates for Claude Desktop

**Related to:** EPIC-0011 - Decibel CLI + MCP Tool Alignment  
**Owner:** MCP Thread (if separate from Tools thread)  
**Priority:** Medium (after CLI is built)  

---

## Context

Once the `decibel` CLI exists (ISS-0011), we need to ensure the MCP server properly handles both scenarios:

1. CLI is installed → shell out to CLI
2. CLI not installed → read/write YAML directly

This directive covers any MCP-specific work beyond the YAML fallback in ISS-0012.

---

## Scope

### In Scope
- Verifying MCP tools work in Claude Desktop config
- Testing tool discovery and invocation
- Ensuring error messages are helpful when things fail

### Out of Scope (handled by Tools thread)
- Building the CLI itself
- Implementing YAML fallback logic

---

## Current State

The MCP server is configured in Claude Desktop at:
```
~/Library/Application Support/Claude/claude_desktop_config.json
```

Entry:
```json
"decibel-tools": {
  "command": "node",
  "args": ["/Volumes/Ashitaka/Documents/GitHub/decibel-tools-mcp/dist/server.js"]
}
```

**Working tools:**
- `registry_list` ✅
- `sentinel_listIssues` ✅
- `sentinel_list_epics` ✅
- `learnings_list` ✅

**Broken tools (need CLI or fallback):**
- `decibel_context_list` ❌ (ENOENT)
- `decibel_context_pin` ❌ (ENOENT)
- `decibel_context_refresh` ❌ (ENOENT)
- `dojo_list` ❌ (ENOENT)
- `dojo_*` tools ❌ (ENOENT)

---

## Tasks

### 1. Verify Claude Desktop Config After CLI Install

Once CLI is built and linked (`npm link`), verify:

```bash
# Should work from any directory
which decibel
decibel context list
```

Then restart Claude Desktop and test:
- `decibel_context_list` should work via CLI

### 2. Test YAML Fallback

Temporarily unlink CLI:
```bash
npm unlink -g decibel-tools-mcp
```

Test that MCP tools still work via YAML fallback.

### 3. Dojo Tools Review

The `dojo_*` tools also shell out to `decibel`. Review whether they need:
- Same CLI subcommands (`decibel dojo list`, etc.)
- YAML fallback
- Or different approach

Current dojo tools that shell out:
- `dojo_list`
- `dojo_create_proposal`
- `dojo_scaffold_experiment`
- `dojo_run_experiment`
- `dojo_get_results`
- `dojo_add_wish`
- `dojo_list_wishes`
- `dojo_can_graduate`
- `dojo_read_artifact`

**Recommendation:** Add `decibel dojo` subcommands to CLI in a follow-up issue.

---

## Testing Checklist

After Tools thread completes ISS-0011 and ISS-0012:

- [ ] `decibel context list` works in terminal
- [ ] Restart Claude Desktop
- [ ] `decibel_context_list` via MCP returns facts
- [ ] `decibel_context_pin` via MCP creates fact
- [ ] Unlink CLI, restart Claude Desktop
- [ ] `decibel_context_list` via MCP still works (YAML fallback)
- [ ] Logs show "using YAML fallback" message

---

## Notes

- MCP server runs as a child process of Claude Desktop
- PATH might differ from terminal - may need full path to `decibel` binary
- If PATH issues, can hardcode path or use YAML-only approach

---

## Handoff

This directive is for awareness. Primary work is in Tools thread directive.

Once ISS-0011 (CLI) and ISS-0012 (fallback) are complete, MCP thread should:
1. Test the integration
2. File any follow-up issues if problems found
3. Consider adding `decibel dojo` subcommands
