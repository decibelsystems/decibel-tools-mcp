---
uid: 01a07cf9-f758-7afa-8a10-cf1c8fd8c8df
id: ISS-0161
projectId: decibel-tools-mcp
severity: low
status: open
priority: low
tags:
  - torture
  - guardian
  - waivers
created_at: 2026-09-07T17:45:51.704Z
---
# guardian.scan_headers makes a live HTTP request and has no S2 waiver

**Severity:** low
**Status:** open

## Details

Found by the S4 sweep after transient-backend detection was added. guardian.scan_headers answers "fetch failed" on all four transports in all four S2 situations — it reaches the network, unlike every other guardian scan.

Two things follow:

1. It is missing from waivers.yaml. The five guardian actions waived for S2 (scan_deps, scan_secrets, scan_http, scan_config, report) were enumerated before scan_headers existed, and the waiver comment's reasoning — "guardian scans the SOURCE TREE, never the project's .decibel store" — is not even true of this one: it scans a remote endpoint. It needs its own waiver with its own reason, not the copied one.

2. It is the first action in the surface whose answer depends on the network being up. In the scrubbed sandbox it fails uniformly, so S4 compares it cleanly. On a machine where the request SUCCEEDS on some passes and not others, it becomes the same flake deck.search was — now handled, but it is worth knowing this action has that shape.

Not urgent: the transient-backend mechanism in S4 covers the flake case, and the S2 gap is a missing waiver rather than a missing test.
