---
uid: 019e4240-bf00-79e0-80b2-2b96cc3912f9
id: ISS-0107
projectId: decibel-tools-mcp
severity: med
status: open
tags:
  - pr-review
  - governance
  - follow-up
created_at: 2026-05-19T22:00:00.000Z
---

# PR review open questions — 2026-05-19 batch

**Severity:** med
**Status:** open

## Summary

Catalog of review items raised on PRs #12, #14, #17, #21 that cannot be resolved by code inspection alone. Filed as a single tracker so the open questions don't get lost between PR threads. Full content in `docs/PR-REVIEW-OPEN-QUESTIONS-2026-05-19.md`.

Two items were resolved by code inspection during cataloging and are noted in the doc for traceability:
- PR #14 "pre-existing test failures" — were resolved when PR #15 merged
- PR #14 "IssueSummary daemon shape assumption" — workflow.ts uses only `id/title/status`; non-breaking

## Outstanding items requiring your input

### Design judgment (PR #14)

1. **safeParseYaml as consolidation target** — light bridge vs. heavier route-everything-through-sentinelIssues. Tradeoff: scope vs. cleanliness. Current PR took the lighter path and filed the heavier as separate.
2. **Cross-import `sentinel.ts` → `sentinelIssues.ts`** — bridge vs. coupling. Need explicit acceptance of the bridge OR an alternate (invert dependency / shim layer).

### Governance (PR #17 — policy_codify RFC)

3. Tool shape — composite (`policy_codify` covering full lifecycle) vs. narrow (separate `policy_codify`, `policy_promote`, etc.)
4. Scope — codification only vs. broader policy lifecycle
5. Phasing — MVP-first vs. general schema first
6. Phase 1 owner

### Manual verification (could be future automation)

7. **PR #12** — Manual MCP-client smoke test before merge (real Claude Code/Cursor session against `dist/server.js`)
8. **PR #21** — HQ Dispatch button shows real jobs after merge + daemon restart
9. **PR #21** — Agent reads queued YAML, transitions running, executes, writes output

## Suggested follow-up issues

If items 7–9 are worth automating later, three separate issues for:
- Automated MCP-client smoke test in CI (closes gap left by current e2e suite)
- HQ Dispatch integration test (needs HQ test harness)
- Mock-agent end-to-end for agentic-dispatch (deterministic queue lifecycle test)

## Source PRs

| PR | Title | Status |
|---|---|---|
| #12 | fix: repair e2e tests + audit-fix runtime deps | CI green, awaiting merge |
| #14 | fix(sentinel): list_issues / list_epic_issues handle YAML-only files + surface epic_id | CI green, awaiting merge |
| #17 | docs(rfc): policy_codify tool | CI green, awaiting maintainer review |
| #21 | feat(agentic): MVP dispatch — enqueue/list_queue/cancel_job | CI green, awaiting merge + manual verify |

## Reference

- Full catalog: `docs/PR-REVIEW-OPEN-QUESTIONS-2026-05-19.md`
- Related: PR #15 (merged, the keystone fix that unblocked this batch)
