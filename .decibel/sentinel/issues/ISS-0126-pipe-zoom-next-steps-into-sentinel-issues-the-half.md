---
id: ISS-0126
projectId: decibel-tools-mcp
severity: low
status: open
created_at: 2026-08-14T19:25:26.207Z
epic_id: EPIC-0036
---

# Pipe Zoom next_steps into sentinel issues (the half that makes this a feature)

**Severity:** low
**Status:** open
**Epic:** EPIC-0036

## Details

Scoped separately because the port (ISS-0121) and routing (ISS-0122) stand on their own; this is where a markdown dumper becomes a product feature.

Zoom already returns next_steps as a STRUCTURED array on the meeting summary detail — not prose to be parsed out. This repo already has intent parsing in src/tools/voice.ts (parseIntent -> add_wish, log_issue, log_friction, record_learning, ask_oracle, log_crit). Meeting summary -> next_steps -> sentinel issues in the routed project is a short hop over existing machinery.

Design questions to settle before building:
- Auto-create issues, or stage them for review? Auto-creating from a mis-transcribed action item is noise, and Zoom transcription drift is documented in plasiv's CLAUDE.md ("Passive Intelligence" is a known mis-transcription of PIE). Lean toward staging for confirmation.
- Dedup across recurring meetings — a standing weekly call repeats the same next step until it is done, so naive creation produces one issue per week for the same item.
- Provenance: link created issues back to the source meeting_uuid.

Do this after ISS-0121 and ISS-0122 land.
