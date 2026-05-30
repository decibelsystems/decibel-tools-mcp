---
projectId: decibel-tools-mcp
severity: high
status: open
created_at: 2026-05-24T12:16:24.123Z
epic_id: EPIC-0033
---

# SupabaseStore impl for oracle/sentinel/architect/friction (org-scoped)

**Severity:** high
**Status:** open
**Epic:** EPIC-0033

## Details

Implement SupabaseStore against the org-scoped project-intel tables (org_id+project_id) co-designed with HQ. Direct read/write, cloud = source of truth for hosted. Must use the caller's identity (see write-identity issue) so RLS applies. Table shapes + stable-ID keying TBD in co-design once HQ's schema draft lands. Part of EPIC-0033 / ADR-0007.
