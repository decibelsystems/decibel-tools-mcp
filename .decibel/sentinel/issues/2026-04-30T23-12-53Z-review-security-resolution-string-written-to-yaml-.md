---
projectId: decibel-tools-mcp
severity: med
status: open
created_at: 2026-04-30T23:12:53.076Z
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
