---
uid: 01a0bc5c-ae98-7fae-8b47-6a5ab770852a
id: ISS-0182
projectId: decibel-tools-mcp
severity: med
status: open
priority: medium
tags:
  - sentinel
  - id-allocation
  - duplicate-ids
  - git
  - silent-wrong-answer
  - self-inflicted
created_at: 2026-09-20T01:09:45.752Z
---
# Issue ids are allocated from the working tree, so two branches hand out the same number

**Severity:** med
**Status:** open

## Details

SYMPTOM. Two issues filed from a feature branch were allocated ids that main had
already assigned. Observed 2026-09-19, self-inflicted and reproducible:

  1. ISS-0179 (daemon.meta hijack) was filed on branch iss-0168-preserve-resolution
     and merged to main.
  2. Branch iss-0179-daemon-meta had been cut from main BEFORE that merge, so its
     working tree contains no ISS-0179.
  3. create_issue from that branch scanned the directory, saw max = ISS-0178, and
     issued ISS-0179 to a completely different issue. Then ISS-0180.

Two different issues carrying ISS-0179, created eleven minutes apart, by the same
tool, on the same machine.

CAUSE. scanMaxRecordNumber (src/lib/recordIdAllocator.ts) derives the next id from
`fs.readdir` of the issues directory — max over the filename prefix and the
frontmatter id. That is the correct scan of the wrong universe: a working tree is
BRANCH STATE, not the project's history. Records committed on any other branch are
invisible to it, so two branches cut from the same base will confidently allocate
the same next id, and neither can detect the other.

WHY THE EXISTING PROTECTION DOES NOT COVER THIS. allocateAndWriteIssue already
handles the cross-PROCESS race, and there is a test for it ("assigns distinct ids
when separate processes allocate simultaneously"). That is a lock over one
directory at one instant. No lock can see a commit on another branch — the
conflicting record does not exist on disk at allocation time and may not exist
anywhere yet. Different failure, different fix.

WHY IT MATTERS. This is a plausible mechanism behind ISS-0136's 61 duplicate-id
groups across five projects, and it fires exactly when a project is busiest:
several branches open at once is the normal shape of active work. It is silent —
the allocator has no way to know it was wrong, and the collision surfaces only when
the branches merge, by which point both records exist and read_issue on that id is
ambiguous.

It is also now load-bearing beyond this repo: the daemon->Supabase projector under
design keys on uid with a source_key fallback, and a label reissued across branches
is precisely the case that makes label-keying unsafe. uid does not collide here —
both records got distinct uuid v7s — so the projector is not broken by this. The
human-facing id is.

WHAT I DID THIS TIME. Renumbered by hand to ISS-0180/ISS-0181 after noticing the
merged main had moved. Noticing was luck: I happened to diff against origin/main.

POSSIBLE FIXES, none obviously right, which is why this is a report and not a patch:
- Allocate from git history rather than the working tree: `git log --all --diff-filter=A`
  over the issues dir gives every id ever created on any branch. Slower, and wrong
  for records never committed.
- Keep a committed high-water mark file, and treat it as append-only. Merge
  conflicts on it become the collision signal, which is a feature — git is good at
  exactly that.
- Accept collisions and lean on uid as the real identity, demoting ISS-NNNN to a
  display label. This is closest to where the projector design already landed, and
  the honest version of what the id already is.
- Warn at allocation time when HEAD is not the default branch and the default
  branch has records this tree does not.

RELATED: ISS-0136 (duplicate id groups), and the uid-vs-source_key identity work
for the projector.
