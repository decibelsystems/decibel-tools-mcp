---
uid: 019b3dd9-115f-75ff-9399-de8afd967180
id: ISS-0019
projectId: decibel-tools-mcp
status: open
priority: medium
tags:
  - pathing
  - storage
  - consistency
created_at: 2025-12-20T22:19:54.591Z
updated_at: 2025-12-20T22:19:54.591Z
---
# Friction storage is global, not project-local

**Status:** open

## Details

friction_log writes to global decibel-mcp-data folder, not project-local .decibel/ folder like other tools.

This breaks the "portable project intelligence" principle - friction should travel with the project.

Path used: /Volumes/Ashitaka/Documents/GitHub/decibel-mcp-data/friction/
Expected: {project}/.decibel/friction/

All storage should be project-local for consistency with ADRs, issues, epics, learnings, etc.
