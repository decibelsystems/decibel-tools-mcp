---
id: EPIC-0024
projectId: decibel-tools-mcp
title: Platform Distribution: Multi-Client MCP Support
summary: Enable Decibel Tools across major AI platforms: Cursor, Replit, ChatGPT, Vercel v0, and Lovable. Phased rollout starting with local stdio platforms, then remote MCP infrastructure.
status: planned
priority: high
tags: [distribution, mcp, platforms, cursor, replit, chatgpt, vercel, lovable]
owner: 
squad: 
created_at: 2026-01-03T19:34:09.881Z
---

# Platform Distribution: Multi-Client MCP Support

## Summary

Enable Decibel Tools across major AI platforms: Cursor, Replit, ChatGPT, Vercel v0, and Lovable. Phased rollout starting with local stdio platforms, then remote MCP infrastructure.

## Motivation

- Current distribution limited to Claude Desktop and Claude Code
- Cursor has largest developer mindshare for AI-assisted coding
- Remote MCP unlocks ChatGPT, v0, and Lovable simultaneously
- Single integration effort enables multiple platform reach

## Outcomes

- One-click setup for Cursor users
- Replit template with pre-wired MCP
- Hosted MCP endpoint on Vercel
- ChatGPT custom connector available
- Lovable integration for Business/Enterprise users

## Acceptance Criteria

- [ ] Add to Cursor button works from README
- [ ] project_init --cursor generates .cursor/mcp.json
- [ ] Replit template published and functional
- [ ] Remote MCP deployed to Vercel with Streamable HTTP
- [ ] ChatGPT Developer Mode can connect
- [ ] Lovable custom connector tested on Business plan
