---
id: ISS-0100
projectId: decibel-tools-mcp
severity: med
status: closed
created_at: 2026-04-01T06:32:12.221Z
updated_at: 2026-04-26T23:02:26.557Z
closed_at: 2026-05-23T23:48:04.193Z
---

# MCP daemon was binding 0.0.0.0 — broke senken.pro routing

**Severity:** med
**Status:** closed

## Details

Node MCP daemon subprocess in senken-trading-agent was binding to 0.0.0.0:8787, which Render detected as a public port and routed senken.pro traffic to instead of Flask on port 10000. Users saw the MCP health JSON instead of the Senken app.

Fix: added --host 127.0.0.1 to daemon startup in mcp_proxy_routes.py so Node only listens on localhost. Render now routes all external traffic to Flask. MCP proxy routes still work via localhost.

Commit: 7d58f1f7 (senken-trading-agent, 2026-03-31)

Lesson: when running a subprocess daemon alongside a primary web server, always bind to 127.0.0.1 — the guardian tool was already warning about this.

## Resolution

Same root cause as the 2026-05-23 port issue: parseHttpArgs baked host='0.0.0.0' that short-circuited daemonConfig's host='127.0.0.1' in server.ts, so the daemon bound all interfaces. Fixed by making parseHttpArgs return undefined for host when --host is absent, letting daemonConfig's 127.0.0.1 apply. Live daemon restarted and verified binding 127.0.0.1:4888 (localhost-only) — no longer *:8787. See ADR. Recommend a senken.pro routing re-verify to fully confirm downstream.
