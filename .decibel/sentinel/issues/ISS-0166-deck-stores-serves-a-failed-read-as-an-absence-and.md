---
uid: 01a0b667-041c-7cc4-bf99-dda34268b062
id: ISS-0166
projectId: decibel-tools-mcp
severity: high
status: closed
priority: high
tags:
  - torture
  - s4
  - deck
  - silent-zero
  - writer-reader-drift
  - ci
created_at: 2026-09-18T21:23:19.707Z
updated_at: 2026-09-18T21:23:28.674Z
closed_at: 2026-09-18T21:23:28.581Z
resolution: "Resolved by commit 7ea9381: deck.stores: a failed read is a failure, not an absence"
---
# deck.stores serves a failed read as an absence, and it defeats the S4 transient classifier

**Severity:** high
**Status:** closed

## Details

SYMPTOM. CI run 35395377073 (2026-09-18, all three Node versions) failed S4 on deck.stores:

    stdio       latest_price_update: null
    thin        latest_price_update: <timestamp>
    http-call   latest_price_update: <timestamp>
    http-batch  latest_price_update: <timestamp>

All four passes returned success: true. No transport said anything failed.

EVIDENCE (probed, not recalled). The live backing value —
cards.price_updated_at, ordered desc, limit 1 — was 2026-09-18T06:01:26.909752Z
on four consecutive probes, roughly fifteen hours before the 21:10 sweep. The
data did not move during the sweep, so a null from the stdio pass is not a
reading of the data. It is a reading of a failure.

CAUSE. src/tools/deck.ts, deck.stores handler. Four queries run under
Promise.all and every field falls back to a neutral value:

    card_count:          cardCount.count || 0
    price_sources:       (sources.data || [])
    latest_price_update: (latestUpdate.data?.[0])?.price_updated_at || null
    available_periods:   (periods.data || [])

None checks .error. A Supabase query that errors returns { data: null, error }
— so a failed read produces exactly the bytes of an empty one. This is the
writer/reader-drift family: the caller cannot distinguish "no card has ever
been priced" from "that read did not happen".

WHY IT MATTERS BEYOND ONE FLAKE. It defeats ISS-0162's fix. The S4 transient
classifier decides a row is inconclusive by matching TRANSIENT_BACKEND_SIGNATURES
against the error text in the payload. deck.stores had already thrown the error
text away, so the row arrived at S4 as an ordinary, unexplained disagreement
between transports — the exact shape S4 exists to flag as a transport defect.
A sweep hardened against transient backends is still blind to any action that
eats its own errors.

FIX (applied). describeReadFailures() names every read that failed and carries
the backend's message into the payload, and deck.stores returns an isError
result instead of a summary when any of the four fails. Two consequences: a
caller can tell the two meanings apart, and S4 can now classify the row —
a 429 or a statement timeout carries a signature and becomes inconclusive,
anything else stays a real finding. Covered by tests/unit/deckReadFailures.test.ts.

STILL OPEN (not fixed here). The same `|| 0` / `|| []` swallow appears across
the other deck actions. This issue fixed the one the gate caught; a sweep of
the rest of the facade is the follow-up.

## Resolution

Resolved by commit 7ea9381: deck.stores: a failed read is a failure, not an absence
