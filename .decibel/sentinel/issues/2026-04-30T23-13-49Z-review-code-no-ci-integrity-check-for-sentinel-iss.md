---
uid: 019de0ab-83a2-75c7-83ca-ac37ac33cdae
id: 2026-04-30T23-13-49Z-review-code-no-ci-integrity-check-for-sentinel-iss
projectId: decibel-tools-mcp
severity: med
status: open
created_at: 2026-04-30T23:13:49.986Z
---

# [review/code] No CI integrity check for sentinel issue/epic frontmatter — malformed files land silently

**Severity:** med
**Status:** open

## Details

## Discovered during PR #16 (mediareason/decibel-tools-mcp) review

**Tagged in HQ-side review as S3.**

### Problem

PR #16 surfaced that ISS-0104 had been carrying malformed YAML frontmatter for ~10 days (filed 2026-04-21, discovered 2026-04-30) without anyone noticing. The daemon's `list_issues` tolerated it; downstream consumers got partial/wrong data; `close_issue` happily wrote into it during cleanup.

The two-format coexistence issue (`2026-04-30T00-39-16Z-review-code-two-coexisting-issue-file-formats-cons`) is the structural root cause — but even after that lands, there's no automated guard that prevents the next malformed file from sneaking in.

### Suggested fix

1. **Pre-commit hook** (or CI step): walk `.decibel/sentinel/issues/*.md` and `.decibel/sentinel/epics/*.md`, parse each file's frontmatter via `safeParseYaml`, fail if any file:
   - Has missing required fields (`id`, `projectId`, `severity`, `status`)
   - Has frontmatter that's a non-object
   - Has `id:` that doesn't match the filename's leading ISS-NNNN
2. **Daemon-side validation action**: extend `audit_policies` (or add `audit_sentinel_files`) so a maintainer can run `sentinel.audit_sentinel_files` and get a structured report of all issue/epic files that fail the validation.
3. **CI workflow**: add a job to `.github/workflows/ci.yml` that runs the validator on every PR. Mirrors the lint/typecheck/build gate added on the HQ side via mediareason/decibel-hq#1.

### Why now

The sentinel issue store is the daemon's primary structured-data substrate. Letting it rot without validation means cascading downstream issues:
- `list_epic_issues` filtering broke because issues had unparseable epic_id fields (already fixed in PR #14 with safeParseYaml)
- `close_issue` writes to malformed files (Sec-M2)
- HQ's link-arrow rendering could break on hybrid-format issues
- Future DX-export adapter (HQ EPIC-0001, on hold) would emit garbage events

### Cross-references

- 2026-04-30T00-39-16Z (two-format coexistence)
- ISS-0105 YAML cleanup
- mediareason/decibel-hq#1 added typecheck+lint+build CI; this is the daemon-side equivalent for a different layer of correctness
