---
uid: 019b47a6-3c93-7a61-8d67-29868dbac6f9
id: ISS-0020
projectId: decibel-tools-mcp
status: open
priority: high
epic_id: EPIC-0020
tags:
  - agentic
  - schema
  - zod
created_at: 2025-12-22T20:00:35.475Z
updated_at: 2026-09-02T04:08:48.230Z
---
# Implement AgentPayload Zod schema

**Status:** open
**Epic:** EPIC-0020

## Details

Create src/agentic/payload.ts with Zod schema for canonical agent payloads. Include: CapabilityRole enum (Sensor/Analyst/Overmind/Specialist), SystemStatus, SystemLoad, ConfidenceLevel, Evidence, Option, PackMetadata, and full AgentPayload schema. Add validatePayload() and validateRoleRequirements() helpers. See AGENTIC_PACK_V1_DIRECTIVE.md section 1.2 for full spec.

[2026-09-02] 2026-09-01 — this issue was mostly ALREADY BUILT, then orphaned.

A complete, correct CanonicalPayloadSchema (zod) existed at src/agentic/index.ts:67, wired into the render and lint tools. It was unreachable: it lived inside registerAgenticTools(server: McpServer), which stopped being called when server.ts was split into modules (ISS-0029). It typechecked, it imported cleanly, and it validated nothing. The hq peer scanned 98,217 events over 7.7 months and found zero real agentic.render/lint invocations, which is why nobody noticed. Demonstrated before the fix: role NotARealRole, status BANANA, load PURPLE, confidence 47, severity totally-bogus all rendered successfully with ok:true and warnings:[].

DONE NOW: the six schemas moved to src/agentic/types.ts, beside the interfaces they mirror (the drift being guarded against is schema-vs-type, so a third home would not have helped). validateCanonicalPayload() returns path-qualified errors and is wired into the live render handler, and into lint only when the optional payload is supplied. It REJECTS rather than coerces — confidence 47 is not clamped to 1, because a truth that rewrites its inputs is a worse foundation than one that refuses them. 11 tests assert against the live handler rather than the schema in isolation, since a schema with no caller is exactly the bug being fixed. registerAgenticTools is deleted; the file stays, because the live tools import their functions through its re-exports.

zod was a TRANSITIVE dependency of @modelcontextprotocol/sdk and undeclared by this package — tolerable while only dead code used it, not tolerable once it is load-bearing for live validation. Now declared explicitly (^4.3.6).

STILL NOT DONE from the original scope: validateRoleRequirements(). Role-conditional requirements — an Overmind payload must carry decision/guardrails/dissent — are not enforced by the schema, where those fields are all optional. The linter enforces output constraints from the compiled pack, a different layer that does not cover payload shape. If this issue stays open, that is what remains in it.
