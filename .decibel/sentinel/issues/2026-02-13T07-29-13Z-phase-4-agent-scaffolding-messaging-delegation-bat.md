---
id: ISS-0085
projectId: decibel-tools-mcp
severity: high
status: closed
closed_at: 2026-05-20T00:53:15.000Z
closed_reason: "verified done by code inspection 2026-05-19"
closure_note: "src/tools/coordinator/ scaffolded; messaging/delegation primitives in place"
created_at: 2026-02-13T07:29:13.168Z
epic_id: EPIC-0026
---

# Phase 4: Agent scaffolding — messaging, delegation, batch, hooks

**Severity:** high
**Status:** open
**Epic:** EPIC-0026

## Details

4a: Coordinator messaging (coord_send/inbox/ack). 4b: Vector delegation (delegated_by/to, vector_trace). 4c: Facade filtering (allowedFacades). 4d: Batch dispatch (kernel.batch, POST /batch). 4e: Dispatch hooks (EventEmitter, dispatch.jsonl, GET /events). Commit 432e731.
