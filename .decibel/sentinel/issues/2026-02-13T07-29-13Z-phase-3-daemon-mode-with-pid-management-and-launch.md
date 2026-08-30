---
uid: 019c55e7-61d0-79ae-93e0-3329f9f59eb3
id: ISS-0084
projectId: decibel-tools-mcp
severity: high
status: closed
epic_id: EPIC-0026
created_at: 2026-02-13T07:29:13.168Z
closed_at: 2026-05-20T00:53:15.000Z
closed_reason: verified done by code inspection 2026-05-19
closure_note: src/daemon.ts (535 LOC) with PID management, launchd, shutdown handlers
---

# Phase 3: Daemon mode with PID management and launchd

**Severity:** high
**Status:** closed
**Epic:** EPIC-0026

## Details

Added --daemon flag for HTTP+PID+graceful shutdown (port 4888). Launchd install/uninstall/status. /health and /ready endpoints. SIGTERM/SIGINT with 30s drain. Commit 77654bf.
