---
uid: 01a06df3-071a-7cf6-aeeb-7cfacae6c5ef
id: ISS-0152
projectId: decibel-tools-mcp
severity: high
status: closed
priority: high
epic_id: EPIC-0036
tags:
  - zoom
  - dedup
  - data-loss
  - port-blocker
created_at: 2026-09-04T19:43:58.745Z
updated_at: 2026-09-04T20:16:19.945Z
closed_at: 2026-09-04T20:16:19.598Z
resolution: "Resolved by commit 5df82f1: sentinel: close ISS-0123 and ISS-0152,
  EPIC-0036 in progress"
linked_commits:
  - sha: 8325d3a82dbed2802d07ef581e9bf49db8e14bbb
    shortSha: 8325d3a
    message: "sentinel: close ISS-0123 and ISS-0152, EPIC-0036 in progress"
    relationship: related
    linked_at: 2026-09-04T20:14:24.366Z
    linked_by: ai:claude
  - sha: 5df82f1e3945a996b3767cc27bd5bdcfc9db5d07
    shortSha: 5df82f1
    message: "sentinel: close ISS-0123 and ISS-0152, EPIC-0036 in progress"
    relationship: related
    linked_at: 2026-09-04T20:16:19.945Z
    linked_by: ai:claude

---
# Unrouted meetings are dedup-poisoned — a later routing rule can never reclaim them

**Severity:** high
**Status:** closed
**Epic:** EPIC-0036

## Details

Found by the plasiv peer 2026-09-04 while reviewing the port plan. This is a latent bug in the live Python (plasiv/bin/pull-zoom-summaries.py) and a hard constraint on the TypeScript port.

THE BUG

    targets = [r["out"] for r in routes] + [UNROUTED]
    seen = known_uuids(targets)
    ...
    if uuid in seen and not args.force: skip

known_uuids() indexes the unrouted bucket alongside every routed destination, and the skip check is GLOBAL — it has no notion of which destination a uuid was seen in. So the moment a meeting lands in ~/.decibel/meetings/unrouted it is permanently "seen". Adding the routing rule that should have claimed it does NOT pull it into the project on the next run: it is skipped as already-known. Only --force recovers it, and --force re-downloads and overwrites everything else too.

So the unrouted bucket is not a holding pen that a later rule drains. It is a black hole. The epic's acceptance criterion "unmatched meetings land in an unrouted bucket, never dropped" is satisfied in the letter and violated in the spirit — the meeting is on disk but unreachable by the routing it was waiting for.

WHY IT BLOCKS THE STUB PLAN

ISS-0123 proposes the unrouted bucket hold a stub (uuid + topic + start) instead of the full body, to limit the privacy exposure. Layered on this bug that is strictly worse: the stub satisfies the global dedup check forever, so the body never arrives at all. Privacy fix and data-loss bug have to be solved together or the stub makes a recoverable problem permanent.

REQUIRED IN THE PORT

Unrouted entries must be tracked as UNCLAIMED, not as SEEN. Either:
  a. dedup per destination — a uuid is "seen" only in the directory it actually occupies, so a newly-routed destination still fetches it; or
  b. exclude the unrouted bucket from the seen-index entirely and let any routing rule reclaim it on the next run.

(b) is simpler and self-healing; (a) is more precise if a meeting can legitimately live in two projects. Either way a reclaim must move or rewrite the unrouted entry so it does not linger as a duplicate.

Whichever is chosen, add a test: meeting lands unrouted -> routing rule added -> next run (without --force) writes the full body into the project.

## Resolution

Resolved by commit 5df82f1: sentinel: close ISS-0123 and ISS-0152, EPIC-0036 in progress



Covered by tests/unit/zoom.test.ts: "RECLAIMS an unrouted meeting once a routing rule is added", which stubs a meeting, adds a rule, re-runs without force, and asserts the body arrives in the project and the stub is gone. Also "does not write a second stub for a meeting that is still unrouted".

STILL OPEN ELSEWHERE, deliberately not claimed here: plasiv/bin/pull-zoom-summaries.py has the original bug and continues to strand meetings on every routed run. This issue tracked the constraint on the port, and the port satisfies it; the Python is the plasiv repo's to fix or retire. Flagged to the plasiv peer.
