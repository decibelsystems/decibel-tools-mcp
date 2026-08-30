---
uid: 019b7771-8acc-7aaf-993a-657411afe6fc
id: ISS-0030
projectId: decibel-tools-mcp
status: open
priority: medium
tags:
  - voice
  - ux
  - routing
  - mobile
created_at: 2026-01-01T02:44:48.460Z
updated_at: 2026-01-01T02:44:48.460Z
---
# Voice input should support explicit project targeting

**Status:** open

## Details

Currently voice commands route to the default project (decibel-tools-mcp). Users moving between projects can easily send bugs/wishes to the wrong project.

**Enhancement:**
- Mobile app should send current project context with voice commands
- Voice inbox should support `project_id` parameter
- Consider "for senken" / "for studio" suffix parsing in transcripts
- Show project name in confirmation UI

**Current behavior:** All voice → decibel-tools-mcp
**Desired:** Voice → project user is currently working on (or explicit target)
