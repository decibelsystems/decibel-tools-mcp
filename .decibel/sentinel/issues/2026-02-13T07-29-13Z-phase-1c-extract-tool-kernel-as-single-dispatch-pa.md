---
uid: 019c55e7-61cf-78d8-af76-77b608840fb0
id: ISS-0080
projectId: decibel-tools-mcp
severity: high
status: closed
epic_id: EPIC-0026
created_at: 2026-02-13T07:29:13.167Z
closed_at: 2026-05-20T00:53:15.000Z
closed_reason: verified done by code inspection 2026-05-19
closure_note: src/kernel.ts (425 LOC) provides ToolKernel interface + createKernel()
---

# Phase 1c: Extract tool kernel as single dispatch path

**Severity:** high
**Status:** closed
**Epic:** EPIC-0026

## Details

Created src/kernel.ts with DispatchContext, unified dispatch for both transports. Single source of truth for tool registry and facade registry. Commit f5ce175.
