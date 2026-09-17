---
projectId: decibel-tools-mcp
severity: high
status: closed
created_at: 2026-06-04T23:51:37.924Z
closed_at: 2026-09-17T00:42:05.819Z
linked_commits:
  - sha: 19415c72098c66d3af237575dd407fc603b75e98
    shortSha: 19415c7
    message: "fix(security): close crucible sec-review findings
      (tier/CORS/events/queue/kernel)"
    relationship: fixes
    linked_at: 2026-09-17T00:42:41.594Z
    linked_by: ai:claude
updated_at: 2026-09-17T00:42:41.594Z

---

# CORS localhost allowlist uses startsWith → http://localhost.evil.com bypass + /events leaks before auth (crucible)

**Severity:** high
**Status:** closed

## Details

Found by crucible (2026-06-04), VERIFIED against source. Two related daemon-mode web-exposure bugs:

1. CORS startsWith BYPASS (httpServer.ts:646, VERIFIED): `localhostOrigins.some(lo => origin.startsWith(lo))` — `'https://localhost.attacker.tld'.startsWith('https://localhost')` === true. A malicious page at localhost.evil.com (or 127.0.0.1.evil.com) gets the daemon to echo its origin in Access-Control-Allow-Origin, enabling cross-origin reads of localhost daemon data (issues, /events, /tools, /agents). Drive-by attack on any dev running the daemon; with auth_token unset (default) → full daemon access.

2. /events (+ /health) EXECUTE BEFORE AUTH (httpServer.ts: /events handler line 737, /health line 694, but `if (authToken)` gate not until line 835, VERIFIED): even with an auth token configured, GET /events returns the full dispatch event log (agent IDs, tool names, run/request IDs, timestamps, error strings) unauthenticated. Chained with the CORS bypass, a cross-origin page exfiltrates the daemon's operational telemetry.

FIX: (1) match origin against an EXACT allowlist (URL parse + host equality, or anchored regex with port), not startsWith; (2) move the auth-token gate ABOVE the /events, /health, /agents handlers so protected data routes reject before returning data. Report: .crucible/runs/20260604T235029Z-attack/attack_report.md

## Resolution

Fixed in commit 19415c7: CORS now exact-host match via isLocalhostOrigin (httpServer.ts:165); /events enforces the auth token inline. Verified in source 2026-09-16.
