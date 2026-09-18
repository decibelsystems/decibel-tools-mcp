---
uid: 01a06ec2-97e1-7bcd-8d32-a3214c6fc9b1
id: ISS-0154
projectId: decibel-tools-mcp
severity: med
status: open
priority: high
tags:
  - torture
  - S1
  - release-gate
  - envelope
created_at: 2026-09-04T23:30:41.761Z
---
# Three actions return an error payload without the failure marker

**Severity:** med
**Status:** open

## Details

Found by the S1 sweep of the tool torture test (tests/torture/s1-envelope.test.ts), 2026-09-04. HARD gate for 3.0 — S1 must pass at 100% of actions.

S1 called all 273 actions plus 3 structural probes (276 calls). Everything answered, everything returned parseable JSON in content[0], and no response was prose-only. One assertion failed: a payload carrying an `error` field while `isError` is false.

  designer.tokens          error: "NO_TOKENS"        isError: false
  designer.drift           error: "NO_TOKENS"        isError: false
  designer.lateral_session error: "MISSING_PROBLEM"  isError: false

(A fourth, zoom.status, was found by the same run and fixed in the same commit — it reported "not configured" through a field named `error`. Renamed to `reason`, since reporting not-configured IS a successful status read.)

WHY IT MATTERS. This is the shape that reads as success to every programmatic consumer and as failure to a human. It is the /batch family's exact failure mode: a caller branching on isError proceeds as though it got data, and a caller branching on payload.error treats a genuine success as a failure. The two disagree, silently, forever.

SITES.
- src/tools/designer.ts:751 and :907 — both inside `catch {}` around a tokens.yaml read
- src/tools/lateral.ts:350 — MISSING_PROBLEM, a caller error (required argument absent)
- src/tools/lateral.ts:340 — SESSION_NOT_FOUND, the same shape; NOT caught by S1 because the sweep's argument-free call takes the MISSING_PROBLEM branch first. Fix it at the same time.

TWO DIFFERENT FIXES.
- MISSING_PROBLEM and SESSION_NOT_FOUND are failures. They should carry the failure marker (toolError), not a success envelope.
- NO_TOKENS is entangled with the S2 finding: the bare catch collapses file-missing, permission-denied and corrupt-YAML into one answer. Marking it a failure without splitting those cases would make "no tokens yet" an error for a project that legitimately has none. Fix the discrimination first, then decide which branches are failures.
