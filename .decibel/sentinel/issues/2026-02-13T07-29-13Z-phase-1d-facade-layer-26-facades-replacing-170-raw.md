---
projectId: decibel-tools-mcp
severity: high
status: open
created_at: 2026-02-13T07:29:13.168Z
epic_id: EPIC-0026
---

# Phase 1d: Facade layer — 26 facades replacing 170 raw tools

**Severity:** high
**Status:** open
**Epic:** EPIC-0026

## Details

Created src/facades/ with FacadeSpec, three-tier gating (core/pro/apps), and buildMcpDefinitions. 26 public facades dispatch to 170 internal handlers. Commit eee672d.
