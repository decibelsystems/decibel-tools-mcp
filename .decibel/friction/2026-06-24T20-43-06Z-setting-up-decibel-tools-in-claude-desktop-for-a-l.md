---
context: onboarding / Claude Desktop setup
frequency: occasional
impact: medium
status: open
source: human
signal_count: 1
created_at: 2026-06-24T20:43:06.043Z
last_reported: 2026-06-24T20:43:06.043Z
tags: []
---

# Setting up Decibel tools in Claude Desktop for a less-technical team member is far harder than it should be. A non-technical person cannot self-navigate the chain of gotchas: (1) Claude Desktop launches with a stripped PATH so a bare `npx` command in claude_desktop_config.json fails — needs a `/bin/zsh -lc` login-shell wrapper to find node; (2) hosted connectors (GitHub, Gmail) vs local MCP servers (decibel-tools) behave totally differently — hosted are account/plan-gated and enabled per-surface (web vs desktop are separate) and per-conversation, while local servers live in the JSON config; (3) people expect an npm-published server to auto-appear in the connector list or search, but local MCP servers must be added manually and never show in search; (4) the new Connectors UI ('Customize') splits 'Desktop' (local) vs 'Not connected' (hosted catalog) groups, which is confusing. The right path (edit JSON, login-shell wrapper) has high friction; the wrong assumptions (search for it, it should just sync) are the natural ones. Source: live-guided angela's-macbook-pro setup, 2026-06-24.

Setting up Decibel tools in Claude Desktop for a less-technical team member is far harder than it should be. A non-technical person cannot self-navigate the chain of gotchas: (1) Claude Desktop launches with a stripped PATH so a bare `npx` command in claude_desktop_config.json fails — needs a `/bin/zsh -lc` login-shell wrapper to find node; (2) hosted connectors (GitHub, Gmail) vs local MCP servers (decibel-tools) behave totally differently — hosted are account/plan-gated and enabled per-surface (web vs desktop are separate) and per-conversation, while local servers live in the JSON config; (3) people expect an npm-published server to auto-appear in the connector list or search, but local MCP servers must be added manually and never show in search; (4) the new Connectors UI ('Customize') splits 'Desktop' (local) vs 'Not connected' (hosted catalog) groups, which is confusing. The right path (edit JSON, login-shell wrapper) has high friction; the wrong assumptions (search for it, it should just sync) are the natural ones. Source: live-guided angela's-macbook-pro setup, 2026-06-24.

## Context

**Where:** onboarding / Claude Desktop setup
**Frequency:** occasional
**Impact:** medium
**Reported by:** human

## Current Workaround

Live-guided setup by a technical person: edit ~/Library/Application Support/Claude/claude_desktop_config.json directly, add mcpServers with a `/bin/zsh -lc "npx -y @decibelsystems/tools"` wrapper to beat PATH stripping, then quit+reopen. A copy-paste one-pager or installer script would remove the need for live guidance.

## Signal Log

- 2026-06-24T20:43:06.043Z [human] Initial report
