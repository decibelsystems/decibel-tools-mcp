---
uid: 019b0592-fd7f-7446-be5d-f6919e01f3eb
id: ISS-0002
projectId: decibel-tools-mcp
status: closed
priority: high
epic_id: EPIC-0008
tags:
  - plugin
  - claude-code
  - phase-2
created_at: 2025-12-10T00:04:37.887Z
updated_at: 2026-08-29T16:18:24.749Z
closed_at: 2026-08-29T16:18:24.749Z
resolution: "Completed in commit eeb9774: feat: add Claude Code plugin structure + Figma designer tools"
---
# Create Claude Code plugin package

**Status:** closed
**Epic:** EPIC-0008

## Details

Create a Claude Code plugin structure for Decibel that can be installed via `/plugin` command.

Structure:
```
.claude-plugin/
├── plugin.json          # Plugin metadata
├── commands/            # Slash commands (optional convenience wrappers)
├── mcp/
│   └── decibel.json     # MCP server config pointing to Python CLI
```

Requirements:
- Plugin installable from local path during development
- All Decibel MCP tools accessible
- Test with design partners before marketplace submission
- Document installation and usage

This is the "harden for own use" phase before public distribution.

## Resolution

Completed in commit eeb9774: feat: add Claude Code plugin structure + Figma designer tools
