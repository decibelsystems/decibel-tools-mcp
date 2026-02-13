---
projectId: decibel-tools-mcp
severity: high
status: open
created_at: 2026-02-13T07:29:13.168Z
epic_id: EPIC-0026
---

# Phase 5: Bridge mode — stdio proxy to daemon

**Severity:** high
**Status:** open
**Epic:** EPIC-0026

## Details

Created src/transports/bridge.ts. Stdio clients proxy through to a running daemon via bridge mode, avoiding duplicate server instances. Commit 662895c.
