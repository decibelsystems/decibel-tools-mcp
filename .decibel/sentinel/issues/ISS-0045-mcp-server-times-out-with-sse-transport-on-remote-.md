---
uid: 019bf8cd-50f4-79c6-be93-b4cdfed2885e
id: ISS-0045
projectId: decibel-tools-mcp
status: open
priority: high
tags:
  - mcp
  - sse
  - transport
  - timeout
  - remote
  - connection
created_at: 2026-01-26T05:36:03.828Z
updated_at: 2026-01-26T05:36:03.828Z
---
# MCP server times out with SSE transport on remote connections

**Status:** open

## Details

**Problem:**
The MCP server consistently times out when using Server-Sent Events (SSE) transport for remote connections. This appears to be a recurring issue that blocks remote usage.

**Frequency:** Every time attempting remote connection
**Transport:** SSE (Server-Sent Events)
**Context:** Remote connections specifically affected

**Next Steps:**
1. Investigate SSE connection lifecycle and timeout settings
2. Check if this is specific to certain network configurations
3. Consider if WebSocket transport works as alternative
4. Look into MCP server SSE implementation for timeout handling
