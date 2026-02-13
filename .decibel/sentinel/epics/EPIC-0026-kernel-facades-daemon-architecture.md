---
id: EPIC-0026
projectId: decibel-tools-mcp
title: Kernel Facades & Daemon Architecture
summary: Complete architectural overhaul of decibel-tools-mcp: unified tool kernel, 26 facades replacing 170 raw tools, three-tier gating (core/pro/apps), transport abstraction (stdio + HTTP), daemon mode with launchd, agent scaffolding, bridge mode, and package rename to @decibel/tools v2.0.0. Nine commits across Phases 1-6a on feature/kernel-facades.
status: planned
priority: critical
tags: [architecture, kernel, facades, daemon, v2]
owner: 
squad: 
created_at: 2026-02-13T07:28:02.234Z
---

# Kernel Facades & Daemon Architecture

## Summary

Complete architectural overhaul of decibel-tools-mcp: unified tool kernel, 26 facades replacing 170 raw tools, three-tier gating (core/pro/apps), transport abstraction (stdio + HTTP), daemon mode with launchd, agent scaffolding, bridge mode, and package rename to @decibel/tools v2.0.0. Nine commits across Phases 1-6a on feature/kernel-facades.

## Motivation

- 170 raw MCP tools overwhelmed AI clients
- No unified dispatch — tools registered ad-hoc per transport
- No daemon mode — server restarted per session
- No agent-to-agent coordination primitives

## Outcomes

- 26 facades with three-tier gating replace 170 raw tools
- Single kernel dispatch path for all transports
- Daemon mode with PID management and launchd
- Agent scaffolding: messaging, delegation, batch, hooks
- Bridge mode: stdio proxy to running daemon
- Package renamed to @decibel/tools v2.0.0
