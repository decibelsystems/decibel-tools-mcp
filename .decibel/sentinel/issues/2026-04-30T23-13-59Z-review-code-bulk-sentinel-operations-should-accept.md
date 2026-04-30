---
projectId: decibel-tools-mcp
severity: low
status: open
created_at: 2026-04-30T23:13:59.296Z
---

# [review/code] Bulk sentinel operations should accept structured per-item resolutions

**Severity:** low
**Status:** open

## Details

## Discovered during PR #16 (mediareason/decibel-tools-mcp) review

**Tagged in HQ-side review as S2.**

### Observation

PR #16 closed 22 issues with the identical resolution string: `"Stale 2025-12-14 test fixture; cleanup per ISS-0104 tracker."`

This is acceptable for bulk treatment but unhelpful for archaeology. Future readers (or DX export adapters) parsing closed-issue resolutions get one repeated sentence × 22 instead of meaningful per-item context (severity class, original purpose, replacement test, etc.).

### Suggested fix

Two complementary surfaces:

1. **Per-item richer defaults**: when sentinel.close_issue is called, auto-populate the resolution with structured metadata if the caller passes a sparse string. E.g., always include the original `severity`, `created_at`, and any `tags` so the closure record stands alone.

2. **Optional `bulk_close_issues` action**: a single MCP call that accepts `{issue_ids[], resolution_template, status}` where resolution_template can interpolate per-issue fields (`{severity}`, `{title}`, `{created_at}`). Reduces the temptation to hand-loop close_issue with identical strings.

### Why low priority

This is genuine UX nice-to-have, not a correctness or security issue. Filed mainly so the pattern doesn't keep recurring on every cleanup PR.

### Cross-references

- PR #16 (mediareason/decibel-tools-mcp) — the operation that surfaced this
