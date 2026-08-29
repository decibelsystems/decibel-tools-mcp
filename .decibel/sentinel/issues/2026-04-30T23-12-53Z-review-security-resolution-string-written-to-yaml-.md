---
projectId: decibel-tools-mcp
severity: med
status: open
created_at: 2026-04-30T23:12:53.076Z
priority: high
updated_at: 2026-08-29T00:18:16.717Z
---

# [review/security] resolution string written to YAML/Markdown unescaped — YAML-injection surface in close_issue

**Severity:** med
**Status:** open

## Details

## Discovered during PR #16 (mediareason/decibel-tools-mcp) review

**Tagged in HQ-side review as Sec-M1.**

### Surface

`sentinel.close_issue` accepts a `resolution: string` argument and appends it verbatim into the issue file:

```diff
+## Resolution
+
+Stale 2025-12-14 test fixture; cleanup per ISS-0104 tracker.
```

The resolution text lands inside the Markdown body, after the YAML frontmatter delimiters.

### Threat

An attacker (compromised agent, stolen API token, or unsanitized user input flowing into a `close_issue` call) could pass:

```
---
status: open
malicious_field: "yes"
---
```

…as the resolution and inject a synthetic YAML frontmatter block into the body. Whether downstream parsers re-tokenize multiple `---` boundaries depends on implementation — but it's known-hostile input the close path doesn't sanitize.

### Compounding factor

Combined with the existing two-format-coexistence issue (`2026-04-30T00-39-16Z-review-code-two-coexisting-issue-file-formats-cons`) where some files have hybrid frontmatter (top YAML block + body fields), an injected `---` block could make a file's "real" state ambiguous to consumers.

### Suggested fix

1. Sanitize the resolution string: reject or escape lines that match `^---\s*$`
2. Or, structurally: write the resolution into the **frontmatter** as a `resolution:` field rather than appending to the body
3. Or, both — frontmatter for the structured form (preferred), body for human-readable rendering of that field

### Cross-references

- 2026-04-30T00-39-16Z (two-format coexistence — the compounding factor)
- 2026-04-30T00-39-27Z (frontmatter prototype-pollution surface)

[2026-08-29] 2026-08-28: confirmed actively corrupting data, not just a theoretical injection surface. Raising to high.

Mechanism: close_issue appends a markdown `## Resolution` section at **column 0** into `.yml` issue files. That terminates the preceding `description: |-` block scalar, `## Resolution` is then parsed as a YAML comment, and the resolution prose becomes a bare scalar at document root — following a mapping, which is invalid YAML. The file no longer parses.

Second-order effect: the status write does not land either, so the issue stays `status: open` while carrying a completed resolution. ISS-0039 reads `status: open` with a resolution beginning "Already implemented. resolveProjectPaths() calls getDefaultProject()..." — it was closed months ago and has been counted as open ever since.

This accounts for all 10 files `list_issues` reports as degraded, and inflates the open count by the same 10:
ISS-0002, ISS-0008, ISS-0013, ISS-0015, ISS-0028, ISS-0031, ISS-0032, ISS-0033, ISS-0039, ISS-0040.

Not the project-field mismatch — 8 of the 10 carry the correct `project: decibel-tools-mcp`. That mismatch (17 files on `decibel-tools`, 1 on an absolute path) is a separate hygiene problem.

Fix the writer before repairing the data, or the repair re-corrupts on the next close. Tracked under EPIC-0038.
