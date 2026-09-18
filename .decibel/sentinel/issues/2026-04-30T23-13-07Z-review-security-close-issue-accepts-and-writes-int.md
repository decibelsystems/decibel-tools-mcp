---
uid: 019de0aa-dd81-71bd-a208-02408c77469c
id: 2026-04-30T23-13-07Z-review-security-close-issue-accepts-and-writes-int
projectId: decibel-tools-mcp
severity: med
status: open
created_at: 2026-04-30T23:13:07.457Z
---

# [review/security] close_issue accepts and writes into malformed-frontmatter files — confused-deputy surface

**Severity:** med
**Status:** open

## Details

## Discovered during PR #16 (mediareason/decibel-tools-mcp) review

**Tagged in HQ-side review as Sec-M2.**

### Surface

ISS-0104 (`2026-04-21T17-02-25Z-close-stale-test-fixture-issues-from-2025-12-14-se.md`) had a malformed frontmatter pre-cleanup:

```yaml
---
id: ISS-0104
---

projectId: decibel-tools-mcp        ← these are in the markdown body,
severity: low                          not in the frontmatter
status: in_progress
created_at: 2026-04-21T17:02:25.381Z
updated_at: 2026-04-26T20:55:48.964Z
```

Only `id:` was inside the `---...---` block. The rest sat as Markdown body. Any standards-compliant YAML frontmatter parser sees only `{id}` from this file; everything else would be treated as text.

### What happened

`sentinel.close_issue` accepted this file and **wrote new fields (`closed_at`, `status: closed`) into the malformed top block**, reinforcing the broken structure. The action's contract appears to be "find any line matching `status:` anywhere in the file and update it," not "parse the frontmatter, validate, then mutate it."

Result: post-write, the file still has malformed frontmatter — different parsers will see different `status` values depending on whether they read frontmatter-only or scan the whole file.

### Threat

Confused-deputy: an attacker who can craft an issue file with hybrid frontmatter (e.g., via `create_issue`'s description field, which lands in the body) could create files where the **frontmatter** describes one issue but the **body** contains an embedded YAML block describing another. The daemon, the HQ UI, and an external auditor could all disagree about what's in the file.

Combined with **Sec-M1** (resolution string injection), this enables a chain: inject a `---\n...---\n` block via resolution → create hybrid file → confuse downstream parsers.

### Suggested fix

1. `close_issue` (and update_issue, create_issue) should round-trip the file through `safeParseYaml` before writing. If parse fails or yields a non-object, reject with a structured error.
2. Add a sentinel-level "validate all issue files" action (or include in `audit_policies`) that surfaces hybrid-format files for cleanup.
3. Reject any `---` delimiter found in a body field (Sec-M1 fix overlaps).

### Cross-references

- 2026-04-30T00-39-16Z-review-code-two-coexisting-issue-file-formats-cons (two-format coexistence — root cause)
- ISS-0105 YAML cleanup
- Sec-M1 (companion injection surface)
