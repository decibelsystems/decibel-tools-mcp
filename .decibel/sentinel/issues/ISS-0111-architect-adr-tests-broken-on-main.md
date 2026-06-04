---
id: ISS-0111
projectId: decibel-tools-mcp
severity: high
status: closed
closed_at: 2026-06-02T19:58:12.000Z
closed_reason: "fixed: tests realigned to .md ADR format via parseAdrContent uniform reader; legacy .yml round-trip covered"
created_at: 2026-06-02T19:36:47.000Z
tags: [tests, architect, regression, ci-blocker]
---

# 8 tests broken in tests/unit/architectAdrs.test.ts on main

**Severity:** high
**Status:** open

## Symptom

`npm test` on clean main fails 8 of 10 tests in `tests/unit/architectAdrs.test.ts`. Confirmed pre-existing — not introduced by any open PR. Discovered while landing PR #36 (ISS-0102 fix); verified by stashing the change and running the suite.

Example failure:
```
should create a new ADR with auto-generated ID
AssertionError: expected '/tmp/decibel-mcp-test-FSRfrV/.decibel…' to contain 'ADR-0001-use-postgresql-for-persisten…'
```

Subsequent failures show YAML parse errors:
```
❯ parseDocument node_modules/yaml/dist/public-api.js:50:29
❯ Proxy.parse node_modules/yaml/dist/public-api.js:68:17
❯ tests/unit/architectAdrs.test.ts:89:22
```

## Likely cause

Almost certainly fallout from PR #33 (`feat/multi-tenant-store`) — that PR added the `Store` abstraction (FsStore / SupabaseStore) and refactored the ADR/sentinel/friction/oracle write paths. The test file's expectations of how ADRs are created and what they contain have drifted from the new code path.

## Effect

- CI is red on every new PR (PR #36 is currently affected)
- New PRs look like they introduced failures when they didn't
- Erodes the "green build" signal that's been carefully maintained over the recent session

## Proposed fix

1. Read `src/architectAdrs.ts` to understand the post-PR#33 contract (path format, YAML shape, return type)
2. Update `tests/unit/architectAdrs.test.ts` assertions to match the current behavior — same approach as the stale-test PRs from earlier in May (PR #15)
3. If the YAML parse error indicates a real bug (not just a stale test), fix the source instead

**Effort**: ~1–2 hours
**Risk**: low — pure test alignment

## Discovered during

PR #36 CI run (ISS-0102 fix). Not blocking this PR's merge — the failures are demonstrably pre-existing — but PR #36's CI will show red until this lands.
