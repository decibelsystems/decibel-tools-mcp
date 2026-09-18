---
uid: 01a0781f-a254-78cc-9e97-fd77c43a6748
id: ISS-0158
projectId: decibel-tools-mcp
severity: high
status: closed
priority: high
created_at: 2026-09-06T19:08:54.227Z
updated_at: 2026-09-06T19:16:45.969Z
closed_at: 2026-09-06T19:16:45.877Z
resolution: "Resolved by commit 243818e: torture test: S5 concurrency, and the epic race it found"
---
# log_epic had the duplicate-id race that Phase 1 closed for issues, and its collision destroys a record rather than duplicating it

**Severity:** high
**Status:** closed

## Details

Found by the S5 concurrency sweep while building the last hard gate for 3.0.

WHAT WAS WRONG

src/tools/sentinel.ts logEpic() read the epics directory for the current maximum
(getNextEpicNumber), then wrote the file roughly twenty awaits later through
writeFileAtomic. Nothing held those two steps together — no lock, no O_EXCL. Two
concurrent log_epic calls both compute EPIC-0039.

This is the same defect EPIC-0038 Phase 1 closed for issues (allocateAndWriteIssue,
lock spanning allocation THROUGH write, plus a 'wx' write as a second defence), and
the epic path was simply never brought along.

WHY IT IS THE WORSE HALF

An issue collision left two files and a visible duplicate id — bad, detectable, and
in fact detected: four duplicate groups were found on disk and repaired in Phase 2.
An epic collision cannot leave two files, because writeFileAtomic finishes with a
rename, and a rename CLOBBERS. The loser is not duplicated; it is gone. Its caller
was already told `epic_id: EPIC-0039, location: project` and got a success envelope.

That is the exact failure shape this whole release gate exists for: ok: true over a
record that no longer exists.

FIX

- src/lib/issueIdAllocator.ts renamed to recordIdAllocator.ts and generalised over
  the record prefix. scanMaxRecordNumber/formatRecordId/allocateAndWriteRecord are
  the core; allocateAndWriteIssue and the new allocateAndWriteEpic are wrappers.
  The lock file is per record directory (.record-id.lock), which is exactly one
  lock per numbering space since issues and epics number independently.
- logEpic now builds its content in a closure taking the allocated id and writes
  through allocateAndWriteEpic, with validateWritePath passed as the allocator's
  validate hook so the path check still runs before every write attempt.
- getNextEpicNumber and formatEpicId are gone; a comment records why.

The write is now O_EXCL rather than temp-file-and-rename. That trades logEpic's
fsync for collision safety, matching what the issue path already does — and for a
NEW file the exclusive create is the property that matters.

COVERAGE

tests/torture/s5-concurrency.test.ts asserts, for issues and epics alike: 50
concurrent creates across 10 processes yield 50 distinct ids, 50 records on disk,
and every id a caller was handed present on disk. The racers are barrier-
synchronised and the sweep asserts they actually overlapped.</details>
<parameter name="tags">["torture", "concurrency", "release-gate", "sentinel", "epic-0038"]

[2026-09-06] CORRECTION to the "cannot leave two files" claim above, from running the sweep against the pre-fix code rather than reasoning about it.

The epic collision has TWO outcomes, and which one you get depends on the titles:

1. Different titles, same allocated id (what the sweep actually produced): the slug
   differs, so the paths differ, and you get two FILES claiming one id —
   EPIC-0001-racer-0-epic-0.md and EPIC-0001-racer-3-epic-0.md. 7 duplicate id
   groups out of 50 creates, and the "hands out 50 distinct ids" assertion failed
   before the on-disk one did. This is the same visible shape as the issue defect.

2. Identical titles: same slug, same path, and writeFileAtomic's rename lands both
   writes on one file. The loser is destroyed and its caller was told it was
   created. This one is read off the code path rather than reproduced — the sweep
   gives every racer a distinct title, so it exercises case 1.

So the original framing — that an epic collision destroys rather than duplicates —
is right only for the same-title case. The everyday case is duplicate ids, exactly
like issues. The fix closes both, since allocation and the O_EXCL write now happen
under one lock.</parameter>
</invoke>

## Resolution

Resolved by commit 243818e: torture test: S5 concurrency, and the epic race it found
