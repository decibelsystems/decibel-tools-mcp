---
projectId: decibel-tools-mcp
severity: high
status: open
created_at: 2026-02-13T07:29:13.168Z
epic_id: EPIC-0026
---

# Phase 3: Daemon mode with PID management and launchd

**Severity:** high
**Status:** open
**Epic:** EPIC-0026

## Details

Added --daemon flag for HTTP+PID+graceful shutdown (port 4888). Launchd install/uninstall/status. /health and /ready endpoints. SIGTERM/SIGINT with 30s drain. Commit 77654bf.
