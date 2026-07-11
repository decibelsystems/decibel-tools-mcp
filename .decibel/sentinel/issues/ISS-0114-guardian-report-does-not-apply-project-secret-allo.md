---
id: ISS-0114
projectId: decibel-tools-mcp
severity: med
status: open
created_at: 2026-07-11T18:12:14.600Z
---

# Guardian report() does not apply project secret allowlist (allowlisted stays 0)

**Severity:** med
**Status:** open

## Details

Symptom: A valid project allowlist at .decibel/guardian/allowlist.yaml has no effect when running `guardian report` — the secrets section still lists the allowlisted findings and reports "allowlisted": 0.

Reproduced 2026-07-11: created .decibel/guardian/allowlist.yaml with entries [src/license.ts, src/tools/deck.ts, src/tools/swarm.ts, extension/src/proGate.ts] to suppress known-safe Supabase anon-key JWT findings. Re-ran guardian report (project_id: decibel-tools-mcp) — still 4 findings, allowlisted: 0.

Likely root cause: loadAllowlist(projectId) in src/tools/guardian.ts:116-133 resolves the project allowlist path only when projectId is passed; otherwise it falls back to ~/.decibel/guardian/allowlist.yaml (src/tools/guardian.ts:119-123). The report() action appears not to thread input.project_id into the underlying scan_secrets/scanDirectory call, so loadAllowlist runs without a projectId and reads the (nonexistent) home allowlist → empty → nothing suppressed. Note scan_secrets called directly WITH project_id likely works; only the report() composite is broken.

Fix direction: thread project_id from report() through to the secret scan so loadAllowlist resolves the project allowlist. Add a regression test: project allowlist entry suppresses a matching finding in report() output (allowlisted > 0).

Impact: teams can't suppress known false positives (public anon/publishable keys) via the documented project allowlist when using the report() gate — the pre-push hook uses report(), so legitimate false positives can't be cleared, forcing bypasses.

Related: ISS-0112 (array-param serialization bug in facade tools).
