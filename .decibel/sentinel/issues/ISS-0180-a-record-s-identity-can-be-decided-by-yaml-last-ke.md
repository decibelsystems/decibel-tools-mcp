---
uid: 01a0bc5a-d9a2-7bd7-b749-64a1b7c01fbd
id: ISS-0180
projectId: decibel-tools-mcp
severity: med
status: open
priority: medium
tags:
  - sentinel
  - codec
  - identity
  - peer-reported
  - silent-wrong-answer
created_at: 2026-09-20T01:07:45.698Z
---
# A record's identity can be decided by YAML last-key-wins, not by content

**Severity:** med
**Status:** open

## Details

SYMPTOM. Reported by the senken peer 2026-09-19:

    .decibel/sentinel/issues/EPIC-0004-startup-hardening.yml has TWO top-level
    `id:` keys — `id: ISS-0180` then `id: EPIC-0004` — so YAML last-key-wins
    decides which artifact it is. Its `project:` is `senken` rather than
    `senken-trading-agent`.

THREE DISTINCT PROBLEMS IN ONE FILE, and the first is the one that generalises.

1. DUPLICATE TOP-LEVEL KEY, SILENTLY RESOLVED. A record's identity is decided by
   parser behaviour rather than by content. Whether this file is ISS-0180 or
   EPIC-0004 depends on which key the loader keeps. Two readers with different
   parsers disagree about what the record IS. Unverified on my side: does our
   codec reject a duplicate key, or take the last one quietly? If it takes the
   last one quietly, that is a second defect and the more important one — a
   duplicate `id:`, `status:` or `uid:` should be a malformed record, loudly,
   not a coin flip.

2. AN EPIC FILED IN issues/. Both directories are read by their own readers, so
   an epic sitting in issues/ is read as an issue by one and missed by the other.

3. PROJECT ID MISMATCH. `project: senken` on a record inside
   senken-trading-agent. project_id is what routes every write, so a record
   whose frontmatter names a different project is a write pointed at the wrong
   store — see ISS-0177 for what a wrong project resolution costs.

WHY IT MATTERS BEYOND ONE FILE. Identity decided by parser behaviour is exactly
the class of thing that makes a projection unsafe: the daemon→Supabase projector
under design keys on uid with a source_key fallback, and a record whose id
depends on the loader cannot be keyed reliably by either.

SUGGESTED FIX.
1. Establish whether decodeIssue rejects duplicate top-level keys. If it does
   not, make a duplicate identity key a malformed record with a named reason.
   That check belongs in the codec, where both formats pass through.
2. The individual file is senken's to move and repair; the codec behaviour and
   the project-mismatch warning are ours.
3. Consider warning when a record's `project:` disagrees with the project it was
   resolved from — currently nothing checks.
