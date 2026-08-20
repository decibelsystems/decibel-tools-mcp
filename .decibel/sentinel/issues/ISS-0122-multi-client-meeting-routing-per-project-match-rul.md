---
id: ISS-0122
projectId: decibel-tools-mcp
severity: med
status: open
created_at: 2026-08-14T19:24:50.551Z
epic_id: EPIC-0036
---

# Multi-client meeting routing: per-project match rules, sync_all fan-out, unrouted bucket

**Severity:** med
**Status:** open
**Epic:** EPIC-0036

## Details

Extend the zoom facade from single-repo (plasiv's --match plasiv) to routing an account-wide pull across every client project.

EVIDENCE: topic substring matching worked 23/23 on plasiv's meetings/raw/. Every filename contains "Plasiv" — as "(Plasiv)", "Decibel x Plasiv", and "Plasiv x Decibel", with case varying (Plasiv/plasiv). That works because Decibel schedules the calls and puts the client name in the title. It is a convention we control, not a property of Zoom — document it as an assumption. Match case-insensitively.

WHERE RULES LIVE: add an optional `zoom` field to ProjectEntry in src/projectRegistry.ts:
  { "id": "plasiv", "path": "...", "zoom": { "match": ["plasiv"], "out": "meetings/raw" } }
Optional field on the version: 1 schema and registerProject already merges entries, so this is backward-compatible with no migration.

DO NOT reuse the existing aliases[] field for matching. Aliases are how a project is addressed in a tool call (dt, dv, dd); matching meeting titles against them would have "dt" hit any title containing those two letters.

OUT PATH: default to .decibel/meetings/raw/, overridable per project via zoom.out. Client engagement repos like plasiv keep meetings/ at the repo root on purpose — it sits next to deliverables and is meant to be human-readable.

TWO ACTIONS, ONE PRIMITIVE:
- sync(project_id) — pull the account list, filter to that project's rules, write into that project. Matches every other Decibel tool's contract.
- sync_all() — one token, one list fetch, fan out to all projects with rules. This is the action that actually gets run weekly.

sync_all writes ACROSS project boundaries — a call originating in one repo writes into another. Decide whose provenance log records it. Related: the open issue on missing file-tree validation for bulk sentinel operations.

UNROUTED BUCKET (the part that matters most): a client call matching no rule must never silently vanish — that is the failure that kills trust after the third missed meeting. Unmatched summaries go to ~/.decibel/meetings/unrouted/ with topic and uuid retained, so a rule can be added after the fact.

DRY RUN: print the routing table (meeting -> project) before anything is written.

AMBIGUITY: a joint call can match two projects and genuinely belongs to both. Write to all matches, and log when it happens.
