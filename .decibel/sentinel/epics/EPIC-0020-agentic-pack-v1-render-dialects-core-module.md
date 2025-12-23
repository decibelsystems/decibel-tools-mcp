---
id: EPIC-0020
projectId: decibel-tools-mcp
title: Agentic Pack v1 — Render Dialects Core Module
summary: Implement portable Render Module system that transforms canonical agent payloads into human-parseable outputs via deterministic dialects. Core abstraction: Payload is truth, Renderer is voice.
status: planned
priority: high
tags: [agentic, render, dialect, mother, avatars, portable]
owner: ben
squad: claude-code
created_at: 2025-12-22T20:00:27.157Z
---

# Agentic Pack v1 — Render Dialects Core Module

## Summary

Implement portable Render Module system that transforms canonical agent payloads into human-parseable outputs via deterministic dialects. Core abstraction: Payload is truth, Renderer is voice.

## Motivation

- Mother voice can become 'hype', reducing clarity
- Role ambiguity between detection/synthesis/decision outputs
- Need portable pattern for Studio Max and future projects
- Separating payload from renderer prevents prompt changes from corrupting semantics

## Outcomes

- Clarity of purpose: role recognition in <5 seconds
- Banks-inspired 'felt intelligence' via rendering, not logic changes
- Deterministic renderers create stable UX conventions
- Debuggable: can replay payloads through different dialects
- Portable: same skeleton works for Studio Max

## Acceptance Criteria

- [ ] Core agentic module builds in decibel-tools-mcp
- [ ] AgentPayload Zod schema validates all role requirements
- [ ] Sensor/Overmind/Specialist dialects render correctly
- [ ] Lint catches violations (no-emoji for Specialist, required sections for Overmind)
- [ ] Golden eval passes for weekend_trap payload across dialects
- [ ] MCP tool agentic_render is callable
- [ ] ANSI output is terminal-readable, non-ANSI is clean markdown
