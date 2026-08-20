---
id: ISS-0124
projectId: decibel-tools-mcp
severity: low
status: open
created_at: 2026-08-14T19:25:08.147Z
epic_id: EPIC-0036
---

# Verify attendee-email-domain as a second routing signal against the Zoom API

**Severity:** low
**Status:** open
**Epic:** EPIC-0036

## Details

Phase 2 of routing. Topic substring matching (ISS-0122) depends on Decibel controlling meeting titles. Routing on attendee email domain (@plasiv.com) would be far more robust and survive sloppy or client-scheduled titles.

UNVERIFIED — needs an API check before any estimate: it is not confirmed that the /meetings/meeting_summaries payload carries participant information. The list envelope is known to include meeting_host_email; full participants may require /report/meetings/{uuid}/participants, which would mean an additional scope (report:read:admin) and one extra API call per meeting, and may be gated on the Zoom plan tier.

Do this check first, then decide whether the signal is worth the extra scope. Layer it as a second matcher alongside topic patterns rather than replacing them.

A third signal worth noting: recurring meetings have a stable meeting ID, so a standing series like "Decibel work sesh (Plasiv)" could route by ID. Precise for standing calls, useless for ad-hoc ones.
