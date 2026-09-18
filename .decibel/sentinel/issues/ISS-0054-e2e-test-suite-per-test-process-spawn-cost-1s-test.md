---
uid: 019dd7ee-8644-7205-a461-e74994efc654
id: ISS-0054
projectId: decibel-tools-mcp
status: open
priority: low
tags:
  - testing
  - performance
  - tech-debt
created_at: 2026-04-29T06:30:26.628Z
updated_at: 2026-04-29T06:30:26.628Z
---
# E2E test suite per-test process spawn cost (~1s/test)

**Status:** open

## Details

## Context

Code review of branch `fix/e2e-tests-and-deps-audit` (PR #12) flagged
the per-test spawn cost in `tests/e2e/stdio.test.ts`. Each of the 6
e2e tests spawns a fresh `node --import tsx src/server.ts` (~700-1000ms
cold), with the two new regression tests pushing total e2e runtime to ~7.5s.

## Why it was deferred

Current isolation model gives each test its own tmp `DECIBEL_PROJECT_ROOT`
via `createTestContext()`, so a long-lived shared server can't see
per-test data dirs. Architectural change required to address.

## Possible approaches when revisited

1. Share a single server across tests, pass per-test `projectId` as a
   parameter on each tool call instead of via env (server already supports
   project resolution from explicit projectId per `projectRegistry.ts`).
2. Use vitest's `forks` pool with shared worker fixtures.
3. Pre-compile via `tsc` once and run `node dist/server.js` in the
   tests instead of `tsx` cold-start (eliminates the dominant cost).

## Severity

Low. Suite runs in ~8s total which is acceptable; this is preventative
hygiene if the suite grows past ~20 e2e tests.

## Source

Identified by /decibel-review on PR #12 commit 96d0efc (2026-04-28).
