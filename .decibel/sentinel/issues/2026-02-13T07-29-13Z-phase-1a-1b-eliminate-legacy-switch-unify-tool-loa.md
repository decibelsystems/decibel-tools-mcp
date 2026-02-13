---
projectId: decibel-tools-mcp
severity: high
status: open
created_at: 2026-02-13T07:29:13.168Z
epic_id: EPIC-0026
---

# Phase 1a+1b: Eliminate legacy switch, unify tool loading

**Severity:** high
**Status:** open
**Epic:** EPIC-0026

## Details

Removed executeDojoTool switch statement and ad-hoc tool registration. All tools now load through getAllTools() modular registry. Commit 51602ea.
