---
uid: 019b855a-97f2-70e9-ad81-bacc8cfdf69b
id: ISS-0032
projectId: decibel-tools-mcp
status: closed
priority: high
epic_id: EPIC-0024
tags:
  - cursor
  - project-init
  - config
created_at: 2026-01-03T19:34:25.522Z
updated_at: 2026-08-29T16:18:24.830Z
closed_at: 2026-08-29T16:18:24.830Z
resolution: Shipped with Cursor integration
---
# Add --cursor flag to project_init for .cursor/mcp.json generation

**Status:** closed
**Epic:** EPIC-0024

## Details

Add --cursor flag to project_init that generates `.cursor/mcp.json` in the project root.

Output file:
```json
{
  "mcpServers": {
    "decibel-tools": {
      "command": "npx",
      "args": ["-y", "decibel-tools-mcp"],
      "env": {}
    }
  }
}
```

Implementation:
- Add flag to project_init tool
- Create .cursor/ directory if needed
- Write mcp.json with proper formatting
- Log success message

Could also support `--cursor-dev` for local development path.

## Resolution

Shipped with Cursor integration
