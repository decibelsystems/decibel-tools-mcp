---
uid: 019b855a-7930-7eb5-b84f-65aeec975b03
id: ISS-0031
projectId: decibel-tools-mcp
status: closed
priority: high
epic_id: EPIC-0024
tags:
  - cursor
  - docs
  - distribution
created_at: 2026-01-03T19:34:17.648Z
updated_at: 2026-08-29T16:18:24.823Z
closed_at: 2026-08-29T16:18:24.823Z
resolution: Shipped - Add to Cursor button live in README
---
# Add "Add to Cursor" deep link button to README

**Status:** closed
**Epic:** EPIC-0024

## Details

Create one-click install button for Cursor users.

Button format:
```html
<a href="cursor://anysphere.cursor-deeplink/mcp/install?name=decibel-tools&config=BASE64_CONFIG">
  <img src="https://cursor.com/deeplink/mcp-install-dark.svg" alt="Add Decibel Tools to Cursor" />
</a>
```

Config to encode: `{"command":"npx","args":["-y","decibel-tools-mcp"]}`

Place in:
- README.md (Installation section)
- docs landing page

## Resolution

Shipped - Add to Cursor button live in README
