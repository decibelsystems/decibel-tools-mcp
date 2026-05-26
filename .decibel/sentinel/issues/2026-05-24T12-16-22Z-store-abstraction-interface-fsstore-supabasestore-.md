---
projectId: decibel-tools-mcp
severity: high
status: open
created_at: 2026-05-24T12:16:22.212Z
epic_id: EPIC-0033
---

# Store abstraction interface (FsStore | SupabaseStore) for project-intel domains

**Severity:** high
**Status:** open
**Epic:** EPIC-0033

## Details

Define a Store interface for the project-intel domains (oracle/sentinel/architect/friction) and route facade handlers through it instead of direct fs. Two impls: FsStore (current local .decibel, git-tracked, default for local/dev/offline) and SupabaseStore (hosted/tenant). Selected by config/deployment (e.g. DECIBEL_STORE). No bidirectional sync on the hot path. Part of EPIC-0033 / ADR-0007.
