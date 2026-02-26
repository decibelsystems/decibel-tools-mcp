---
projectId: decibel-tools-mcp
severity: low
status: open
created_at: 2026-02-19T07:08:25.017Z
---

# FacadeClient per-call context and request correlation

**Severity:** low
**Status:** open

## Details

Added CallContext type with scope, agentId, runId, engagementMode, userKey fields. FacadeClient.call() and batch() now accept optional per-call context that merges with config-level defaults. Every dispatch generates a requestId (crypto.randomUUID) threaded through DispatchContext, DispatchEvent, MCP _meta, and HTTP headers. Commit 1398b12.

Files changed: src/client/types.ts, src/client/facade-client.ts, src/client/index.ts, src/kernel.ts, src/transports/mcp.ts, src/client/transports.ts, src/httpServer.ts
