---
context: sentinel epic lifecycle
frequency: occasional
impact: medium
status: open
source: agent
signal_count: 1
created_at: 2026-08-20T05:26:26.739Z
last_reported: 2026-08-20T05:26:26.739Z
tags: [sentinel, epics, tool-gap, provenance]
---

# sentinel has no update_epic action. It exposes log_epic, read_epic, list_epics, resolve_epic and list_epic_issues — but no mutation path for an epic after creation. Issues get update_issue and close_issue; epics get nothing.

Hit while revising EPIC-0037 after a design review from the decibel-hq peer overruled two of its acceptance criteria and found a real bug in its addressing model (session keys used as durable addresses). The correct move was to amend the epic. With no tool for it, the options were to hand-edit the markdown — which this project's own CLAUDE.md lists as an anti-pattern ("Writing markdown files instead of using tools") — or to leave known-wrong acceptance criteria on disk and scatter the corrections into issues.

I hand-edited, because leaving incorrect criteria in place is worse. But that is exactly the "wrong path is easy, right path has friction" shape already logged for PROJECT_NOT_FOUND, and it produces an epic edit with no provenance event.

Epics are long-lived by definition, and a design review that changes their scope is normal rather than exceptional. The missing verb makes the tool wrong for the artifact's actual lifecycle.

Wanted: update_epic(epic_id, status?, priority?, summary?, note?, acceptance_criteria?, outcomes?, tags?) following the update_issue pattern — append-a-note semantics for narrative, replace semantics for structured fields, and a provenance event either way.

sentinel has no update_epic action. It exposes log_epic, read_epic, list_epics, resolve_epic and list_epic_issues — but no mutation path for an epic after creation. Issues get update_issue and close_issue; epics get nothing.

Hit while revising EPIC-0037 after a design review from the decibel-hq peer overruled two of its acceptance criteria and found a real bug in its addressing model (session keys used as durable addresses). The correct move was to amend the epic. With no tool for it, the options were to hand-edit the markdown — which this project's own CLAUDE.md lists as an anti-pattern ("Writing markdown files instead of using tools") — or to leave known-wrong acceptance criteria on disk and scatter the corrections into issues.

I hand-edited, because leaving incorrect criteria in place is worse. But that is exactly the "wrong path is easy, right path has friction" shape already logged for PROJECT_NOT_FOUND, and it produces an epic edit with no provenance event.

Epics are long-lived by definition, and a design review that changes their scope is normal rather than exceptional. The missing verb makes the tool wrong for the artifact's actual lifecycle.

Wanted: update_epic(epic_id, status?, priority?, summary?, note?, acceptance_criteria?, outcomes?, tags?) following the update_issue pattern — append-a-note semantics for narrative, replace semantics for structured fields, and a provenance event either way.

## Context

**Where:** sentinel epic lifecycle
**Frequency:** occasional
**Impact:** medium
**Reported by:** agent

## Current Workaround

Hand-edit .decibel/sentinel/epics/EPIC-NNNN-*.md directly, and note the revision inline in the epic body so the change is at least self-documenting.

## Signal Log

- 2026-08-20T05:26:26.739Z [agent] Initial report
