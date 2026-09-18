---
uid: 01a053be-e951-79fd-81b2-a8d0fabca498
id: ISS-0149
projectId: decibel-tools-mcp
severity: low
status: open
epic_id: EPIC-0038
created_at: 2026-08-30T17:36:55.633Z
priority: low
updated_at: 2026-08-30T22:04:37.082Z
---
# Thin client carries ~11 MB over the bare-MCP floor — and nothing guards the import graph that got it there

**Severity:** low
**Status:** open
**Epic:** EPIC-0038

## Details

A thin client costs 72.8 MB against a 61.8 MB floor for any stdio MCP server (measured 2026-08-30, scripts/measure-memory.mjs, external ps). The residual ~11 MB is NOT the tool graph — a module trace confirms a --thin process loads exactly 9 Decibel modules (config, daemon, daemonConfig, httpArgs, lib/envelope, runtime/ensureRuntime, runtime/protocol, server, transports/thinStdio) and no tool modules at all. It is ajv + zod-to-json-schema + the MCP Server instance holding 30 facade definitions.

Filed for completeness, DELIBERATELY LOW PRIORITY. Per Ben 2026-08-30, efficient operation is the goal, not memory size, and PR #59 already removed the reason not to run thin. Chasing the last 11 MB buys nothing operationally unless it buys headroom for something concrete.

Do not pick this up as a memory exercise. Reasons it might become real work:
  - Phase 6 extensions inflate the definitions payload enough to matter
  - the definitions fetch becomes slow rather than merely large (30 facades is 23 KB on the wire today, so it is not slow now)
  - an actual out-of-memory report

The durable part of this issue is a guardrail that matters regardless of the 11 MB: adding a static import of any tool-reaching module to src/server.ts silently undoes PR #59. No test catches it — scripts/measure-memory.mjs must be run by hand. Worth a CI check that boots --thin and asserts an RSS ceiling, or a module-graph assertion that kernel.js is absent from a thin process. That guardrail is worth more than the 11 MB.
