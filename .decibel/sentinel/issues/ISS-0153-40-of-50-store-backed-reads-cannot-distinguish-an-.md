---
uid: 01a06ec2-6d83-73d4-8a2b-b5c59ef1030d
id: ISS-0153
projectId: decibel-tools-mcp
severity: high
status: closed
priority: high
tags:
  - torture
  - S2
  - release-gate
  - absence
created_at: 2026-09-04T23:30:30.915Z
updated_at: 2026-09-06T18:45:37.451Z
closed_at: 2026-09-06T18:45:35.653Z
resolution: "Resolved by commit 790f88b: sentinel: close ISS-0153, the
  store-read absence gap"
linked_commits:
  - sha: 00ba146dbf4496bbc6ffd09cb14082a42465e8a4
    shortSha: 00ba146
    message: 'ISS-0153: stop reporting "I could not look" as "nothing found"'
    relationship: related
    linked_at: 2026-09-05T01:47:47.436Z
    linked_by: ai:claude
  - sha: 6297033bb2ee19dd646becd361aad4a38c16ef18
    shortSha: "6297033"
    message: 'ISS-0153: make the "I could not look" fix actually fire'
    relationship: related
    linked_at: 2026-09-05T17:30:17.420Z
    linked_by: ai:claude
  - sha: 0baea10ffd93b7c11e33468da33759dcefd1bf1b
    shortSha: 0baea10
    message: "ISS-0153: a read that skipped a record now says so"
    relationship: related
    linked_at: 2026-09-06T02:14:06.776Z
    linked_by: ai:claude
  - sha: 790f88bca3de2ff23475626a6364e53187c9b8d5
    shortSha: 790f88b
    message: "sentinel: close ISS-0153, the store-read absence gap"
    relationship: closes
    linked_at: 2026-09-06T18:45:37.451Z
    linked_by: ai:claude

---
# 40 of 50 store-backed reads cannot distinguish an empty store from a broken one

**Severity:** high
**Status:** closed

## Details

Found by the S2 sweep of the tool torture test (tests/torture/s2-absence.test.ts), first run 2026-09-04. HARD gate for 3.0.

THE SWEEP. 135 read actions x 4 situations = 540 calls. Of those, 50 are judged: 20 are waived as remote-backed (deck/terminal/studio/corpus/voice/zoom read a remote store, so a broken .decibel changes nothing about their answer), and 65 never reached the store at all — called with only a project_id, they fail on argument validation identically in all four situations, which says nothing about absence handling.

Of the 50 judged, 10 answer correctly and 40 do not:
- 35 cannot distinguish an EMPTY store from an UNREADABLE one (chmod 000)
- 39 cannot distinguish an EMPTY store from one holding UNPARSEABLE records
- 14 cannot distinguish an EMPTY store from a project that DOES NOT RESOLVE

Affected (situation(s) conflated with empty):
  agentic.golden_eval(unparseable) architect.list_adrs architect.list_policies
  context.list(unparseable) coordinator.log coordinator.status
  decibel.about decibel.capabilities decibel.case_studies (all three)
  designer.drift designer.evals designer.list_crits designer.list_principles designer.tokens
  dojo.list dojo.list_wishes dojo.projects(all three)
  friction.list
  guardian.report guardian.scan_config guardian.scan_deps guardian.scan_http guardian.scan_secrets (all three)
  learnings.list
  oracle.next_actions oracle.portfolio_summary(all three)
  provenance.list(unparseable) registry.config_list(all three) registry.list(all three)
  sentinel.audit_policies sentinel.list_epics sentinel.list_issues(unreadable)
  sentinel.list_test_specs sentinel.scan_codebase sentinel.scan_config sentinel.scan_coverage
  swarm.read_signals(all three) swarm.session_status(all three)
  vector.assumptions(unparseable) vector.list_runs(unparseable)

WHY THIS IS THE WORST CLASS. Every failure this project has actually shipped returned ok: true. The voice inbox was dead 5.5 hours and the digest said `voice 0`. A regenerated plist dropped four facades and /health said `status: ok`. In both cases "I found nothing" was indistinguishable from "I could not look". These 40 reads have that property today.

The pattern is almost always a bare `catch {}` around a directory read or a YAML parse that returns the empty case. designer.tokens and designer.drift are the clearest example: one catch turns file-missing, permission-denied and corrupt-YAML into the same NO_TOKENS answer.

WHAT GOOD LOOKS LIKE. Ten of the fifty already do it, and the split is informative: provenance.list, vector.list_runs, vector.assumptions and context.list detect an unreadable store but not unparseable records; sentinel.list_issues is the mirror image, detecting unparseable records but not an unreadable store. readPathFailures.test.ts already asserts the counted-not-dropped behaviour for listProvenance — that is the shape to generalise.

Minimum fix: distinguish ENOENT (empty) from EACCES/EPERM (unreadable) from a parse failure (present but unreadable), and COUNT the records skipped rather than dropping them. The harness asserts a DIFFERENCE, not a specific shape, so any answer a caller can branch on satisfies it.

HARNESS IS CALIBRATED. tests/torture/selfcheck.test.ts injects a deliberately silent read and a deliberately honest one and asserts the sweep catches the first and clears the second, plus asserts the four sandbox situations are genuinely different on disk. Two harness bugs were caught this way before these findings were believed — see the epic note.

## Resolution

Resolved by commit 790f88b: sentinel: close ISS-0153, the store-read absence gap

