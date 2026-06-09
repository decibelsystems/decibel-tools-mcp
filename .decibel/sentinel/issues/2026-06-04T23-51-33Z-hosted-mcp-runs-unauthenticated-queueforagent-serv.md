---
projectId: decibel-tools-mcp
severity: critical
status: open
created_at: 2026-06-04T23:51:33.068Z
---

# Hosted MCP runs unauthenticated + queueForAgent service-role write with spoofable caller ids (crucible sec review)

**Severity:** critical
**Status:** open

## Details

Found by crucible adversarial sec review (2026-06-04), VERIFIED against source. Two chained critical/high findings on the hosted (--http, 0.0.0.0) path:

1. UNAUTHENTICATED HOSTED MCP (httpServer.ts startHttpServer auth block): the `if (authToken) {...}` gate is entirely skipped when DECIBEL_AUTH_TOKEN is unset (the senken.pro default — banner literally prints "Auth: None"). So POST /call executes full tool dispatch for any anonymous internet caller. Server advertises the insecure state instead of refusing to start.

2. queueForAgent SERVICE-ROLE WRITE WITH SPOOFABLE IDS (httpServer.ts:404-438, VERIFIED): uses getSupabaseServiceClient() (bypasses RLS) and inserts agent_queue rows with project_id + created_by=agentId taken DIRECTLY from caller-supplied request headers/body (X-Agent-Id). No check that agentId/projectId belong to the caller's org. Combined with #1 (anyone can reach /call) → cross-tenant queue poisoning: an attacker queues a tool call against another org's agent_id, and that agent's next queue_sync pulls + executes it. This is the exact "no service_role for tenant writes" invariant, violated.

FIX: (a) hosted mode should fail closed — require DECIBEL_AUTH_TOKEN (or a license/JWT) before serving /call, not run open; (b) queueForAgent must validate agentId/projectId against the authenticated caller's org and must not use service_role for a caller-driven write (forward the user JWT so RLS applies, mirroring SupabaseStore). Report: .crucible/runs/20260604T235029Z-attack/attack_report.md
