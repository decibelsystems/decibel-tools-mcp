---
uid: 019b0593-1f5b-7714-822c-235730a07b0f
id: ISS-0003
projectId: decibel-tools-mcp
status: closed
priority: medium
epic_id: EPIC-0008
tags:
  - node
  - mcp
  - bridge
  - phase-3
created_at: 2025-12-10T00:04:46.555Z
updated_at: 2026-08-29T16:18:24.757Z
closed_at: 2026-08-29T16:18:24.757Z
resolution: "Architecture changed: went with native TypeScript implementation instead of Node.js shim over Python CLIs. All tools now use direct file operations."
---
# Build Node.js MCP shim over Python CLIs

**Status:** closed
**Epic:** EPIC-0008

## Details

Build a thin Node.js MCP server that wraps the Decibel Python CLIs. This is the bridge that enables Desktop Extension packaging.

Architecture:
```
server/
├── index.js             # MCP server entry point
├── tools/               # Tool definitions (mirror Python CLI surface)
│   ├── sentinel.js      # Shells out to `decibel sentinel ...`
│   ├── oracle.js
│   ├── architect.js
│   ├── designer.js
│   ├── friction.js
│   └── learnings.js
└── utils/
    └── cli-runner.js    # spawn/exec wrapper with timeout, JSON parsing
```

Requirements:
- Uses @modelcontextprotocol/sdk
- Each tool definition maps 1:1 to a Python CLI command
- Parses JSON output from CLI, handles errors gracefully
- Timeout handling (some operations like scan can be slow)
- Works standalone for testing before .mcpb packaging

This shim should be <500 lines total—all logic stays in Python.

## Resolution

Architecture changed: went with native TypeScript implementation instead of Node.js shim over Python CLIs. All tools now use direct file operations.
