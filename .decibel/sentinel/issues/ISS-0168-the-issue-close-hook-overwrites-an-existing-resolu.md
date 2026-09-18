---
uid: 01a0b674-df1a-7735-8c44-83b3ed05d07b
id: ISS-0168
projectId: decibel-tools-mcp
severity: med
status: open
priority: medium
tags:
  - hooks
  - sentinel
  - data-loss
  - silent-overwrite
  - completion-ritual
created_at: 2026-09-18T21:38:27.738Z
updated_at: 2026-09-18T21:39:03.413Z
linked_commits:
  - sha: 389263a1ad04a3b4987643a27a35dc7f4864d5fa
    shortSha: 389263a
    message: "sentinel: ISS-0168 gains its second instance, self-inflicted"
    relationship: related
    linked_at: 2026-09-18T21:39:03.413Z
    linked_by: ai:claude

---
# The issue-close hook overwrites an existing resolution with the triggering commit's subject line

**Severity:** med
**Status:** open

## Details

SYMPTOM. A `Closes: ISS-0162` trailer on commit 1e2cef2 re-closed an issue that
was ALREADY closed, and the hook replaced its resolution with the subject of the
commit that mentioned it:

    - resolution: Fixed in 167c49b. S4 now distinguishes a transient backend
      failure from a transport defect via TRANSIENT_BACKEND_SIGNATURES (closed,
      asserted list of 7 patterns), dropping a row only when a signature appears
      AND the transports diverged. Guarded by a 2% inconclusive ceiling and
      per-row reporting; calibrated in both directions including the verbatim
      3.0 payload and nine ordinary error payloads proven not to match.
      S4 26/26, suite 894/894.

    + resolution: "Resolved by commit 1e2cef2: docs+sentinel: the 3.0
      architecture note for Rich, and the three bugs the release left behind"

The same substitution happened in the body's `## Resolution` section, and
`closed_at` was moved forward to the re-close date. The replacement text is also
simply false: 1e2cef2 is a docs commit that did not fix ISS-0162 — 167c49b did,
eleven days earlier.

WHY IT MATTERS. The resolution field is the only place the reasoning behind a
fix survives outside a commit message. Overwriting it with a commit subject
turns a specific, checkable claim into a tautology ("resolved by the commit that
says it resolved it"), and it happens silently — the hook reports "closed
ISS-0162" either way. Nothing distinguishes a first close from a clobber.

The trigger was operator error (a `Closes:` trailer naming an issue that was
already closed), but the failure mode is not: a closed issue re-referenced by any
later commit loses its resolution, and re-referencing a closed issue is normal —
follow-up work cites the issue it came from.

REPRO. Close an issue with a detailed resolution. Commit anything else with a
`Closes: <that id>` trailer. Read the file.

SUGGESTED FIX (cheapest first):
1. Make the close a no-op when `status` is already `closed` — report "already
   closed" instead of rewriting. Preserves the original resolution by default.
2. If a re-close should record something, APPEND to linked_commits (which already
   works correctly) rather than replacing `resolution`.
3. Never move `closed_at` backwards or forwards on an already-closed issue.

WORKAROUND UNTIL THEN. Do not put `Closes:` on an issue that is already closed;
the hook has no way to tell that from a fresh close.

RECOVERED. ISS-0162's original resolution and closed_at were restored by hand in
the commit that files this issue; the text survived only because it was in git
history.

[2026-09-18] SECOND INSTANCE, and it is worse than the first. The commit that restored ISS-0162's resolution and filed this issue (df163a2) triggered the clobber AGAIN — its message contained no trailer at all. It contained the sentence: A `Closes: ISS-0162` trailer on 1e2cef2 re-closed an issue... The hook matched the quoted pattern inside backticks in prose and re-closed the issue, replacing the just-restored resolution with df163a2's own subject line.

So there are TWO defects, not one:

D1. The hook scans the whole commit message for `Closes|Fixes|Resolves: <id>` rather than parsing trailers — the last paragraph, in the git-trailer sense. Any commit DISCUSSING an issue reference triggers it. Writing about the mechanism operates the mechanism.

D2. Closing an already-closed issue overwrites its resolution instead of being a no-op (the original report above).

D1 alone is a correctness bug for any commit message that quotes a trailer — documentation, this issue, a fix for this issue. D1 + D2 together mean the act of documenting the problem destroys the evidence of it. The restoration only survived because the third attempt deliberately avoided writing the pattern in prose.

FIX FOR D1: parse trailers properly — only the final contiguous block of `Key: value` lines at the end of the message, per git-interpret-trailers. A line inside a paragraph, inside backticks, or indented as a quote is not a trailer.
