---
description: Review a Figma component against design principles
argument-hint: [figma-url]
---

Review a Figma component against project design principles.

## Instructions

1. Parse the Figma URL to extract:
   - **fileKey** — the part after `/file/` in the URL
   - **nodeId** — the part after `?node-id=` (URL-decode it, replace `-` with `:`)

2. Ask about review scope if not specified:
   - `full` — complete review (default)
   - `accessibility` — focus on a11y
   - `consistency` — focus on design system alignment

3. Use the `designer_review_figma` tool with these values.

4. Present findings grouped by severity:
   - Errors first (blocking issues)
   - Warnings (should fix)
   - Info (suggestions)

## Example

Input: `https://www.figma.com/file/abc123/Design?node-id=1-234`
Extracted: fileKey=`abc123`, nodeId=`1:234`
