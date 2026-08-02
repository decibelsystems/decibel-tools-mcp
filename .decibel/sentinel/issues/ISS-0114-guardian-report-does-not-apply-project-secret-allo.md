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

## Correction — 2026-08-01

**The root cause above is wrong.** `report()` *does* thread `project_id`
(`src/tools/guardian.ts:505-506` → `scanSecrets` → `loadAllowlist(input.project_id)`),
and `loadAllowlist` is byte-identical on `origin/main` and `public/main`.

Verified by running `scanSecrets({project_id:'decibel-tools-mcp'})` directly from
source via tsx: `total_findings=0, allowlisted=4`. The allowlist mechanism works.

But the long-running MCP server process — same code, same allowlist file, same
`project_id` — still returns `allowlisted: 0` (reproduced twice). The scanned file
paths are identical in both outputs (`/…/decibel-tools-mcp/src/…`), so
`resolved.projectPath` matches. The divergence must therefore be in
`resolved.subPath()` / `decibelPath` resolving to a **different directory** in the
server process: `scanSecrets` scans the repo while `loadAllowlist` reads the
allowlist from somewhere else.

**Next step:** log the resolved `allowlistPath` inside `loadAllowlist` and compare
server process vs. fresh process. Suspect a registry `decibelPath` override or a
differing data root / HOME in the server environment.

**Impact confirmed real:** the guardian pre-push hook runs through the server, so it
grades F on 4 known-safe Supabase *anon* keys (all decode to `"role":"anon"`, all
already present on `public/main`) and blocks pushes.
