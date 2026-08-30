---
uid: 019b47b5-1f66-7a8c-a430-d7e0fa32515a
id: ISS-0026
projectId: decibel-tools-mcp
status: closed
priority: high
tags:
  - bug
  - context-tools
  - missing-dependency
created_at: 2025-12-22T20:16:51.046Z
updated_at: 2025-12-22T20:16:51.046Z
---
# Context tools broken - @decibel/cli package missing

**Status:** closed

## Details

The context tools (`decibel_context_pin`, `decibel_context_refresh`, etc.) fail with "require is not defined" because they import from `@decibel/cli/lib/compiler` which doesn't exist.

**Root cause:**
- `src/tools/context.ts` imports from `@decibel/cli/lib/compiler`
- `@decibel/cli` is not listed in package.json dependencies
- The package doesn't exist in node_modules

**Fix options:**
1. Create @decibel/cli as a local package with the compiler functions
2. Inline the compiler functions directly in context.ts
3. Shell out to a Python/CLI implementation (like other tools do)

**Affected tools:**
- decibel_context_pin
- decibel_context_unpin
- decibel_context_refresh
- decibel_context_list
- decibel_event_append
- decibel_event_search
- decibel_artifact_list
- decibel_artifact_read
