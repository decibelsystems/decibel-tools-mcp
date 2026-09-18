---
uid: 01a06f6b-0a43-78bd-9543-0fdec4a68191
id: ISS-0156
projectId: decibel-tools-mcp
severity: med
status: open
priority: medium
tags:
  - torture
  - S3
  - needs-root-cause
created_at: 2026-09-05T02:34:41.091Z
---
# read_epic returns notes:[] in a fresh project though update_epic reports success

**Severity:** med
**Status:** open

## Details

Found by the S3 round-trip sweep, 2026-09-04. REPRODUCIBLE BUT NOT ROOT-CAUSED — filed with what is actually known rather than a diagnosis.

REPRODUCTION. In a fresh sandbox project (empty .decibel, project registered in projects.json):
  1. sentinel log_epic  -> EPIC-0001, success
  2. sentinel update_epic with a `note` -> reports success, isError false
  3. sentinel read_epic -> returns the epic well-formed, with "notes": []

The note does not come back. The S3 probe asserts the WRITE succeeded as a separate test before judging the read, and that assertion passes — so this is not a failed write being blamed on the reader.

WHAT MAKES IT UNCLEAR. The same three-step sequence against the real decibel-tools-mcp store works correctly: EPIC-0036 was updated with four notes during this session and read_epic returns all four with their timestamps. So the behaviour differs between a fresh project and an established one, and the difference has not been identified.

Candidate explanations, none verified:
- log_epic in a fresh project may write a different on-disk format than the established epics carry, and read_epic's note parsing may only handle one of them.
- update_epic appends notes as "## Note (timestamp)" markdown sections; read_epic returns a structured `notes` array. The mapping between the two may depend on something the fresh file lacks (an updated_at field, a linked_commits block, a trailing fence).

WHY IT MATTERS ANYWAY. This is the shape of PR #72 — read_epic dropping the notes update_epic wrote — which was fixed. Whether this is a surviving corner of that bug or a different one, a note that writes successfully and reads back empty is data loss reported as success, and a fresh project is exactly what a new user has.

NEXT STEP: diff the on-disk epic file produced by the sandbox against an established one and find which field the note parsing depends on. Do not assume #72 regressed until that diff is done — the established-store path demonstrably works.
