---
id: EPIC-0022
title: "Decibel Cloud Persistence Layer"
status: planned
priority: high
created: 2025-12-25
tags:
  - architecture
  - multi-agent
  - chatgpt
  - storage
  - pre-adr
---

# EPIC-0022: Decibel Cloud Persistence Layer

## Summary

Enable remote MCP access (ChatGPT, multi-agent workflows) by moving from local `.decibel` YAML files to a shared storage backend.

**Status: Pre-ADR** - Requires discovery, user research, and architectural planning before decisions are made.

## Motivation

- Remote MCP server (on Render) cannot access local `.decibel` project data
- ChatGPT integration is blocked - MCP protocol works but tools fail on data access
- Multi-agent workflows require shared state across locations
- Current file-based approach limits Decibel to single-machine use
- Power outage + OpenAI changes exposed this architectural gap

## Desired Outcomes

- MCP tools work from any location (local dev, Render, ChatGPT connector)
- Local-first mode preserved for offline work and git-tracked project history
- Clear migration path for existing `.decibel` data
- No breaking changes for current users without explicit opt-in

## Acceptance Criteria

- [ ] User workflow analysis completed (how do people use .decibel today?)
- [ ] Storage options evaluated (PostgreSQL, SQLite, S3, hybrid)
- [ ] ADR documenting storage decision and rationale
- [ ] Prototype demonstrating remote tool execution with shared data
- [ ] Migration strategy defined (can users keep file-based if preferred?)
- [ ] Sync strategy if supporting both local files and remote DB

## Open Questions

1. Do users want their Decibel data in git (current) or external DB?
2. Should local mode use SQLite for consistency with remote PostgreSQL?
3. How to handle conflicts if same project edited locally and remotely?
4. What's the auth model for remote access to project data?
5. Does this change Decibel from "project tool" to "service"?

## Related

- WISH-0003 (deprecated - promoted to this epic)
- ADR-0006: ChatGPT MCP Root Path Routing
- Senken Render deployment with decibel-mcp bundled
