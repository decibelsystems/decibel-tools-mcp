---
uid: 019b299b-4400-7d04-9a43-4f54955e89ef
id: ISS-0141
projectId: decibel-tools-mcp
status: closed
priority: high
tags:
  - sentinel
  - dataRoot
  - bug
created_at: 2025-12-17T00:00:00.000Z
updated_at: 2026-08-29T16:45:59.229Z
closed_at: 2026-05-20T00:55:20.000Z
resolution: |-
  Fixed by removing dead code. The silent fallback to unknown_project was in resolvePath() which had zero callers - all tools now use projectRegistry.resolveProjectPaths() which throws PROJECT_NOT_FOUND. Cleaned dataRoot.ts from 267 to 24 lines, keeping only ensureDir().

  Duplicate of ISS-0015 (sentinel-falls-back-to-decibel-mcp-data), which carries the fuller description. Both records were already closed and each names the other as its duplicate; this one gives up the id. Pre-allocator (2025-12-17).
closed_reason: duplicate of more-detailed ISS-0015 (sentinel-falls-back-to-decibel-mcp-data)
---
# Fix Sentinel Silent Fallback

**Status:** closed

## Details

When a project ID can't be resolved, dataRoot.ts silently falls back to
~/.decibel/sentinel/unknown_project/ instead of erroring. This causes data
to be written to the wrong location without user awareness.

**Fix:**
1. Remove 'unknown_project' fallback from getRoots()
2. Add `requireProject` option to resolvePath()
3. Throw explicit errors for project-local domains when no project found
4. Update sentinel.ts functions to return ProjectResolutionError

**Testing:**
After fix, calling sentinel functions without a valid project should return
a structured error instead of silently writing to unknown_project folder.

## Resolution

Fixed by removing dead code. The silent fallback to unknown_project was in resolvePath() which had zero callers - all tools now use projectRegistry.resolveProjectPaths() which throws PROJECT_NOT_FOUND. Cleaned dataRoot.ts from 267 to 24 lines, keeping only ensureDir().

Duplicate of ISS-0015 (sentinel-falls-back-to-decibel-mcp-data), which carries the fuller description. Both records were already closed and each names the other as its duplicate; this one gives up the id. Pre-allocator (2025-12-17).
