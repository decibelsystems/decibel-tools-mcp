---
uid: 019b28c3-5fdd-7910-9aa3-c379b1fd7dcd
id: ISS-0012
projectId: decibel-tools-mcp
status: closed
priority: medium
tags:
  - mcp
  - context-pack
  - fallback
  - phase-2
created_at: 2025-12-16T20:04:11.357Z
updated_at: 2026-09-01T21:49:11.559Z
closed_at: 2026-09-01T21:49:11.500Z
resolution: Obsolete, not fixed. The premise was that context tools shell out to a decibel CLI and fail with ENOENT when it is absent. They no longer spawn anything — context tools use native file operations, so there is no CLI path to fall back from.
---
# Add YAML fallback to MCP context tools when CLI unavailable

**Status:** closed

## Details

Update MCP context tools to have a fallback when CLI is not available.

Current state:
- Tools shell out to `decibel` CLI
- If CLI not in PATH, tools fail with ENOENT

Target state:
- Try CLI first (for consistency with human usage)
- If CLI fails with ENOENT, fall back to direct YAML read/write
- Log which method was used for debugging

Files to update:
- src/tools/context.ts - add YAML fallback functions
- Use js-yaml for parsing (already a dependency)

Pattern:
```typescript
async function contextList(input): Promise<...> {
  try {
    return await contextListViaCli(input);
  } catch (e) {
    if (e.code === 'ENOENT') {
      log('CLI not found, using direct YAML read');
      return await contextListViaYaml(input);
    }
    throw e;
  }
}
```

## Resolution

Obsolete, not fixed. The premise was that context tools shell out to a decibel CLI and fail with ENOENT when it is absent. They no longer spawn anything — context tools use native file operations, so there is no CLI path to fall back from.
