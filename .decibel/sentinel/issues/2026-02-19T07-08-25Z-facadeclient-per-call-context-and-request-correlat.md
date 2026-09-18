---
uid: 019c74ba-7e39-71a9-b9fe-8a273ab7229f
id: ISS-0096
projectId: decibel-tools-mcp
severity: low
status: closed
created_at: 2026-02-19T07:08:25.017Z
closed_at: 2026-05-20T00:57:44.000Z
closed_reason: verified done — commit 1398b12 + requestId threading present in kernel.ts and transports/mcp.ts
---

# FacadeClient per-call context and request correlation

**Severity:** low
**Status:** closed

## Details

Added CallContext type with scope, agentId, runId, engagementMode, userKey fields. FacadeClient.call() and batch() now accept optional per-call context that merges with config-level defaults. Every dispatch generates a requestId (crypto.randomUUID) threaded through DispatchContext, DispatchEvent, MCP _meta, and HTTP headers. Commit 1398b12.

Files changed: src/client/types.ts, src/client/facade-client.ts, src/client/index.ts, src/kernel.ts, src/transports/mcp.ts, src/client/transports.ts, src/httpServer.ts
