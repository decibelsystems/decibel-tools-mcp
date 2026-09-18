---
uid: 019b0da0-5904-7428-82d1-91bfc7ceb8e2
id: ISS-0007
projectId: decibel-tools-mcp
status: open
priority: medium
tags:
  - roadmap
  - viz
  - rich
created_at: 2025-12-11T13:36:11.012Z
updated_at: 2025-12-11T13:36:11.012Z
---
# Add Timeline object to roadmap tools

**Status:** open

## Details

Add Timeline as a first-class derived object from roadmap data. Provides temporal visualization and progress tracking for milestones/epics.

Core tools needed:
- `roadmap_timeline(projectId, view?, range?)` - query timeline entries
- `roadmap_timeline_viz(projectId, format?)` - render ASCII/markdown/mermaid

Timeline is read-only, derived from existing roadmap.yaml + epic status. Will need Rich for proper terminal rendering.

See CC thread spec for full details.
