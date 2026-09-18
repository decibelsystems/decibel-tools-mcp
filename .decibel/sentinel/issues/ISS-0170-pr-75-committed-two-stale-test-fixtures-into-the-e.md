---
uid: 01a0b691-0bd6-7da0-80f7-9fbc6b57f90e
id: ISS-0170
projectId: decibel-tools-mcp
severity: high
status: open
priority: high
tags:
  - sentinel
  - epics
  - duplicate-id
  - test-fixtures
  - pr-75
  - silent-wrong-answer
created_at: 2026-09-18T22:09:14.198Z
linked_commits:
  - sha: ce87aeb0851bdec8c49a11062e9c97d66ea46b16
    shortSha: ce87aeb
    message: "sentinel: ISS-0170 — two test fixtures landed in the epic store"
    relationship: related
    linked_at: 2026-09-18T22:09:20.731Z
    linked_by: ai:claude
  - sha: 3b03008c718d644229d9349da6cde172fdc5c6df
    shortSha: 3b03008
    message: "sentinel: auto-linked commit metadata for ISS-0169 and ISS-0170"
    relationship: related
    linked_at: 2026-09-18T22:09:49.701Z
    linked_by: ai:claude
updated_at: 2026-09-18T22:09:49.701Z

---
# PR #75 committed two stale test fixtures into the epic store, and one now shadows a real epic

**Severity:** high
**Status:** open

## Details

SYMPTOM. read_epic EPIC-0034 returns:

    title: "Phase 7: HQ rollout — Fix #42 + integrate w/ PR #99"
    summary: "Track work after #100 milestone; uses tags: [a, b]"

That is not an epic. It is a test fixture for the parse/dequote work — the
"#42", "PR #99", "#100" and "tags: [a, b]" are there to exercise yaml quoting
and array rendering. The real EPIC-0034 is "Plan D rollout: HQ multi-tenant
SaaS + daemon port fix", and it is now unreachable by id.

WHAT HAPPENED. Two fixture epics, created 2026-05-23 06:57:54 and 06:58:53 —
fifty-nine seconds apart, identical but for the id — sat uncommitted in the
working tree for nearly four months. PR #75 swept them into git:

    EPIC-0033-phase-7-hq-rollout-fix-42-integrate-w-pr-99.md   added by d91a919
    EPIC-0034-phase-7-hq-rollout-fix-42-integrate-w-pr-99.md   added by f1bb428

Both ids were already taken by real epics committed in cbd6f63:

    EPIC-0033  Daemon data layer: multi-tenant Supabase project-intelligence store
    EPIC-0034  Plan D rollout: HQ multi-tenant SaaS + daemon port fix

WHICH ONE WINS IS DECIDED BY THE FILENAME. Verified by reading both ids back:

    read_epic EPIC-0033  ->  the REAL epic   (daemon-data... sorts before phase-7)
    read_epic EPIC-0034  ->  the FIXTURE     (phase-7...   sorts before plan-d)

Nothing about recency, content or correctness decides it — only where the slug
falls alphabetically. EPIC-0033 survived by luck of the letter 'd'.

WHY IT MATTERS. EPIC-0033 is the ADR-0007 multi-tenant store epic and EPIC-0034
is the Plan D rollout; both are live strategy, and one of them now answers as a
test fixture with an empty acceptance list. Worse, commit b6587bf in this same
PR ran auto_link against EPIC-0034 — so a real commit is now recorded against
the fixture, and the audit trail points at the wrong artifact.

This is also the ISS-0158 duplicate-id family resurfacing from a new direction.
The allocator race was fixed; this did not need a race. A file holding an id can
sit outside git indefinitely, and nothing checks for a collision at commit time
or at read time. The reader simply returns the first match and says nothing.

FIX:
1. Delete the two fixture files. They are test data, they were never meant to be
   committed, and neither has content worth keeping.
2. Re-run auto_link for b6587bf/f1bb428 against the real EPIC-0034.
3. Make the reader refuse to guess: two files claiming one id is a conflict, and
   read_epic should say so rather than silently returning whichever sorts first.
   This is the same rule the store reads already follow — a read that cannot
   give a unique answer must not pretend it did.
4. Consider a scan check for duplicate ids across the epic and issue stores;
   sentinel scan already walks these directories.
