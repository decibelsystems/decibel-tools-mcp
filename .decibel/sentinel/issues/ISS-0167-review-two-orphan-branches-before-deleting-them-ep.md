---
uid: 01a0b667-abb0-7981-bcdb-3d8fdccb40c5
id: ISS-0167
projectId: decibel-tools-mcp
severity: low
status: open
priority: medium
tags:
  - housekeeping
  - branches
  - todo
  - epics
created_at: 2026-09-18T21:24:02.608Z
---
# Review two orphan branches before deleting them — EPIC-0034/0035 and the tutor tool exist nowhere else

**Severity:** low
**Status:** open

## Details

CONTEXT. A branch audit on 2026-09-18 compared every branch's CONTENT against
main rather than trusting the merge graph, because most of this repo's history
was squash-merged and the graph therefore understates what has landed.

Result: 52 of 55 branches are safe to delete — 43 are ancestors of main, and 9
more look unmerged but their content is verifiably in main (epic-0036-zoom-facade
→ src/tools/zoom.ts + the 8 torture suites; feat/phase-2-store-repair →
issueRepository.ts + circuitBreaker.ts; feat/phase-4-envelope-ok → ADR-0009;
feat/run-last-event-at and fix/run-status-explicit → last_event_at in vector.ts;
feature/security-and-codereview-tools → codereview.ts; feature/feedback-tools →
zero delta; chore/adr-id-collision-note → main's ISS-0147 is strictly ahead;
fix/sentinel-scan-use-ts-inspector → superseded, main resolves through
resolveProjectPaths (registry) where the branch used the older projectPaths;
public/feat/corpus-write-actions → addPattern in corpus.ts).

TWO BRANCHES HOLD CONTENT THAT IS IN NO OTHER BRANCH.

1. feature/token-byo-epics (last commit 2026-04-29, 195 behind main).
   Absent from main: EPIC-0034 (cost facade — cost_estimate, cost_summary,
   cost_tracking), EPIC-0035 (agent profiles — coordinator register_profile),
   and docs/STRATEGY_TOKEN_BYO.md. Strategy documents, not code, so salvaging
   is a cherry-pick with no merge risk.

2. feature/tutor (last commit 2026-01-25, 275 behind main).
   src/tools/tutor.ts, 1058 lines, plus src/tools/tutor/index.ts. The string
   "tutor" appears nowhere in main. Written before the kernel and facade layers
   existed, so this is a port, not a rebase.

DECISION DEFERRED. Ben, 2026-09-18: "not sure about those epics let's review
them later." No branch was deleted — the whole cleanup is on hold, so nothing
is lost while this sits. Both branches are pushed to origin.

WHEN PICKING THIS UP: read the two epics first. If they still describe work
worth doing, cherry-pick the three files onto main and delete the branch; the
tutor question is separate and mostly "is this worth porting to the facade
layer at all".
