---
context: facade layer
frequency: occasional
impact: medium
status: open
source: human
signal_count: 1
created_at: 2026-02-13T07:34:22.314Z
last_reported: 2026-02-13T07:34:22.314Z
tags: [facades, dx, schema]
---

# Every facade exposes params as {type: object, additionalProperties: true} with no schema. LLMs guess field names wrong (description vs details, project_id vs projectId). Root cause of most facade dispatch failures.

Every facade exposes params as {type: object, additionalProperties: true} with no schema. LLMs guess field names wrong (description vs details, project_id vs projectId). Root cause of most facade dispatch failures.

## Context

**Where:** facade layer
**Frequency:** occasional
**Impact:** medium
**Reported by:** human

## Signal Log

- 2026-02-13T07:34:22.314Z [human] Initial report
