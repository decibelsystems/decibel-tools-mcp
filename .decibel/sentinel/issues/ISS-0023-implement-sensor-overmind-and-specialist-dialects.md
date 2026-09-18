---
uid: 019b47a6-efcb-7e82-aae0-01d566fa404c
id: ISS-0023
projectId: decibel-tools-mcp
status: open
priority: high
epic_id: EPIC-0020
tags:
  - agentic
  - dialect
  - sensor
  - overmind
  - specialist
created_at: 2025-12-22T20:01:21.355Z
updated_at: 2025-12-22T20:01:21.355Z
---
# Implement Sensor, Overmind, and Specialist dialects

**Status:** open
**Epic:** EPIC-0020

## Details

Implement src/agentic/dialects/sensor.ts, overmind.ts, and specialist.ts. Each extends BaseDialect with role-specific rendering and lint rules. Sensor: terse KEY=VALUE, NEXT always present, max 1 emoji. Overmind: DECISION/GUARDRAILS/DISSENT required, no hype under YELLOW/RED. Specialist: NO EMOJI ever, begins with verdict, OPPOSE requires kill_switch. See AGENTIC_PACK_V1_DIRECTIVE.md sections 1.5-1.7.
