---
projectId: decibel-tools-mcp
severity: low
status: open
created_at: 2026-04-30T23:13:21.201Z
---

# [review/security] sentinel ID-format inconsistency: list_issues returns filename-with-.md, close_issue/read_issue accept different forms

**Severity:** low
**Status:** open

## Details

## Discovered during PR #16 (mediareason/decibel-tools-mcp) review

**Tagged in HQ-side review as Sec-L1 + cross-reference to UX bug surfaced during PR #16 execution.**

### Surface

`sentinel.list_issues` returns issue IDs in **filename form** (e.g., `2025-12-14T23-20-45.237Z-memory-leak-detected.md`), but the issue's frontmatter `id:` field is in **canonical ISS-NNNN form** (e.g., `ISS-0054`).

`sentinel.read_issue` and `sentinel.close_issue` were called with both forms during PR #16's execution:

| ID format passed | Result |
|---|---|
| `ISS-0054` | ❌ ISSUE_NOT_FOUND (canonical id rejected) |
| `2025-12-14T23-20-45.237Z-memory-leak-detected.md` | ✅ accepted |
| `2025-12-14T23-20-45.237Z-memory-leak-detected` (no .md) | ❌ ISSUE_NOT_FOUND |

### UX impact

Discovered the hard way: first batch of 11 close_issue calls failed because the script extracted the canonical `id:` from frontmatter (the natural choice). Had to switch to filename-with-.md format mid-batch.

### Security framing

Today this is more UX bug than vulnerability, but it sets up a confused-deputy condition:

- A UI that displays the canonical `ISS-NNNN` and forwards a different identifier to `close_issue` could operate on the wrong issue
- An attacker who can name files (e.g., crafted `create_issue` output) could create a file whose filename ID disagrees with its frontmatter ID. Subsequent ops that trust one identifier and verify against the other could be tricked.

### Suggested fix

1. Normalize: pick ONE canonical ID format. Recommend `ISS-NNNN` (the frontmatter `id:` field) since it's stable across renames.
2. Make `read_issue`, `update_issue`, `close_issue` accept both forms (auto-detect ISS-NNNN vs filename) for compatibility.
3. Make `list_issues` return ISS-NNNN as the primary ID and include filename only as supplementary metadata.
4. Validate: reject create_issue calls where the frontmatter `id:` does not match the filename's leading ISS-NNNN.

### Cross-references

- ISS-0105 YAML cleanup (includes filename normalization)
- 2026-04-30T00-39-16Z (two-format coexistence)
