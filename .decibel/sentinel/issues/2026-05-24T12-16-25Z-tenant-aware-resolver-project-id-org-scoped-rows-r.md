---
uid: 019e59ea-457d-7f92-abf2-3cd1a905d2da
id: 2026-05-24T12-16-25Z-tenant-aware-resolver-project-id-org-scoped-rows-r
projectId: decibel-tools-mcp
severity: high
status: open
epic_id: EPIC-0033
created_at: 2026-05-24T12:16:25.981Z
---

# Tenant-aware resolver: project_id → org-scoped rows (replace strategy 6/7 box-fs collapse)

**Severity:** high
**Status:** open
**Epic:** EPIC-0033

## Details

For hosted/Supabase mode, resolve project_id to org-scoped store rows instead of falling through resolveProject strategies 6 (DECIBEL_PROJECT_ROOT fallback) / 7 (cwd fallback), which currently collapse every project_id to the box's single project. Local/FsStore mode keeps current registry behavior. Part of EPIC-0033 / ADR-0007.
