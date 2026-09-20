---
id: EPIC-0039
projectId: decibel-tools-mcp
title: "Project-intelligence projector: git authoritative, Supabase a rebuildable projection"
summary: "Mirror sentinel issues/epics and architect ADRs from the git-authoritative .decibel store up to HQ's Supabase tables, as a projection that can always be rebuilt from the repo. Supersedes EPIC-0033, whose acceptance criteria encode the opposite shape (SupabaseStore replacing the fs writer). Ben's decision 2026-09-19: git is authoritative, Supabase is a projection. Cross-repo with decibel-hq; contract agreed with the HQ peer 2026-09-19 and recorded as a note on this epic."
status: planned
priority: high
tags:
  - projector
  - supabase
  - cross-repo
  - hq
  - identity
owner: ""
squad: ""
created_at: 2026-09-20T01:42:40.376Z
updated_at: 2026-09-20T01:43:05.159Z
---

# Project-intelligence projector: git authoritative, Supabase a rebuildable projection

## Summary

Mirror sentinel issues/epics and architect ADRs from the git-authoritative .decibel store up to HQ's Supabase tables, as a projection that can always be rebuilt from the repo. Supersedes EPIC-0033, whose acceptance criteria encode the opposite shape (SupabaseStore replacing the fs writer). Ben's decision 2026-09-19: git is authoritative, Supabase is a projection. Cross-repo with decibel-hq; contract agreed with the HQ peer 2026-09-19 and recorded as a note on this epic.

## Motivation

- hq.sentinel_issues (641 rows) and hq.architect_adrs (9 rows) both stopped at max(updated_at) 2026-05-25 — HQ's /issues and /architecture have served a four-month-old one-shot import ever since.
- EPIC-0033's shape is superseded. It reads as 'SupabaseStore replaces FsStore for the hosted path'; under Ben's decision the fs writer stays and Supabase becomes a mirror.
- FsStore is not the writer and never was — src/store/ is unreachable from live code. The live writers are FsIssueRepository (via tools/sentinel.ts) and tools/architect.ts, which writes ADRs with its own fs calls. Any design that hooks FsStore runs never.
- Most writes do not happen in the daemon. ~/.claude.json registers decibel-tools as a stdio server, so every Claude Code session writes in its own process. A post-write hook inside the daemon would miss nearly every write an agent makes in an editor session.
- X-Org-Key is already accepted in httpServer and threaded to ctx.orgId (kernel.ts:64), and consumed by nothing.

## Outcomes

- Every issue, epic and ADR write is mirrored to hq.* rows, idempotently, without the git write ever being able to fail because the mirror did.
- The projection is rebuildable from the repo alone — a full reconcile reproduces it from nothing.
- Records carry a stable identity that survives a rename and does not collide across clones.
- HQ can show honest staleness instead of hiding it, as the May import did.

## Acceptance Criteria

- [ ] Write path appends to a durable local JSONL queue: any process, no credential, one append, no network on the write path.
- [ ] The daemon drains the queue with service_role and upserts to hq.*; a projector failure logs and retries and never fails the git write.
- [ ] Identity is uid when present, source_key when not, and never the ISS-NNNN label. Both paths are first-class — uid coverage is 204/206 in this repo but 21/325 in senken, so the fallback is the majority path.
- [ ] ADRs are minted uuid v7 uids written back into the files, committed and reviewable. No derived uids: a per-read derivation makes two readers disagree and a stem-derived one collides exactly where stems already collide.
- [ ] Cross-format duplicate pairs are collapsed BEFORE minting. Minting first freezes one logical record into two permanent distinct identities that nothing downstream can rejoin.
- [ ] Reissued-number groups are NOT merged — senken's ISS-0130 is three unrelated issues, and this repo has two different ADRs both claiming ADR-0004. Each gets its own uid.
- [ ] A periodic full reconcile walks the store and tombstones rows it did not see. The event stream buys freshness; only the reconcile buys correctness, because a git pull emits nothing, a hand edit emits nothing, and git rm emits nothing.
- [ ] Idempotency: upsert on the stable key, last-writer-wins on the record's own updated_at, so backfill and live writes cannot fight and an at-least-once drain is a no-op on replay.
- [ ] Backfill across all 15 projects, both .md and .yml, run only after the identity work lands.
- [ ] Step one scope: sentinel issues + epics + architect ADRs, single org, no tenancy or RLS changes on this side.

## Note (2026-09-20T01:43:05.159Z)

### Queue envelope v1 — the contract

HQ builds its column mapping from this. Changing it is a breaking change on both sides.
JSONL, one object per line, append-only, atomic append.

```json
{
  "v": 1,
  "kind": "issue" | "epic" | "adr",
  "op": "upsert" | "delete",
  "project_id": "decibel-tools-mcp",
  "identity": { "uid": "01a0ba14-...", "source_key": "ISS-0177-the-project-walk-up" },
  "record_updated_at": "2026-09-20T00:07:33.650Z",
  "payload": { },
  "emitted_at": "2026-09-20T00:07:33.700Z",
  "emitted_by": { "pid": 41978, "transport": "stdio" | "daemon", "host": "..." }
}
```

- `identity` always carries both keys; `uid` may be absent. Upsert on uid when present, else
  source_key. Never key on the ISS-NNNN label.
- `record_updated_at` is the RECORD's, read from the file — not the row's. HQ carries it in
  its own column so last-writer-wins never compares row times.
- `project_id` is the RESOLVED daemon registry id, not the directory name. Resolution has
  seven strategies and one of them returned $HOME with an id of basename(HOME) until
  2026-09-19 (ISS-0177). Emit what resolved, not what was guessed.
- Drain is at-least-once. The same line may arrive twice; the upsert makes that a no-op.
- `op: delete` is close to decorative — the writer never sees a git rm. Tombstoning is the
  reconcile's job, not the event stream's.

### HQ-side commitments (theirs, drafted, not applied to Core without Ben)

- `record_uid text` nullable, partial unique on (org_id, project_id, record_uid) where not
  null; `record_updated_at timestamptz` carrying the file's own value. source_key column and
  its existing unique stay for the fallback path.
- `projection_seen_at` per row so the reconcile can tombstone anything not seen in the last
  full walk; `last_reconcile` per project so the UI shows staleness honestly.
- Remove the hardcoded DECIBEL_ORG_ID fallback once the daemon supplies org_id.
- Upload is a direct PostgREST upsert under service_role for step one. service_role bypasses
  RLS entirely, so the daemon is the only thing between a wrong org_id and a cross-tenant
  write. Moot at one org; revisited at two, where a function boundary carries per-writer
  org validation. To be written into an HQ ADR.

### Sequencing — the order is load-bearing

1. Collapse cross-format duplicate pairs (same id as .yml and .md — one logical record
   written twice across the format cutover).
2. Mint uids and write them back, committed.
3. Backfill.

Doing 2 before 1 freezes a duplicate into two permanent, stable, DIFFERENT identities, and
nothing downstream can ever tell they were one thing. The same operation is correct for
reissued-number groups, which must NOT be merged. Order decides which.

### Credits

The 6% uid-coverage number that inverted the identity weighting came from the senken peer,
unprompted, after I had generalised from this repo's 99%. The two-kinds split of duplicate
groups — dedupable cross-format pairs vs genuinely distinct reissued numbers — is also
theirs, and it is what makes the sequencing non-obvious.
