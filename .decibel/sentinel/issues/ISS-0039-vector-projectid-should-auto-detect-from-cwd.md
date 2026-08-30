---
uid: 019bb913-5808-7d6c-b46d-5b25337c4228
id: ISS-0039
projectId: decibel-tools-mcp
status: closed
priority: high
tags:
  - vector
  - dx
  - consistency
created_at: 2026-01-13T20:36:51.336Z
updated_at: 2026-08-29T16:18:24.844Z
closed_at: 2026-08-29T16:18:24.844Z
resolution: Already implemented. resolveProjectPaths() calls getDefaultProject() which has 4 strategies including cwd discovery via findDecibelDir(process.cwd()). Verified working - vector_list_runs without projectId returns successfully.
---
# Vector: projectId should auto-detect from cwd

**Status:** closed

## Details

When projectId is not specified, Vector tools should default to detecting the project from the current working directory (basename of $PWD if it contains .decibel/).

Current behavior: Requires explicit projectId parameter.
Expected: Auto-detect like other tools do.

## Resolution

Already implemented. resolveProjectPaths() calls getDefaultProject() which has 4 strategies including cwd discovery via findDecibelDir(process.cwd()). Verified working - vector_list_runs without projectId returns successfully.
