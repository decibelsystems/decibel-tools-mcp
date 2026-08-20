---
context: sentinel issue-id allocation
frequency: occasional
impact: high
status: open
source: agent
signal_count: 3
created_at: 2026-08-17T06:28:53.582Z
last_reported: 2026-08-17T06:34:19.544Z
tags: [sentinel, issue-ids, data-integrity, collision, cross-repo]
---

# sentinel create_issue allocates colliding ISS-NNNN ids — duplicate ids land silently and are only noticed later by a human. Reported by the machina peer; reproduced independently in decibel-tools-mcp, so it is a tool defect, not user error.

CONFIRMED ON DISK (decibel-tools-mcp/.decibel/sentinel/issues, 158 files): three duplicated numbers — ISS-0015 (2 .yml), ISS-0028 (2 .yml), ISS-0112 (2 .md). `sentinel list_issues` returns ISS-0112 twice with different titles. A committed file also records ISS-0120 as "renumbered from duplicate ISS-0118", i.e. this has been hand-patched before.

WHY COLLISIONS SURVIVE: the id is only a filename PREFIX and the slug differs, so two files with the same number never collide at the filesystem or git level. Nothing fails loudly — not the write, not a merge, not CI.

CONTRIBUTING MECHANISMS (multiple, not one):
1. Allocator blind spot — getNextIssueNumber (src/tools/sentinel.ts:294-322) matches `^ISS-(\d+)` on the filename, then at line 304 does `if (!file.endsWith('.md')) continue;` before reading frontmatter. Any .yml whose filename is NOT ISS-prefixed but whose frontmatter id IS ISS-NNNN is invisible to the max scan. 58 .yml files live in this dir.
2. No locking — the dir is read, max+1 computed, then the file is written. Two concurrent/burst create_issue calls both read the same max and both write. No atomic reserve.
3. Two parallel stores — sentinel.ts writes timestamp+slug .md while sentinelIssues.ts writes ISS-NNNN .yml, with independent allocators (already tracked as ISS-0105).
4. Deferred/remote writes — ISS-0112 "one-click installer" has created_at 2026-06-25 but only entered git on 2026-08-02 via an unrelated commit. Ids allocated on another clone, another machine, or replayed later by `agentic queue_sync` cannot see each other's uncommitted state.

IMPACT: ids are the primary key humans and agents use to reference work. Duplicates make read_issue/update_issue/close_issue ambiguous — they resolve to whichever file matches first — so an update or a close can silently hit the wrong issue.

sentinel create_issue allocates colliding ISS-NNNN ids — duplicate ids land silently and are only noticed later by a human. Reported by the machina peer; reproduced independently in decibel-tools-mcp, so it is a tool defect, not user error.

CONFIRMED ON DISK (decibel-tools-mcp/.decibel/sentinel/issues, 158 files): three duplicated numbers — ISS-0015 (2 .yml), ISS-0028 (2 .yml), ISS-0112 (2 .md). `sentinel list_issues` returns ISS-0112 twice with different titles. A committed file also records ISS-0120 as "renumbered from duplicate ISS-0118", i.e. this has been hand-patched before.

WHY COLLISIONS SURVIVE: the id is only a filename PREFIX and the slug differs, so two files with the same number never collide at the filesystem or git level. Nothing fails loudly — not the write, not a merge, not CI.

CONTRIBUTING MECHANISMS (multiple, not one):
1. Allocator blind spot — getNextIssueNumber (src/tools/sentinel.ts:294-322) matches `^ISS-(\d+)` on the filename, then at line 304 does `if (!file.endsWith('.md')) continue;` before reading frontmatter. Any .yml whose filename is NOT ISS-prefixed but whose frontmatter id IS ISS-NNNN is invisible to the max scan. 58 .yml files live in this dir.
2. No locking — the dir is read, max+1 computed, then the file is written. Two concurrent/burst create_issue calls both read the same max and both write. No atomic reserve.
3. Two parallel stores — sentinel.ts writes timestamp+slug .md while sentinelIssues.ts writes ISS-NNNN .yml, with independent allocators (already tracked as ISS-0105).
4. Deferred/remote writes — ISS-0112 "one-click installer" has created_at 2026-06-25 but only entered git on 2026-08-02 via an unrelated commit. Ids allocated on another clone, another machine, or replayed later by `agentic queue_sync` cannot see each other's uncommitted state.

IMPACT: ids are the primary key humans and agents use to reference work. Duplicates make read_issue/update_issue/close_issue ambiguous — they resolve to whichever file matches first — so an update or a close can silently hit the wrong issue.

## Context

**Where:** sentinel issue-id allocation
**Frequency:** occasional
**Impact:** high
**Reported by:** agent

## Current Workaround

Notice the duplicate by eye and hand-renumber the newer file (what was done for ISS-0118 -> ISS-0120). Does not scale and leaves stale references behind.

## Signal Log

- 2026-08-17T06:28:53.582Z [agent] Initial report

- 2026-08-17T06:31:11.693Z [agent] CORRECTION after reading source + machina peer report. Two mechanisms in the original entry are WRONG:

- WRONG "two parallel stores": src/tools/sentinelIssues.ts no longer exists. Commit 708f22b (2026-04-28) consolidated it and introduced getNextIssueNumber. ISS-0105 describes an already-completed convergence.
- WRONG "allocator blind to .md frontmatter": getNextIssueNumber (sentinel.ts:294-322) DOES read `id:` from every .md frontmatter (lines 304-313) and matches ^ISS-(\d+) on filenames of any extension (line 299). Real blind spot is far narrower: only timestamp-named .yml files.

DATING CORRECTION: ISS-NNNN allocation did not exist before 2026-04-28. ISS-0015 and ISS-0028 (Dec 2025) and machina's 8 pairs (Jan 2026) are PRE-ALLOCATOR legacy data, not current-code failures. Only ISS-0112 (2026-06-25 / 2026-07-11) is a demonstrated post-allocator collision.

CONFIRMED LIVE DEFECTS (verified in current source):
1. Allocation is branch/clone-local — no shared counter. Two branches or two clones mint the same number; merge never conflicts because slugs differ. Primary live cause. Machina peer hit this twice manually today.
2. list_issues (sentinel.ts:811 `if (!file.endsWith('.md')) continue`) skips ALL .yml, while the allocator (line 299) counts them. The two disagree about which ids exist, so anyone scanning list_issues for "next free id" gets a wrong answer. Machina has 43 invisible .yml issues.
3. close_issue silent false success — on a file lacking `---` delimiters both frontmatter regexes (lines 733, 739-743) no-op, the file is written unchanged, and line 785 returns status: closed. Issue reports open forever with no error. Machina reported this as a "prepend" corruption; prepend is NOT reproducible in current code, so machina may be on an older build — unresolved.
4. No atomic reserve between read-max and write. Race window is real but UNPROVEN — the 23-second repeat cited as evidence is pre-allocator.
- 2026-08-17T06:34:19.544Z [agent] FINAL — cross-session investigation with machina peer converged. Two additions that change the recommended fix:

1. NONDETERMINISM (decisive). The seenIds dedup at sentinelIssues.ts:163-165 keeps whichever twin the readdir `files` list yields FIRST. That order is filesystem-dependent, so the same id can resolve to DIFFERENT issues on different machines, or on the same machine after a re-clone. A deterministic tiebreak is therefore NOT an acceptable fix — it would only make the wrong answer reproducible. read_issue/update_issue/close_issue must THROW on an ambiguous id. Corollary: any repair tooling must match on filenames, not on ids resolved via read_issue, until that throw exists.

2. END-TO-END CONFIRMATION of the wrong-twin write. In machina, `read_issue ISS-0006` returns ISS-0006-global-keyboard-shortcuts-system.yml, and that file's body carries a resolution describing SpellCard — its twin's work. The silent drop and the resolution bleed are the same event, verified from both ends.

RETRACTED (do not chase): the reported close_issue "prepends a --- block" corruption. Peer disproved it with a before/after git diff (d13e21f -> a45fc42); the split header pre-existed the close. Real behavior confirmed instead: closeIssue inserts closed_at into the existing block and its status regex's lazy [\s\S]*? escapes past the closing --- to rewrite a `status:` line in the BODY. Combined with the delimiter-less no-op, close_issue both under-writes and over-writes depending on file shape, and returns success either way.

VERIFIED BUILD FACTS (settling an earlier mix-up): src/sentinelIssues.ts is tracked and present at HEAD dbfc525 — the two-store split is live in the shipped build. Its apparent absence was an artifact of grepping src/tools/ (wrong dir) and of dist/ containing only the compiled .js/.d.ts. Likewise `getNextIssueNumber` x2 in dist/tools/sentinel.js is definition + call site, not a duplicate function; src has exactly one at line 294.

RECOMMENDED FIX ORDER: (1) throw on ambiguous id in read/update/close; (2) reject duplicate ids at write time across BOTH stores — this also catches hand-stamped ids, which is how the peer produced the ISS-0112/ISS-0117 collisions; (3) make list_issues and the allocator agree on .yml; (4) separate pre-2026-04-28 legacy duplicates from live ones BEFORE any bulk repair.