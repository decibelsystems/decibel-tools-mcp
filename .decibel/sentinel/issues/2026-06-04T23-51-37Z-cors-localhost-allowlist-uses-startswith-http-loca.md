---
projectId: decibel-tools-mcp
severity: high
status: open
created_at: 2026-06-04T23:51:37.924Z
---

# CORS localhost allowlist uses startsWith → http://localhost.evil.com bypass + /events leaks before auth (crucible)

**Severity:** high
**Status:** open

## Details

Found by crucible (2026-06-04), VERIFIED against source. Two related daemon-mode web-exposure bugs:

1. CORS startsWith BYPASS (httpServer.ts:646, VERIFIED): `localhostOrigins.some(lo => origin.startsWith(lo))` — `'https://localhost.attacker.tld'.startsWith('https://localhost')` === true. A malicious page at localhost.evil.com (or 127.0.0.1.evil.com) gets the daemon to echo its origin in Access-Control-Allow-Origin, enabling cross-origin reads of localhost daemon data (issues, /events, /tools, /agents). Drive-by attack on any dev running the daemon; with auth_token unset (default) → full daemon access.

2. /events (+ /health) EXECUTE BEFORE AUTH (httpServer.ts: /events handler line 737, /health line 694, but `if (authToken)` gate not until line 835, VERIFIED): even with an auth token configured, GET /events returns the full dispatch event log (agent IDs, tool names, run/request IDs, timestamps, error strings) unauthenticated. Chained with the CORS bypass, a cross-origin page exfiltrates the daemon's operational telemetry.

FIX: (1) match origin against an EXACT allowlist (URL parse + host equality, or anchored regex with port), not startsWith; (2) move the auth-token gate ABOVE the /events, /health, /agents handlers so protected data routes reject before returning data. Report: .crucible/runs/20260604T235029Z-attack/attack_report.md
