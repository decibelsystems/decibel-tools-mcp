---
id: ISS-0129
projectId: decibel-tools-mcp
severity: high
status: open
created_at: 2026-08-20T01:09:54.571Z
priority: high
updated_at: 2026-08-20T04:29:52.138Z
---

# close_issue corrupts bare-YAML issue records by appending a markdown Resolution section

**Severity:** high
**Status:** open

## Details

Root cause of the ~85 degraded issue records found while fixing the list_issues .yml blindness.

close_issue appends a markdown block to the record file:

  ## Resolution

  <prose>

That is correct for .md records (frontmatter + markdown body), but issue records also exist as BARE YAML (.yml/.yaml, no --- fence). Appending markdown to bare YAML produces a file that is no longer valid YAML:

- prose with no colon  -> "Implicit map keys need to be followed by map values"
- prose with a colon   -> "Nested mappings are not allowed in compact mappings"
- prose that happens to look like `key: value` -> parses SILENTLY, injecting a junk top-level key into the record

Before the reader fix, any record hit by this vanished from list_issues entirely. The reader now salvages the YAML region above the first markdown heading and flags the record `degraded: true` (reported via degraded / degraded_files on list_issues), so these are visible again — but the files on disk are still corrupt and the writer still corrupts new ones.

Measured degraded counts after the reader fix:
  frontend_v0.2         43
  senken-trading-agent  29
  decibel-tools-mcp     10
  deck                   3

Fix needed in closeIssue: detect record format. For bare-YAML records, write the resolution into a YAML field (e.g. `resolution: |-`) instead of appending a markdown section. Ideally also add a one-shot repair pass that rewrites already-corrupted files.

Related: 3 files remain fully unparseable even after salvage and are reported as malformed —
  senken: EPIC-0004-startup-hardening.yml (duplicate `id:` keys: ISS-0180 and EPIC-0004),
          ISS-0008-implement-db-guardian-module-with-schema-check.yml,
          ISS-0058-gunicorn-config-bypass-signalworker-never-started.yml
  frontend_v0.2: ISS-0116-pol-0002-drift-20260701.yml

[2026-08-20] CONFIRMED SECOND SYMPTOM — same root cause, and it inflates every open count.

closeIssue is fence-dependent. src/tools/sentinel.ts:853:

  content.replace(/^(---\n[\s\S]*?)status: \w+/m, `$1status: ${newStatus}`)

The regex requires a leading `---`, so on a bare-YAML record the status rewrite silently no-ops. The closed_at insertion (line 859-869) is fence-anchored too and also no-ops. But the resolution append (line 887) has NO fence guard and always fires. Net effect on bare-YAML records: the file gets a `## Resolution` markdown block appended (corrupting the YAML) while `status:` stays `open` — and close_issue returns success.

Evidence — records carrying a Resolution block that are still open, and how many of those are bare YAML:

  project                res_blocks  still_open  bare_of_those
  decibel-tools-mcp          50          15           15
  senken-trading-agent       99          43           43
  frontend_v0.2              80          33           33
  deck                       18           4            4
  machina                    73           9            0

Exact 1:1 in every project. machina's records are all fenced, so its status rewrites worked — that is the control case.

CONSEQUENCE FOR PLANNING: open counts are inflated by resolved-but-unclosed records. After the reader fix, subtract these before treating an open count as backlog:
  decibel-tools-mcp  107 open -> ~92 genuine
  senken             203 open -> ~160 genuine
  frontend_v0.2      366 open -> ~333 genuine
  deck                93 open -> ~89 genuine

FIX SCOPE — two parts, separable:
1. Writer: make closeIssue format-aware. For bare-YAML records, rewrite `^status:` / `^closed_at:` at column 0 and write the resolution as a YAML field (`resolution: |-`) instead of appending a markdown section. Stops new corruption; no data migration.
2. Repair pass: flip the ~95 already-affected records to closed and convert their markdown Resolution blocks into YAML fields. This is a data migration across 15 projects including a live trading repo — needs explicit sign-off, and EPIC-0004-startup-hardening.yml (duplicate `id:` keys) must be resolved by hand first.

Credit: symptom inferred by the machina peer from senken's ISS-0105 (Resolution block present, status still open); mechanism and blast radius confirmed here.

[2026-08-20] CONTROL CASE VERIFIED FROM THE OTHER DIRECTION.

The model predicts that where records are fenced, the old writer worked, so any remaining resolved-but-unclosed records there must be human, not tool damage. machina (73 Resolution blocks, 0 bare, 9 still open) was checked record by record by the machina peer: all 9 are from the early duplicate-id cohort — ISS-0001, 0002, 0003, both ISS-0004s, 0005, 0006, 0007, 0018 — all old UI work, ordinary stale-opens.

So: fenced project -> 9 human stale-opens. Bare projects -> 15/43/33/4, every one of them bare. That rules out the competing hypothesis that fenced records were also affected and simply less visible, and confirms the fence-anchored regex is the discriminating variable.

Side benefit noted by machina: closing those 9 also clears most of machina's duplicate-id collisions in the same pass — cheap cleanup, unrelated to this fix.

[2026-08-20] SEVERITY EVIDENCE FOR THE DEFERRED REPAIR MIGRATION — two P0-class incidents where the answer was already written down and unreachable.

From the senken-trading-agent peer, both measured on their repo:

1. ISS-0105 (status open, invisible) documented the exact failure mode of a live price-feed P0 — governed call timing out on a critical path — and prescribed the exact remedy (bypass the governor, read through SharedExchangeStateCache). The session re-derived both from logs and git archaeology during the outage.

2. ISS-0160 (2026-01-13, status open, priority high, invisible) documented "V3 bots don't auto-start on deploy - DB shows running but engines dead", including root cause 3 ("no mechanism to detect DB says running but engine is dead") and fix option 3 ("bot state sweep should detect and fix this mismatch"). Senken then suffered a 46-hour total trading outage from 2026-08-16 with precisely that signature. It was refiled fresh as ISS-0264 and fixed in 3d3240b7 — which is ISS-0160's fix option 3, written seven months earlier.

Framing: this is not "list_issues under-reports". The tool systematically hid a project's own incident post-mortems from the sessions triaging its incidents.

REFINED OPEN-COUNT SPLIT (senken, independently reproduced here — identical numbers):
  open .yml records                                     155
  writer-corrupted (col-0 Resolution/Fix heading)        42
  human stale-open (indented heading in description)      7
  genuine backlog                                       106

So senken's honest backlog is ~106, not the 203 the fixed reader reports and not the 49 the broken reader reported. About a third of the newly-visible open set is already done.

The 7 human stale-opens are a DIFFERENT population: no tool migration touches them, they need manual closing. Do not fold them into the repair scope.

DELTA RESOLVED — and it validates a design decision. My earlier count of 43 vs senken's 42 is not a heading-variant miss. Counting col-0 Resolution/Fix + open by extension and fence state in senken:
  42  .yml  BARE
   1  .md   BARE     <- the 43rd
   3  .md   FENCED   <- writer worked; these are human stale-opens
Extension does NOT determine format: a .md file can be bare YAML. Both the reader salvage and the closeIssue writer fix key on content (/^---/), not on extension, which is why they handle that file correctly. Any repair migration must do the same — selecting files by extension would miss it and would misclassify the 3 fenced ones.
