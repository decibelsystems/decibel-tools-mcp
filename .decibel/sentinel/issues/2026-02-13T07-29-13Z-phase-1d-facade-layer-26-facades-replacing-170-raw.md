---
uid: 019c55e7-61d0-7e63-8e5f-319a682f2885
id: ISS-0081
projectId: decibel-tools-mcp
severity: high
status: closed
epic_id: EPIC-0026
created_at: 2026-02-13T07:29:13.168Z
closed_at: 2026-05-20T00:53:15.000Z
closed_reason: verified done by code inspection 2026-05-19
closure_note: src/facades/ with definitions/index/types; 33 facades exposed via MCP
---

# Phase 1d: Facade layer — 26 facades replacing 170 raw tools

**Severity:** high
**Status:** closed
**Epic:** EPIC-0026

## Details

Created src/facades/ with FacadeSpec, three-tier gating (core/pro/apps), and buildMcpDefinitions. 26 public facades dispatch to 170 internal handlers. Commit eee672d.
