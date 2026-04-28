---
context: dojo
frequency: occasional
impact: medium
status: resolved
source: human
signal_count: 1
created_at: 2026-04-26T20:08:12.263Z
last_reported: 2026-04-26T20:08:12.263Z
tags: [dojo, taxonomy, project-tracking]
resolved_at: 2026-04-27T03:18:21.556Z
---

# Dojo wishes/proposals are scoped for feature-level incubation, but project-scale ideas (whole new apps or repos — e.g. Decibel HQ) don't fit cleanly. The artifact type muddies when the same `create_proposal` is used for both a small capability and a multi-week, multi-repo initiative. We need either a new artifact type (e.g. `dojo_create_initiative`) or an explicit scope field on proposals (feature | project | platform).</description>
<parameter name="frequency">occasional

Dojo wishes/proposals are scoped for feature-level incubation, but project-scale ideas (whole new apps or repos — e.g. Decibel HQ) don't fit cleanly. The artifact type muddies when the same `create_proposal` is used for both a small capability and a multi-week, multi-repo initiative. We need either a new artifact type (e.g. `dojo_create_initiative`) or an explicit scope field on proposals (feature | project | platform).</description>
<parameter name="frequency">occasional

## Context

**Where:** dojo
**Frequency:** occasional
**Impact:** medium
**Reported by:** human

## Current Workaround

Using dojo_create_proposal for project-scale work anyway, tagging title with project-scale and using scope_in/scope_out to constrain.

## Signal Log

- 2026-04-26T20:08:12.263Z [human] Initial report

## Resolution

Built dedicated concepts facade — pre-project product ideas have a discrete home at ~/.decibel/concepts/, separate from dojo (which stays feature-scoped inside an existing project). Actions: add, list, read, commit (graduates to project_id), shelve. Decibel HQ recorded as concept-2026-04-27-decibel-hq-fo7, committed to project_id decibel-hq.

**Solution Reference:** src/tools/concepts.ts

**Resolved:** 2026-04-27T03:18:21.556Z
