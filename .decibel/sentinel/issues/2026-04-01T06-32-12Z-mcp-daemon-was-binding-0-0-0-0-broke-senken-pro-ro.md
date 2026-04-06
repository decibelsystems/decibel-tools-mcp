---
projectId: decibel-tools-mcp
severity: med
status: open
created_at: 2026-04-01T06:32:12.221Z
---

# MCP daemon was binding 0.0.0.0 — broke senken.pro routing

**Severity:** med
**Status:** open

## Details

Node MCP daemon subprocess in senken-trading-agent was binding to 0.0.0.0:8787, which Render detected as a public port and routed senken.pro traffic to instead of Flask on port 10000. Users saw the MCP health JSON instead of the Senken app.

Fix: added --host 127.0.0.1 to daemon startup in mcp_proxy_routes.py so Node only listens on localhost. Render now routes all external traffic to Flask. MCP proxy routes still work via localhost.

Commit: 7d58f1f7 (senken-trading-agent, 2026-03-31)

Lesson: when running a subprocess daemon alongside a primary web server, always bind to 127.0.0.1 — the guardian tool was already warning about this.
