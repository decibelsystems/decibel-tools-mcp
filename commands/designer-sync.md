---
description: Sync design tokens from Figma
argument-hint: [figma-url]
---

Pull design tokens (variables) from a Figma file.

## Instructions

1. Parse the Figma URL to extract:
   - **fileKey** — the part after `/file/` in the URL

2. Use the `designer_sync_tokens` tool with the fileKey.

3. Summarize what was synced:
   - Number of color tokens
   - Number of number/spacing tokens
   - Number of string tokens
   - Total count

4. Show where the tokens were saved.

## Note

Requires `FIGMA_ACCESS_TOKEN` environment variable to be set.
