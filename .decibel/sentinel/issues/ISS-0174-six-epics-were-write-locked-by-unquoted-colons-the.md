---
uid: 01a0b719-239f-74ed-a891-6de890466600
id: ISS-0174
projectId: decibel-tools-mcp
severity: high
status: open
priority: high
tags:
  - sentinel
  - epics
  - yaml
  - writer-reader-drift
  - data-repair
  - silent-failure
created_at: 2026-09-19T00:37:53.183Z
---
# Six epics were write-locked by unquoted colons the reader tolerates and every writer rejects

**Severity:** high
**Status:** open

## Details

SYMPTOM. link_commit on EPIC-0034 failed:

    Nested mappings are not allowed in compact mappings at line 4, column 8:
    title: Plan D rollout: HQ multi-tenant SaaS + daemon port fix ...

read_epic on the same file had just returned it perfectly, with full title,
summary, motivation, outcomes and acceptance criteria.

CAUSE. Free-text frontmatter fields were written unquoted while containing
`: ` — which YAML reads as a nested mapping, not as text. Six epics carried it,
all in `summary:`, four also in `title:`:

    EPIC-0020, EPIC-0021   "...payloads into ..."
    EPIC-0024             "Enable Decibel Tools across major AI platforms: Cursor, ..."
    EPIC-0026             "Complete architectural overhaul of decibel-tools-mcp: ..."
    EPIC-0033             "Make the daemon/MCP serve ... (oracle/sentinel/...)"
    EPIC-0034             'Session arc: a deck-web "daemon unreachable" report ...'

EPIC-0034's summary also contains embedded double quotes, so any repair has to
escape rather than merely wrap.

WHY IT WENT UNSEEN. This is the writer/reader drift shape again, with the
polarity that hides longest: the READER is lenient and the WRITER is strict.
Every read path — read_epic, list_epics, the digest, oracle — returned these
epics correctly, so nothing looked wrong for months. Only a write touched the
real parser, and writes to old epics are rare. list_epics still reports
store_status ok and unreadable_count 0, because nothing ever asked the store
whether it could be written back.

An epic in this state is readable, quotable and completely frozen: no
link_commit, no update_epic, no status change, no note.

FIXED (data). All six repaired by quoting the affected fields with proper
escaping; all epic frontmatter now parses, verified with a real YAML parser
rather than with the tool that wrote it. Issues were checked too — zero
affected, so this is an epic-writer defect, not a store-wide one.

STILL OPEN (code). The writer that produced these lines. Newer epics come out
correctly quoted, so log_epic was fixed at some point (the 2026-05-23 fixtures
are quoted) and the older records were never migrated — but no test pins it,
and nothing prevents the next free-text field from reintroducing it.

WHAT TO ADD:
1. A round-trip test: write an epic whose title and summary contain `: `, a
   `#`, and embedded quotes, then parse the file back with a strict YAML parser
   — not with the reader, which is what let this hide.
2. Make the store's health check answer "can this be written back", not only
   "can this be read". unreadable_count is currently blind to it.
