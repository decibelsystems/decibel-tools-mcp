---
uid: 01a0bc5a-d994-7c40-b89a-2525f1119455
id: ISS-0181
projectId: decibel-tools-mcp
severity: med
status: open
priority: medium
tags:
  - sentinel
  - writer-reader-drift
  - silent-wrong-answer
  - peer-reported
  - integrity
created_at: 2026-09-20T01:07:45.684Z
---
# Integrity counts are computed on every read and surfaced to nobody, so a store degrades in silence

**Severity:** med
**Status:** open

## Details

SYMPTOM. A third of an issue store can sit in `degraded` indefinitely and nothing
ever says so. Reported by the senken peer 2026-09-19: running a YAML parser over
.decibel/sentinel/issues by hand found 30 of 172 .yml files unparseable. Through
the live tools the same directory reports 3 malformed / 53 degraded — and reports
it only inside the list_issues payload, where nothing looks.

    "Worth knowing that a third of a store can sit in degraded indefinitely
     without anything surfacing it; I only saw it because I ran a parser over
     the directory by hand."

Nobody should have to run a parser by hand to learn that a third of their store
is half-read.

WHAT EXISTS. listRepoIssues() already computes integrity() and returns
`malformed`, `malformed_files`, `degraded`, `degraded_files`, `duplicate_ids`,
`duplicate_id_files` on the output. The information is correct and complete. It
is also invisible: an agent reads `.issues` and never the sibling keys, and no
hook, digest or next_actions ranking consults them.

WHY THIS IS THE SAME BUG AS THREE OTHERS. Writer/reader drift: the write
succeeds, the reader returns less than the file holds, and the failure is a
confident wrong answer rather than an error. See ISS-0168 (resolution silently
overwritten), ISS-0177 (HOME silently resolved as a project), ISS-0179 (hooks
silently following a dead port). The salvage-rather-than-reject decision in the
codec is right — a degraded record is still readable and dropping it would be
worse. But salvage without a nag is just a slower silence.

CONSEQUENCE. A store degrades monotonically. Every list_issues call knows, and
every caller is told nothing, so the first person to find out is whoever runs a
parser by hand or notices a count that cannot be right.

SUGGESTED FIX. Surface the integrity counts where someone will see them:
- session-init digest already prints one line per project; add degraded/malformed
  counts when non-zero. It is the one place every session already reads.
- oracle next_actions should rank a degraded store as work, since it is.
- Consider a threshold: n degraded records is a finding, not a footnote.

Do NOT change the salvage behaviour. The decoder tolerating what a strict parser
rejects is the feature; the gap between 30 unparseable and 3 malformed is that
feature working. The defect is only that nobody is told.
