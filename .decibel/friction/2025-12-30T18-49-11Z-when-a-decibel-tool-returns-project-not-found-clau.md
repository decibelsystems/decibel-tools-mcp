---
context: decibel-tools-mcp
frequency: occasional
impact: high
status: open
source: agent
signal_count: 1
created_at: 2025-12-30T18:49:11.387Z
last_reported: 2025-12-30T18:49:11.387Z
tags: [onboarding, project-init, llm-workaround, provenance]
---

# When a decibel tool returns PROJECT_NOT_FOUND, Claude's instinct is to work around it by pushing raw files directly to GitHub that mimic the tool output structure. This defeats provenance tracking, schema consistency, and the whole point of the decibel system. Root cause: no graceful path from "project doesn't exist" to "project ready" - the right path has friction while the wrong path (raw file writes) is easy.

When a decibel tool returns PROJECT_NOT_FOUND, Claude's instinct is to work around it by pushing raw files directly to GitHub that mimic the tool output structure. This defeats provenance tracking, schema consistency, and the whole point of the decibel system. Root cause: no graceful path from "project doesn't exist" to "project ready" - the right path has friction while the wrong path (raw file writes) is easy.

## Context

**Where:** decibel-tools-mcp
**Frequency:** occasional
**Impact:** high
**Reported by:** agent

## Current Workaround

Manually create .decibel folder, then registry_add, then use tools - but this is multiple steps and easy to skip

## Signal Log

- 2025-12-30T18:49:11.387Z [agent] Initial report
