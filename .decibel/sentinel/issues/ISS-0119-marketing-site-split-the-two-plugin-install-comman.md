---
uid: 019fca81-d866-74eb-8588-c4c0477ad90c
id: ISS-0119
projectId: decibel-tools-mcp
severity: low
status: open
created_at: 2026-08-04T02:02:15.014Z
---

# Marketing site: split the two plugin install commands into separate copy boxes

**Severity:** low
**Status:** open

## Details

From GitHub issue #19 (richovercash, 2026-05-18): the site shows `/plugin marketplace add decibelsystems/decibel-tools-mcp` and `/plugin install decibel-tools@decibel-marketplace` in one copy box; copying all and pasting makes Claude loop the install into failure. Fix on the Replit marketing site (not this repo): one copy box per command. Fold into the ISS-0093 marketing-site update pass. GH #19 closed with a pointer here.
