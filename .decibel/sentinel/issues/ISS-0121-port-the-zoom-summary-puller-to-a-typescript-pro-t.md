---
id: ISS-0121
projectId: decibel-tools-mcp
severity: med
status: open
created_at: 2026-08-14T19:24:31.798Z
epic_id: EPIC-0036
---

# Port the Zoom summary puller to a TypeScript pro-tier `zoom` facade

**Severity:** med
**Status:** open
**Epic:** EPIC-0036

## Details

Rewrite plasiv's bin/pull-zoom-summaries.py (324 lines, Python stdlib) as a native TS tool module. Must be a rewrite, not a spawn() — the self-contained rule in CLAUDE.md forbids shelling to an external script. Node >=18 gives global fetch, so this needs ZERO new npm deps: fetch + fs + URLSearchParams replaces every stdlib call.

Shape: follow src/tools/voice/index.ts. Register under loadProTools() in src/tools/index.ts and add a `zoom` FacadeSpec with tier: 'pro' to proFacades in src/facades/definitions.ts, so it appears in both stdio and HTTP transports.

Actions: sync, list, read.

CARRY OVER FROM THE PYTHON — each encodes a real Zoom gotcha, do not "clean these up":
- encode_uuid double-encoding for meeting UUIDs starting with / or containing //
- in_range client-side date filtering, because Zoom ignores from/to on the /meetings/meeting_summaries list endpoint
- render() falling back from summary_content to the deprecated summary_overview / summary_details / next_steps split fields
- extract_list warning when the response envelope is not `summaries`, so a rename surfaces instead of silently returning zero

FIX IN THE PORT:
- Dedup currently keys on filename, and filenames are built from meeting topic + timestamp. plasiv's own CLAUDE.md calls Zoom titles and timestamps unreliable, and the drift is already visible in meetings/raw/: "Decibel x Plasiv Design Review July 31 copy.md", plus "aug 4.md" / "July 31.md" files with no timestamp pattern. Key on meeting_uuid instead.
- Credentials move from ~/.config/zoom-summaries/credentials.json into ~/.decibel/config.yaml, which already exists via src/daemonConfig.ts.
- No retry or rate-limit handling today; detail fetch is one request per meeting.

Zoom app: Server-to-Server OAuth, scope meeting_summary:read:admin (granular meeting:read:summary:admin).
