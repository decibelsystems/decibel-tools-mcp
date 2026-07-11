---
context: onboarding / mcp client setup
frequency: occasional
impact: high
status: open
source: human
signal_count: 1
created_at: 2026-07-11T15:35:53.471Z
last_reported: 2026-07-11T15:35:53.471Z
tags: []
---

# Want a one-click setup app for Cursor and Claude Code (and Claude Desktop) that writes all the needed config files automatically. Today each client requires hand-editing MCP config in a different location — Cursor at ~/.cursor/mcp.json or per-project .cursor/mcp.json, Claude Code at .mcp.json / ~/.claude/settings.json, Claude Desktop at ~/Library/Application Support/Claude/claude_desktop_config.json — plus optionally ~/.decibel/config.yaml for a license key. A new user has to know which file per client and paste JSON by hand. Envisioned: a single installer/app that detects installed clients and writes the correct MCP server entry (and license config where needed) in one step. Related to the license/config onboarding friction logged earlier.

Want a one-click setup app for Cursor and Claude Code (and Claude Desktop) that writes all the needed config files automatically. Today each client requires hand-editing MCP config in a different location — Cursor at ~/.cursor/mcp.json or per-project .cursor/mcp.json, Claude Code at .mcp.json / ~/.claude/settings.json, Claude Desktop at ~/Library/Application Support/Claude/claude_desktop_config.json — plus optionally ~/.decibel/config.yaml for a license key. A new user has to know which file per client and paste JSON by hand. Envisioned: a single installer/app that detects installed clients and writes the correct MCP server entry (and license config where needed) in one step. Related to the license/config onboarding friction logged earlier.

## Context

**Where:** onboarding / mcp client setup
**Frequency:** occasional
**Impact:** high
**Reported by:** human

## Current Workaround

Manually create/edit each client's MCP config file (different path per client) and paste the decibel-tools server block by hand.

## Signal Log

- 2026-07-11T15:35:53.471Z [human] Initial report
