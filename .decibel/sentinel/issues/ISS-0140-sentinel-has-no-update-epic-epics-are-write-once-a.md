---
id: ISS-0140
projectId: decibel-tools-mcp
severity: med
status: open
created_at: 2026-08-29T00:24:35.213Z
---

# sentinel has no update_epic — epics are write-once and can only be corrected by hand-editing the file

**Severity:** med
**Status:** open

## Details

The sentinel facade exposes log_epic, list_epics, read_epic, resolve_epic, and list_epic_issues — but no update_epic. Once an epic is created there is no tool path to change its summary, status, priority, owner, squad, or tags.

Hit for real on 2026-08-28: EPIC-0038 was created with a factually wrong phase ordering (it assumed a bug that had already been fixed in 4ecad91 was still live). Correcting it required rewriting `.decibel/sentinel/epics/EPIC-0038-*.md` directly with a script — exactly the manual-file-authoring antipattern CLAUDE.md tells agents never to do. The rule and the toolset disagree, and the toolset loses.

Hand-editing is also the riskier path here: the epic body is duplicated between the YAML frontmatter `summary` field (as an escaped double-quoted scalar) and the markdown body, so a correct edit means updating both in sync and getting the YAML escaping right. That is the same class of write hazard that produced the degraded issue records (ISS-0129) — a markdown-shaped write into a YAML-shaped field.

Asymmetry worth noting: issues have update_issue AND close_issue; epics have neither an update nor a close, only resolve_epic (a search helper, not a lifecycle operation — the name is misleading and worth revisiting separately). An epic's `status` is therefore fixed at `planned` forever, which makes list_epics(status: in_progress|shipped) return nothing useful and quietly undermines oracle's epic reporting (related: ISS-0110, "wired epics report wrong state").

Proposed: add update_epic(epic_id, status?, priority?, summary?, owner?, squad?, tags[]?, note?) mirroring update_issue's shape, writing frontmatter and body atomically from one source of truth rather than two. Add a round-trip test (log_epic -> update_epic -> read_epic) alongside the one proposed for issues in EPIC-0038 phase 1c.

Guard against the known array-field bug when implementing: log_epic currently renders array fields char-per-line and can corrupt the epic .md (open issue, 2026-05-25). update_epic must not inherit that. EPIC-0038 was deliberately created with scalar fields only to dodge it.
