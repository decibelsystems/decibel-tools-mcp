# Open Review Questions — 2026-05-19 PR Batch

Catalog of review items raised on PRs #12, #14, #17, #21, split into items already resolved by code inspection vs. items that require human judgment, governance, or test infrastructure that doesn't yet exist.

Context: PR #15 merged earlier today and unblocked CI for every other open PR. As part of bringing six downstream PRs back to green, a number of review questions surfaced. Some were code-answerable; others are decisions or manual verification steps that cannot be automated.

---

## Already resolved (no action needed)

These were resolved by reading the code directly. Logged for traceability so future reviewers don't re-raise them.

### PR #14 — Are the 2 pre-existing test failures (createIssue slug expectations) real?

**Answer**: No. All 253 tests pass on the PR #14 branch as rebased onto current `main` (post-#15). The failures referenced in the original PR comment were the same stale assertions that PR #15's body called out — they were resolved when PR #15 merged.

**Evidence**: `npm test` on `pr-14` after rebase: `Tests  253 passed (253)`.

### PR #14 — Do IssueSummary field additions break the daemon?

**Answer**: No. Strictly additive, no consumer assumes a narrow shape.

**Evidence**:
- Only external consumer is `src/tools/workflow.ts:606–617`, which reads only `i.id`, `i.title`, `i.status`.
- `SentinelIssue` (defined in `src/sentinelIssues.ts:14–27`) carries an `[key: string]: unknown` index signature, so extra fields are accepted by every consumer by construction.
- PR #14 surfaces `epic_id` on `IssueSummary`; nothing in the daemon predicates on the absence of that field.

---

## Cannot be automated — needs your input

These are genuine human-in-the-loop items. The first two clusters are governance/design judgment; the third is manual verification against UI or runtime infrastructure that doesn't have a test harness yet.

### Design/architecture judgment

#### PR #14 — Is `safeParseYaml` the right consolidation target?

PR #14 took the lighter consolidation (a shared YAML-parse helper) rather than the heavier refactor (route everything through `sentinelIssues.ts` and delete the older path). PR description filed the heavier direction as a separate follow-up.

**Tradeoff**:
- *Light (current PR)*: keeps two CRUD paths alive, adds one bridge function. Lower risk, smaller diff, but the duplication remains.
- *Heavy (filed separately)*: single CRUD path, no bridge, but a larger touch surface and probable test churn.

**Decision needed**: confirm the current scope is correct for this PR and that the heavier consolidation belongs to its own issue.

#### PR #14 — `src/tools/sentinel.ts` now imports `../sentinelIssues.js`. Acceptable bridge or unwanted coupling?

This is the first cross-import between the two co-existing CRUD paths. It's the natural consequence of the "light consolidation" decision above.

**Options**:
- Accept as a transition bridge until the consolidation lands.
- Invert the dependency (have `sentinelIssues.ts` consume `sentinel.ts` instead).
- Add a thin `index.ts` shim between the two and have both depend on the shim.

**Decision needed**: choose one of the three, or accept option 1 explicitly so future PRs know the direction.

### PR #17 — Governance items on policy_codify RFC

The RFC is a design document; merging is largely about agreeing on shape and scope before any implementation lands.

| # | Question | Whose call |
|---|---|---|
| 1 | Tool shape — composite (`policy_codify` covering codify/lifecycle) vs. narrow (separate `policy_codify`, `policy_promote`, etc.)? | Decibel maintainers |
| 2 | Scope — codification only, or broader policy lifecycle in scope of this RFC? | Decibel maintainers |
| 3 | Phasing — MVP-first iteration, or design the general schema first and ship slices? | Decibel maintainers |
| 4 | Phase 1 owner — who builds the first slice? | Staffing |

### Manual verification today; could become automated future work

Three items require a runtime/UI surface to verify against. They're listed as manual today because no test harness exists for them, not because they're inherently un-automatable.

#### PR #12 — Manual MCP-client smoke test before merge

A real MCP client (Claude Code, Cursor, Claude Desktop) connecting to `dist/server.js` and exercising at least `initialize` + `tools/list` + one `tools/call`.

**Why it isn't covered by the existing e2e**: the `tests/e2e/stdio.test.ts` suite exercises the protocol via a hand-rolled JSON-RPC client. It does not exercise the actual MCP SDK client's behavior, framing, or error paths.

**Potential automation**: spawn the built server in CI and connect a scripted `@modelcontextprotocol/sdk` client to it. Would catch protocol-level regressions before any human ever runs the smoke test.

#### PR #21 — HQ's Dispatch button shows real jobs after merge + daemon restart

Requires HQ frontend running against a daemon that has the new agentic-dispatch tools loaded.

**Potential automation**: HQ test harness with a fixture daemon. Today there is no such harness.

#### PR #21 — Agent (Claude Code) can read a queued job's YAML, set status to running, execute, and write output back

Requires a real Claude Code agent loop. Today the only verification is "run Claude Code, point at a queued job, watch it work".

**Potential automation**: a mock-agent integration test that simulates the queue lifecycle deterministically. Would catch lifecycle regressions; would *not* prove "Claude Code specifically can do this", which is the verification target.

---

## Suggested follow-up issues to file

If you want to convert the three manual items into automatable work, the right scope per issue is:

1. **Automate MCP-client smoke test in CI** — spawn `dist/server.js`, run a scripted `@modelcontextprotocol/sdk` client, assert tool list and at least one tool call. Closes the gap that the current e2e suite leaves open.
2. **HQ Dispatch integration test** — requires HQ test harness; bigger scope, probably its own epic.
3. **Mock-agent end-to-end for agentic-dispatch** — verify queue lifecycle (enqueue → running → completed) deterministically with a mock that obeys the protocol.

---

## Source PRs

| PR | Title | Status as of 2026-05-19 |
|---|---|---|
| #12 | fix: repair e2e tests + audit-fix runtime deps | rebased, CI green, awaiting merge |
| #14 | fix(sentinel): list_issues / list_epic_issues handle YAML-only files + surface epic_id | rebased, CI green, awaiting merge |
| #17 | docs(rfc): policy_codify tool | rebased, CI green, RFC awaiting maintainer review |
| #21 | feat(agentic): MVP dispatch — enqueue/list_queue/cancel_job | rebased, CI green, awaiting merge + manual verification |
