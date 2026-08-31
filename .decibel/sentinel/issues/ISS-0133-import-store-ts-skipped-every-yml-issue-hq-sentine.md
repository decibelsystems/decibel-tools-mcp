---
uid: 01a01da6-ec90-70cd-9ee2-22557fe83f12
id: ISS-0133
projectId: decibel-tools-mcp
severity: high
status: in_progress
created_at: 2026-08-20T05:31:13.936Z
updated_at: 2026-08-31T00:23:21.418Z
---

# import-store.ts skipped every .yml issue — hq.sentinel_issues undercounted for months (code fixed, re-import not run)

**Severity:** high
**Status:** in_progress

## Details

Found by the decibel-hq peer by diffing hq.sentinel_issues against disk, then confirmed here. This is a THIRD patch site for the .md-only filter, separate from listRepoIssues (fixed) and closeIssue (fixed). The landed reader/writer fixes do not touch it, and the data does not self-heal.

THREE DEFECTS, all in the import path:

1. scripts/import-store.ts — DOMAINS.issues had `exts: ['.md']` while DOMAINS.architect, twenty lines below, already had `['.md', '.yml', '.yaml']`. An inconsistency inside a single file, so ADRs imported correctly the whole time and issues did not.

2. src/store/markdown.ts:parseIssueMarkdown — `source_key = filename.replace(/\.md$/i, '')` stripped only .md. A .yml record would have carried its extension into source_key, colliding with any later correct import under a different key for the same issue. This also explains a diagnostic trap decibel-hq hit: querying hq.sentinel_issues for '%.yml' returns zero, which reads as "no yml ever imported" but actually means the column cannot answer the question.

3. parseIssueMarkdown required the `---` fence. Without it, it set fm={} and continued rather than failing, so bare-YAML records would import as junk rows — title falling back to the filename stem, status defaulting to 'open', severity null, and the entire YAML text landing in `details` — while reporting success. Every .yml issue record in this repo is bare, so widening exts alone would have written garbage rows and called it a fix.

MEASURED IMPACT (decibel-hq, exact filename match against disk, not inferred from counts):
  decibel-studio        25 on disk (1 .md) -> exactly 1 row. 96% invisible.
  decibel-tools-mobile  17 on disk (3 .md) -> exactly 3 rows.
  deck                  52 rows = the .md count; 55 .yml dropped.
  Same shape on decibel-vector and pokedeck.
  4 projects whose stores are 100% .yml have no hq.projects row at all — decibel-tools (12), habit-tracker (11), studio-ios (2), fuligin (1). They looked empty at onboarding.

FIXED HERE: all three. exts widened; source_key strips /\.(md|ya?ml)$/i; parseIssueMarkdown parses bare YAML, falls back to the `description` field for details, and applies the same column-0 salvage boundary the reader uses so a close_issue-appended markdown section does not break the parse.

VERIFIED: re-parsing every record from disk now yields decibel-studio 25/25, decibel-tools-mobile 17/17, decibel-tools-mcp 160/162 well-formed, zero source_key collisions.

NOT DONE — NEEDS A DECISION:
The re-import has NOT been run. It writes to Supabase with SERVICE_ROLE across 15 projects and that is Ben's call, not an agent's. It should also not be run in isolation, because decibel-hq found a second, larger defect underneath this one: every row in hq.sentinel_issues shares a max created_at/updated_at of 2026-05-25T06:30:57Z — nothing written in 87 days. That is not extension-related (decibel-hq's own store is 100% .md, 17 on disk, 4 in Supabase). decibel-hq ADR-0008 documents the importer as one-time-not-a-projector, while decibel-hq ADR-0005 puts Supabase directly in the hosted read path with no daemon — so hosted HQ has been serving three-month-stale issue data by design, and nobody reconciled the two.

So the real question is not "re-run the importer" but "does the importer become a projector", which is an ADR-0008 conversation on the decibel-hq side. Tracked there as their ISS-0001.

Related: ISS-0130 (src/store is dead code — import-store.ts turns out to be its only consumer, so it is not deletable as filed), ISS-0129, ISS-0131.

[2026-08-20] Code half shipped in 4ecad91 / 2.2.0-beta.0 (npm tag `beta`): import-store.ts exts widened to .md/.yml/.yaml, source_key strips /\.(md|ya?ml)$/i, parseIssueMarkdown parses bare YAML with the column-0 salvage boundary. Staying OPEN deliberately — the re-import against Supabase (SERVICE_ROLE, 15 projects) has NOT been run and is Ben's decision, and it should not run in isolation given the stale-since-2026-05-25 finding. Real question remains "does the importer become a projector" (decibel-hq ADR-0008 conversation, their ISS-0001). Note: commit 4ecad91 carries a `Closes: ISS-0133` trailer that overstates this — the trailer is wrong, the remaining work is the re-import decision.

[2026-08-30] 2026-08-30 — a correction, because the re-import was about to be sequenced on a wrong premise.

The decibel-hq peer reported that the markdown truncation bug (extractDetails stopping at the first '## ', fixed in #63) made this re-import dangerous, and that #63 landing first is what makes it safe. That is NOT correct, and the reason matters: THE IMPORTER DOES NOT USE THAT PARSER.

  scripts/import-store.ts:20  imports parseIssueMarkdown from src/store/markdown.js
  src/store/markdown.ts:90    details: body.trim() || asString(fm.description) || undefined

It takes the WHOLE body, never a '## Details' section, so it never had the truncation bug and #63 does not change its behaviour. The re-import was already safe from that specific failure. Two parsers for one concept again — the same shape as the epic reader (#60) and the two issue writers (#62). Check which parser a path actually reaches before reasoning about its bugs.

One real consequence of #63 the peer got right for a different reason: daemon-backed HQ routes read .decibel THROUGH this repo's codec rather than parsing files, so those DID show truncated bodies and now show whole ones, with no change needed on the HQ side.

WHAT ACTUALLY CHANGED FOR THIS ISSUE TODAY: PR #64 migrated all 58 bare-YAML records in decibel-tools-mcp to markdown, so the .md-only skip has nothing left to skip HERE. The undercount for this project is moot. It is not moot elsewhere — 473 .yml issue records remain across 14 other registered projects (senken-trading-agent 172, frontend_v0.2 124, deck 55, machina 43, decibel-studio 24, and nine more). The exts fix at import-store.ts:41 is what those depend on, and the re-import is still unrun.

So the sequencing constraint is real but it is not the one reported: the re-import needs the exts fix (landed), not #63.

[2026-08-31] 2026-08-30 — the re-import now has THREE preconditions, not one. Recording so it is not run on the assumption that 'unrun' is the only blocker.

  1. Five projects holding .yml records have no hq.projects row, so 29 records have nowhere to land and will      silently not import: decibel-tools 12, habit-tracker 11, beacon 3, studio-ios 2, fuligin 1. All five are      100%-.yml stores with zero .md, which is why they never appeared — the .md-only filter meant they never      produced a row, so nothing ever created the project. HQ-side, owned by the decibel-hq peer.

  2. 61 duplicate ISS-NNNN id groups across 5 projects (frontend_v0.2 34, senken-trading-agent 16, machina 8,      decibel-studio 2, decibel-tools-mobile 1). See ISS-0136, which I reopened after wrongly closing it on a      single-project scan.

     THE MECHANISM, and it is the important part: hq.sentinel_issues has UNIQUE(org_id, project_id, source_key),      and source_key is the FILENAME STEM. Every one of the 61 groups has DISTINCT stems, so the constraint is      fully satisfied by two rows claiming the same issue id. The uniqueness that matters is on a field the      constraint never sees. The re-import will land 61+ colliding pairs with no error. This is not theoretical:      the decibel-hq peer confirmed the identical mechanism is already live for ADR-0004, which HQ's      /architecture route renders today as one id with two records.

  3. Still unrun.

Option worth considering instead of blocking on (2): import with a composite key that includes the record id, so a collision surfaces as a constraint violation rather than two silent rows. HQ's table, HQ's call — but 'silently two rows' is the current default and is the worst of the available outcomes.

[2026-08-31] 2026-08-30 — RETRACTING precondition (2) from the note above. I over-escalated it; the decibel-hq peer pushed back and was right. Verified in their source before conceding.

The re-import has TWO preconditions, not three:
  1. the five missing hq.projects rows (HQ-side)
  2. still unrun (Ben's sequencing)

The 61 duplicate ISS-NNNN groups are NOT a precondition. Three reasons, the second decisive:

  a. HQ's issues surface never renders the id. src/routes/Issues.tsx:143 uses source_key as a React key and as      the update handle only; the visible columns are Title, Severity, Status, Epic. 61 groups import as 122      rows with distinct titles and distinct source_keys and nothing collides visually. Confirmed by reading the      component. The ADR case is NOT analogous — Architecture.tsx:152 actually renders {adr.source_key}, which      is why that one is visible.

  b. THE COMPOSITE KEY I SUGGESTED WOULD CAUSE THE HARM THIS ISSUE EXISTS TO FIX. A UNIQUE on the extracted      ISS-NNNN rejects one record from each of the 61 pairs — 61 legitimate, distinct issues silently absent.      That is under-counting, which is the entire complaint. It would also assert an invariant the source data      demonstrably does not satisfy, encoding a falsehood in a constraint. Withdrawn.

  c. The ambiguity already exists on disk and the import neither creates nor worsens it. `read_issue ISS-0015`      in frontend_v0.2 is ambiguous today with no import involved. A precondition has to be something the import      would BREAK; this is orthogonal.

The identity story is intact: source_key IS the identity and it is unique. ISS-NNNN is a LABEL that is non-unique upstream. My generalisation of the peer's source_key point was right in mechanism and wrong in consequence — the constraint guards identity correctly; it is the label that is broken, and the label is not what the table is keyed on.

ISS-0136 stays open at high priority, on its own clock, provenance-gated per project. Worth doing and worth doing sooner — every new cross-reference to an ambiguous id is another provenance edge, so it gets harder the longer it waits. It just does not hold 473 records hostage.
