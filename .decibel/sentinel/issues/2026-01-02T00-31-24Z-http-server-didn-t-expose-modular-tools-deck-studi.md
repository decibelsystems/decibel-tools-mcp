---
projectId: decibel-tools-mcp
severity: med
status: closed
created_at: 2026-01-02T00:31:24.852Z
closed_at: 2026-01-02T00:33:28.583Z
---

# HTTP server didn't expose modular tools (deck, studio, etc.)

**Severity:** med
**Status:** closed

## Details

## Problem

The HTTP server mode (`httpServer.ts`) had hardcoded tool lists in two places:
- `executeDojoTool()` - switch statement with explicit tool cases
- `getAvailableTools()` - hardcoded array of tool names/descriptions

When new tools were added to the modular system (`src/tools/index.ts`), they worked in stdio mode (Claude Code) but NOT in HTTP mode (ChatGPT, iOS, senken.pro/call).

This caused `deck_buylist_search` and other deck tools to return `UNKNOWN_TOOL` errors.

## Root Cause

Two separate tool registries that weren't connected:
- Modular: `src/tools/index.ts` (deck tools added here)
- HTTP: `src/httpServer.ts` (hardcoded, didn't include deck)

## Fix (v4.0.2)

1. Import `modularToolMap` and `modularTools` into httpServer.ts
2. Add fallback in `executeDojoTool()` default case to check modularToolMap
3. Spread modularTools into `getAvailableTools()` return array

Now any tool added to the modular system automatically works in HTTP mode.

## Files Changed

- `src/httpServer.ts` - Added modular fallback

## Resolution

Fixed in v4.0.2 (commit 03ebe9d). HTTP server now falls back to modularToolMap for unknown tools and includes all modular tools in getAvailableTools().
