---
uid: 01a07cfc-4dd9-7e2c-8e61-6f319d405976
id: ISS-0162
projectId: decibel-tools-mcp
severity: high
status: closed
priority: high
tags:
  - torture
  - s4
  - release-gate
  - flake
created_at: 2026-09-07T17:48:24.921Z
updated_at: 2026-09-18T21:10:14.214Z
closed_at: 2026-09-07T17:48:59.357Z
resolution: Fixed in 167c49b. S4 now distinguishes a transient backend failure from a transport defect via TRANSIENT_BACKEND_SIGNATURES (closed, asserted list of 7 patterns), dropping a row only when a signature appears AND the transports diverged. Guarded by a 2% inconclusive ceiling and per-row reporting; calibrated in both directions including the verbatim 3.0 payload and nine ordinary error payloads proven not to match. S4 26/26, suite 894/894.
linked_commits:
  - sha: c157b8905c30be738f8f971d9419261b5242d722
    shortSha: c157b89
    message: Merge remote-tracking branch 'origin/main' into
      iss-0162-s4-transient-backend
    relationship: related
    linked_at: 2026-09-18T21:10:14.214Z
    linked_by: ai:claude

---
# S4 goes red when a live backend is slow, not when a transport is broken

**Severity:** high
**Status:** closed

## Details

SYMPTOM. During the 3.0 release gate, S4 failed on deck.search with "canceling statement due to statement timeout" — Postgres aborting the query at the server-side statement_timeout on a live Supabase. The same commit passed clean on re-run.

WHY IT HAPPENS. S4 makes four passes (stdio, thin, /call, /batch) at four different times. For a read backed by the project's own files that is harmless: the bytes do not move between passes. For a read backed by a live remote service it is not — the backend can be healthy for one pass and unwell for the next, and the two answers then differ for a reason that has nothing to do with the transport under test.

WHY IT MATTERS MORE THAN A FLAKE. A release gate that goes red because a database was busy teaches everyone to re-run it until it is green, which is how a gate stops being one. deck's other actions are S2-waived for being remote reads; deck.search had no S4 waiver at all.

WHAT WAS REJECTED. Waiving the live-backend actions by name — the obvious fix — buys stability by deleting coverage: deck would stop being compared across transports at all, including on the days its backend is fine, and S4's headline catch (a tool that works in Claude Code and is missing in ChatGPT) would stop applying to a whole facade. It would also go stale, covering the actions that are remote today and none added later.

WHAT WAS DONE. The discrimination is made on the ANSWER rather than on the action. TRANSIENT_BACKEND_SIGNATURES in tests/torture/harness.ts is a closed, asserted list of seven infrastructure-failure patterns. A row is INCONCLUSIVE — excluded from the equivalence assertions, counted, printed by name — only when a signature appears AND the transports actually diverged. Uniform failure across all four is still a comparison that succeeded and is kept.

Guards: a 2% ceiling (MAX_INCONCLUSIVE_FRACTION) fails the sweep if too much of the surface goes uncompared, so "inconclusive" cannot drift into "untested"; and calibration in both directions — every declared signature is proven to fire, the verbatim 3.0 payload is pinned, and nine ordinary error payloads (404, 401, ENOENT, validation failures, "Supabase is not configured") are proven NOT to fire, because a predicate broad enough to match those would excuse real transport divergence.

VERIFIED. S4 26/26, full suite 894/894 across 69 files. 3252 calls compared, zero rows dropped on a healthy run.

## Resolution

Fixed in 167c49b. S4 now distinguishes a transient backend failure from a transport defect via TRANSIENT_BACKEND_SIGNATURES (closed, asserted list of 7 patterns), dropping a row only when a signature appears AND the transports diverged. Guarded by a 2% inconclusive ceiling and per-row reporting; calibrated in both directions including the verbatim 3.0 payload and nine ordinary error payloads proven not to match. S4 26/26, suite 894/894.

