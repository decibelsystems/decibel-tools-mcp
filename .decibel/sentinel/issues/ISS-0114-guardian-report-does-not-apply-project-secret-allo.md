---
uid: 019f5261-4688-713e-8280-b63a772a7580
id: ISS-0114
projectId: decibel-tools-mcp
severity: med
status: closed
created_at: 2026-07-11T18:12:14.600Z
updated_at: 2026-08-02T03:20:37.887Z
closed_at: 2026-08-02T03:32:23.881Z
---

# Guardian report() does not apply project secret allowlist (allowlisted stays 0)

**Severity:** med
**Status:** closed

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

[2026-08-02] Root cause found — NOT path resolution and NOT process state (restart did not fix it; the ea93611 dev/prod advisory split was present in the same output, proving fresh code was loaded).

kernel.ts:359 destructured `project_id` OUT of args and re-added it only as `projectId`:
  const { action, params, project_id, ...flatParams } = args;
It renamed rather than aliased. Guardian reads `input.project_id` (snake_case), so over MCP dispatch it was undefined -> loadAllowlist(undefined) -> fell back to ~/.decibel/guardian/allowlist.yaml, which does not exist -> [] -> allowlisted: 0.

Direct in-process calls pass project_id intact, which is why a fresh process read allowlisted: 4 / grade B.

Blast radius: 71 reads of input.project_id across 19 files in src/tools/. All silently lost project scope over MCP; most survived because resolveProjectPaths(undefined) falls back to a cwd-walk that happens to find the repo. Guardian's allowlist was one of the few going straight to homedir() with no cwd fallback, so it surfaced first.

Fix: kernel now keeps both keys (alias, not rename). Verified through k.dispatch('guardian', {action:'report', project_id}) -> grade B, allowlisted 4, findings 0. Full suite 366/366.

Follow-up worth considering: loadAllowlist has no cwd fallback unlike its siblings — defense in depth.

## Resolution

Fixed in two commits, both pushed to origin/main and public/main at 810430f.

aa473ab fix(kernel): alias project_id instead of renaming it. kernel.ts destructured project_id out of args and re-added it only as projectId, so the 71 reads of input.project_id across 19 files in src/tools/ received undefined over MCP dispatch. Now keeps both keys.

810430f fix(guardian): resolve the project allowlist when project_id is omitted. loadAllowlist branched on `if (projectId)` and otherwise skipped project resolution entirely, reading only the global ~/.decibel allowlist. Its sibling scanSecrets calls resolveProjectPaths(input.project_id) unconditionally and relies on the cwd-walk fallback — which is why the scan found the right directories while the allowlist did not. This second commit was the one that actually unblocked the pre-push hook, since the hook's agent invokes guardian report with no project_id at all.

Verified through the real kernel dispatch path in both call shapes (with and without project_id): grade B, allowlisted 4, findings 0. Suite 366/366. Push to both remotes succeeded with the guardian gate active.

Supersedes the two earlier hypotheses recorded on this issue: report() not threading project_id (it did), and a decibelPath/data-root divergence in the server process (there was none). The 2026-08-01 note's conclusion that the divergence "must therefore be in resolved.subPath()" was wrong — the divergence was that project_id never reached loadAllowlist at all.

Not done, deliberately: no regression test locking in either behaviour. Worth adding — a kernel test asserting project_id survives dispatch, and a guardian test asserting the project allowlist applies when project_id is omitted. That second case is the one that regressed silently and blocked pushes.
