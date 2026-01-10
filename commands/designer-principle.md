---
description: Create or update a design principle
argument-hint: [title]
---

Create or update a design principle for the project.

## Instructions

1. If title wasn't provided, ask for:
   - **title** — principle name (e.g., "4px Grid System")

2. Gather additional info:
   - **description** — full explanation of the principle
   - **category** — spacing, color, typography, accessibility, etc.
   - **checks** — things to verify (optional, e.g., ["all spacing must be multiples of 4"])

3. Use the `designer_upsert_principle` tool.

4. Confirm the principle was created/updated.

## Example

Title: "4px Grid System"
Description: "All spacing and sizing should be multiples of 4px for consistency"
Category: "spacing"
Checks: ["padding uses 4px increments", "margins use 4px increments"]
