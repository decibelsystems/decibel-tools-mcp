---
id: ISS-0128
projectId: decibel-tools-mcp
severity: low
status: open
created_at: 2026-08-14T22:04:27.083Z
epic_id: EPIC-0036
---

# Rejoined Zoom meetings produce two uuids for one session — uuid dedup cannot merge them

**Severity:** low
**Status:** open
**Epic:** EPIC-0036

## Details

Found by the plasiv agent while backfilling meeting_uuid across the existing 23 files. Affects the dedup design in ISS-0121.

When a host drops and rejoins, Zoom ends one meeting instance and starts another. Both appear in /meetings/meeting_summaries as distinct meeting_uuids for what a human considers one session. Three such pairs exist in plasiv's meetings/raw/, e.g. 2026-08-12 16_02Z and 16_15Z.

uuid-keyed dedup (which is still the right primary key — filename keying had already drifted) cannot collapse these by construction.

WHY IT LOOKS FINE TODAY: the abandoned instance usually returns an empty summary_content, so the existing "no summary body yet" skip drops it. That is luck, not logic — the puller already has an `empty` counter for exactly this case. A rejoin that happens late enough for AI Companion to have generated a partial summary on the first instance produces two files for one meeting.

PROPOSED RULE for the port: after fetching details, collapse candidates sharing the same calendar date AND the same topic, keeping the instance with the longer summary_content. Log the collapse rather than doing it silently. Same-day-same-topic is deliberately narrow — a genuinely recurring same-topic meeting twice in one day is rare, and logging makes it recoverable.

Do not implement before ISS-0121 lands; this is a refinement of that dedup path, not a separate mechanism.
