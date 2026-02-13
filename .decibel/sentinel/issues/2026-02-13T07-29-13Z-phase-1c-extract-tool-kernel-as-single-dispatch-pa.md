---
projectId: decibel-tools-mcp
severity: high
status: open
created_at: 2026-02-13T07:29:13.167Z
epic_id: EPIC-0026
---

# Phase 1c: Extract tool kernel as single dispatch path

**Severity:** high
**Status:** open
**Epic:** EPIC-0026

## Details

Created src/kernel.ts with DispatchContext, unified dispatch for both transports. Single source of truth for tool registry and facade registry. Commit f5ce175.
