---
id: ISS-0082
projectId: decibel-tools-mcp
severity: med
status: closed
closed_at: 2026-05-20T00:53:15.000Z
closed_reason: "verified done by code inspection 2026-05-19"
closure_note: "DECIBEL_APPS env var gating active in kernel.ts, server.ts, tools/index.ts"
created_at: 2026-02-13T07:29:13.168Z
epic_id: EPIC-0026
---

# Phase 1e: Separate apps tier (DECIBEL_APPS)

**Severity:** med
**Status:** open
**Epic:** EPIC-0026

## Details

Split senken and deck into apps tier gated by DECIBEL_APPS env var. FacadeSpec.tier replaces old pro boolean. Auto-enabled in dev. Commit ef6bbae.
