---
uid: 019b855b-5a30-7baa-9608-85c74ca3fa98
id: ISS-0038
projectId: decibel-tools-mcp
status: open
priority: medium
epic_id: EPIC-0024
tags:
  - vercel
  - v0
  - remote-mcp
created_at: 2026-01-03T19:35:15.248Z
updated_at: 2026-01-03T19:35:15.248Z
---
# Enable Vercel v0 integration

**Status:** open
**Epic:** EPIC-0024

## Details

Enable Decibel Tools integration with Vercel v0.

Prerequisites:
- Remote MCP deployed to Vercel (ISS-0035)

v0 has native MCP support via AI SDK. Once Remote MCP is deployed on Vercel, v0 should be able to connect directly.

Test:
- v0 can read project context from Decibel
- Design decisions inform generated components
- Architecture context guides code generation

Documentation:
- Setup guide for v0 users
- Example prompts for context-aware generation
