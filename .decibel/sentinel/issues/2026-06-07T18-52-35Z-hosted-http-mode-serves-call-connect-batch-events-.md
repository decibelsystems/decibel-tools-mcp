---
projectId: decibel-tools-mcp
severity: high
status: closed
created_at: 2026-06-07T18:52:35.340Z
closed_at: 2026-09-17T00:42:11.799Z
linked_commits:
  - sha: fdd2822518525f79a5024c3022dbe90342a9f815
    shortSha: fdd2822
    message: "fix(security): hosted-mode fail-closed + queue-write authz decoupling
      (A+B)"
    relationship: fixes
    linked_at: 2026-09-17T00:42:55.702Z
    linked_by: ai:claude
updated_at: 2026-09-17T00:42:55.702Z

---

# Hosted (--http) mode serves /call,/connect,/batch,/events unauthenticated — make it fail closed (crucible re-run)

**Severity:** high
**Status:** closed

## Details

Crucible re-run (2026-06-07) after the first batch of sec fixes: the remaining serious findings ALL collapse to one root cause — hosted (--http, non-daemon) mode serves the full surface with NO auth when DECIBEL_AUTH_TOKEN is unset.

IMPORTANT ARCHITECTURE CONTEXT (verified): on senken.pro the Node daemon is NOT directly internet-exposed. It runs as a localhost subprocess (senken-trading backend/routes/mcp_proxy_routes.py spawns `node dist/server.js --daemon --port 8787 --host 127.0.0.1`); the public surface is the Python/Flask front (gunicorn) which proxies /call,/connect,/batch,/tools,/events/stream etc. to localhost — and those Flask routes (register_mcp_proxy_routes) currently have NO auth decorator and forward Authorization only if present. So the real public exposure lives in senken-trading's Flask layer, mitigated for the daemon itself by the 127.0.0.1 bind. The crucible threat model assumed a directly-exposed 0.0.0.0 daemon, which overstated severity — but the unauth proxy path is real.

DEPENDENT/CHAINED findings (from re-run) that this root fix neutralizes:
- /connect registers a caller-supplied agent_id unauthenticated → defeats the queueForAgent "known agent" guard (cross-tenant service-role agent_queue write with spoofed created_by). 
- /events, /tools(html), /openapi.{yaml,json}, /api/status leak (tool inventory, schema, project enumeration) before auth.
- tier-gating: no tenant identity required before dispatch in hosted mode.

FIX OPTIONS (Ben to pick — deploy-coordinated, affects senken.pro):
A) decibel side: in --http mode, refuse to serve /call,/connect,/batch,/events without an auth token (401) — fail closed; health/landing stay open.
B) senken side: add a Flask auth guard on the mcp_proxy routes (the public boundary) + set DECIBEL_AUTH_TOKEN and have the proxy forward it.
Recommended: BOTH (defense in depth) — decibel fails closed AND the Flask proxy authenticates its public routes. Either alone closes the current hole.

Separately fixed already (PR #38): NODE_ENV tier bypass, CORS startsWith, /events auth-when-token-set, kernel tier prefix bypass, partial queueForAgent guard. Reports: .crucible/runs/20260604T235029Z-attack + 20260607T174806Z-attack.

## Resolution

Option A landed in commit fdd2822: non-daemon --http mode refuses /call,/connect,/batch,/mcp,/events with 401 AUTH_NOT_CONFIGURED when no auth token. Option B (Flask proxy auth) is a senken-trading change, not tracked here.
