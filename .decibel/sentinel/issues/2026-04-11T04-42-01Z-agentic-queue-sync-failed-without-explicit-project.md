---
projectId: decibel-tools-mcp
severity: med
status: open
created_at: 2026-04-11T04:42:01.081Z
---

# agentic queue_sync failed without explicit projectId — fixed with getDefaultProject fallback

**Severity:** med
**Status:** open

## Details

queue_sync hard-required projectId, throwing "projectId is required" when called without it. Other Supabase-backed tools (voice inbox_sync) already used getDefaultProject() as fallback. Applied the same pattern to agentQueueSync. Committed on feat/decibel-hooks, built to dist/.
