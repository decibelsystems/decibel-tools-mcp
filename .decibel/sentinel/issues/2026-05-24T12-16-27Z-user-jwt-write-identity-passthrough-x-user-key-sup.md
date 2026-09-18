---
uid: 019e59ea-4c67-7f1b-973a-8c397311b138
id: 2026-05-24T12-16-27Z-user-jwt-write-identity-passthrough-x-user-key-sup
projectId: decibel-tools-mcp
severity: high
status: open
epic_id: EPIC-0033
created_at: 2026-05-24T12:16:27.751Z
---

# User-JWT write-identity passthrough (X-User-Key → Supabase) so RLS holds end-to-end

**Severity:** high
**Status:** open
**Epic:** EPIC-0033

## Details

LINCHPIN: daemon-originated writes must carry the caller's user JWT (via existing X-User-Key header → DispatchContext.userKey) through to Supabase so RLS enforces tenant isolation — NOT a blanket service-role. Verify cross-org writes are blocked by RLS. Co-design the exact header contract with HQ. Part of EPIC-0033 / ADR-0007.
