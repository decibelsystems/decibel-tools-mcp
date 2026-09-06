---
uid: 01a06f6a-de0f-7f32-8be5-4aedd203ce5d
id: ISS-0155
projectId: decibel-tools-mcp
severity: high
status: closed
priority: high
tags:
  - torture
  - S3
  - release-gate
  - writer-reader-drift
created_at: 2026-09-05T02:34:29.775Z
updated_at: 2026-09-05T17:15:03.140Z
closed_at: 2026-09-05T17:15:03.044Z
resolution: "Resolved by commit e17c68b: sentinel: notes and titles that survive being read back"
---
# Issue titles are silently truncated at the first newline

**Severity:** high
**Status:** closed

## Details

Found by the S3 round-trip sweep (tests/torture/s3-roundtrip.test.ts), 2026-09-04.

create_issue accepts a multi-line title, reports success, and read_issue returns only the first line. 30 of 33 hostile values survive the round trip intact; these three do not:

  multiline           wrote "first line\nsecond line\nthird line"  read "first line"
  crlf                wrote "first\r\nsecond"                      read "first"
  frontmatter-fence   wrote "---\nfake: frontmatter\n---"          read "---"

The frontmatter-fence case is the same defect wearing its worst hat: a title beginning with a YAML document marker reads back as the bare marker.

This is the writer/reader drift family — the write succeeds, the reader returns less than the file holds, and nothing anywhere reports a loss. It joins the three already confirmed in this codebase.

WHAT IS ALREADY GOOD, and worth not breaking while fixing this: every YAML metacharacter survives (colon-space, hash, block-scalar markers, anchors, aliases, explicit tags, leading and trailing whitespace, both quote styles). Every type-ambiguous scalar survives AS A STRING — "true", "no", "yes", "1.0", "0755", "2026-09-02", "null", "~", "42" all read back as strings rather than being retyped to bool/int/date/null, which is the single most common YAML round-trip failure and this codebase does not have it. Tabs, a 10,000-character value, emoji, combining marks, RTL text, zero-width joiners and NFC/NFD pairs all survive. The quoting is good; the newline handling is not.

LIKELY CAUSE, unverified: the title is written into a single-line YAML scalar and read back with a line-oriented parse, so everything after the first newline is dropped rather than escaped or block-scalared.

FIX: either escape newlines on write and restore them on read, or use a YAML block scalar, or reject a multi-line title loudly at write time. Any of the three is acceptable; silently keeping the first line is not.

Regression test already exists — the S3 hostile corpus. Fixing this should turn "preserves the title exactly, for every hostile value" green with no test change.

## Resolution

Resolved by commit e17c68b: sentinel: notes and titles that survive being read back
