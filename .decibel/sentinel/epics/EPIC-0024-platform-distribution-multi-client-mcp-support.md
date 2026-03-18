---
id: EPIC-0024
projectId: decibel-tools-mcp
title: Platform Distribution: Multi-Client MCP Support
summary: Enable Decibel Tools across major AI platforms: Cursor, Replit, ChatGPT, Vercel v0, and Lovable. Phased rollout starting with local stdio platforms, then remote MCP infrastructure.
status: planned
priority: high
tags: [distribution, mcp, platforms, codex, cursor, replit, chatgpt, vercel, lovable]
owner: 
squad: 
created_at: 2026-01-03T19:34:09.881Z
---

# Platform Distribution: Multi-Client MCP Support

## Summary

Enable Decibel Tools across major AI platforms: Codex, Cursor, Replit, ChatGPT, Vercel v0, and Lovable. Phased rollout starting with Codex (already compatible), then local stdio platforms, then remote MCP infrastructure.

## Motivation

- Current distribution limited to Claude Desktop and Claude Code
- Codex supports both stdio and Streamable HTTP — our existing transports are already compatible
- Cursor has largest developer mindshare for AI-assisted coding
- Remote MCP unlocks ChatGPT, v0, and Lovable simultaneously
- Single integration effort enables multiple platform reach

## Outcomes

- Codex users can connect via stdio (npx) or daemon (Streamable HTTP)
- One-click setup for Cursor users
- Replit template with pre-wired MCP
- Hosted MCP endpoint on Vercel
- ChatGPT custom connector available
- Lovable integration for Business/Enterprise users

## Rollout Order

1. **Codex** (Phase 1 — current transports work, just needs docs + testing)
2. **Cursor** (Phase 2 — stdio, needs .cursor/mcp.json generation)
3. **ChatGPT** (Phase 3 — Streamable HTTP, needs hosted endpoint)
4. **Replit / Vercel v0 / Lovable** (Phase 4 — remote MCP)

## Acceptance Criteria

### Phase 1: Codex
- [ ] Sample TOML config documented for stdio mode
- [ ] Sample TOML config documented for daemon/HTTP mode
- [ ] Timeout recommendations documented (tool_timeout_sec = 120)
- [ ] End-to-end tested: Codex → stdio → all facades
- [ ] End-to-end tested: Codex → Streamable HTTP → daemon
- [ ] MCP resources listing added (workaround for Codex UI bug)
- [ ] Published to docs or README

### Phase 2: Cursor
- [ ] Add to Cursor button works from README
- [ ] project_init --cursor generates .cursor/mcp.json

### Phase 3: ChatGPT
- [ ] ChatGPT Developer Mode can connect
- [ ] Remote MCP deployed to Vercel with Streamable HTTP

### Phase 4: Others
- [ ] Replit template published and functional
- [ ] Lovable custom connector tested on Business plan

## Related Issues

- ISS-0049: Codex compatibility — sample config and setup docs
- ISS-0050: Codex end-to-end testing — stdio and HTTP transports
- ISS-0051: MCP resources listing for Codex UI compatibility
