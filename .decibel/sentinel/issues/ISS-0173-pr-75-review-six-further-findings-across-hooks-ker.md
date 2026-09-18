---
uid: 01a0b695-d734-727e-8996-1ceabc725113
id: ISS-0173
projectId: decibel-tools-mcp
severity: med
status: open
priority: medium
tags:
  - review
  - pr-75
  - hooks
  - kernel
  - registry
  - tests
created_at: 2026-09-18T22:14:28.404Z
linked_commits:
  - sha: f7360ff74b773293582e0e0767b02666aad9276f
    shortSha: f7360ff
    message: "sentinel: PR #75 review findings — ISS-0171, ISS-0172, ISS-0173"
    relationship: related
    linked_at: 2026-09-18T22:14:49.539Z
    linked_by: ai:claude
updated_at: 2026-09-18T22:14:49.539Z

---
# PR #75 review — six further findings across hooks, kernel telemetry, registry init and a test

**Severity:** med
**Status:** open

## Details

Remaining findings from the post-merge review of PR #75, kept together rather
than filed as six issues. The two high-severity ones are ISS-0171 (studio REST
tier guard) and ISS-0172 (hardcoded hook path).

1. MED — hooks/session-init.sh:9 and hooks/issue-close-reminder.sh:27. The
   config.yaml port fallback keeps trailing text.
       sed -n 's/^[[:space:]]*port:[[:space:]]*//p'
   strips only the leading key, so an ordinary `port: 4888  # default` yields
   PORT="4888  # default" and URL="http://localhost:4888  # default/batch".
   curl fails and the hook reports "Daemon not reachable" for a healthy daemon
   — the exact false negative this PR set out to remove. Needs a trailing
   comment/whitespace strip and a numeric guard.

2. MED — same two files, lines 9/13 and 27/30. The config.yaml scrape is not
   scoped to the `daemon:` section. The sed matches `port:` / `auth_token:` at
   any indentation anywhere in the file and takes head -1, while
   ~/.decibel/config.yaml already carries hq:, extensions: and license:
   sections. YAML key order is arbitrary, so a future `auth_token:` under
   another section silently wins; a wrong token gives a 401, the envelope has
   no "results", and the hook falls back to the nudge while the daemon is fine.

3. MED — src/kernel.ts:631 with src/tools/shared/runTracker.ts:47. Read
   telemetry duplicates runs on every batched read. getOrCreateActiveRun only
   does activeRuns.set(...) AFTER awaiting createRun(...), and kernel.batch
   dispatches in parallel (kernel.ts:824). The session-init batch this PR edits
   now carries three readOnlyHint tools, so every session start creates three
   vector runs where one is intended. The race pre-existed; this change makes
   it fire deterministically on every boot.

4. MED — src/tools/registry/index.ts:257. An unguarded template read can abort
   project_init after the tree exists. fs.readFileSync(CLAUDE-decibel.md) sits
   before registerProject and has no try/catch of its own, so a trimmed bundle
   or dist-only install (the .mcpb) turns the whole call into ENOENT — after
   .decibel/ and manifest.yaml were written. The retry then hits "already has a
   .decibel folder ... use force=true" and the project is never registered. A
   cosmetic step should not be able to fail init: wrap it, or move it after
   registerProject.

5. MED — tests/unit/registryInit.test.ts:26. The new test writes into the
   developer's real ~/.decibel/projects.json. projectInitTool.handler calls
   registerProject, which resolves there unless DECIBEL_REGISTRY_PATH is set
   (projectRegistry.ts:198-201); createTestContext sets DECIBEL_MCP_ROOT and
   DECIBEL_PROJECT_ROOT but not that one, and there is no vitest global setup.
   Running the suite permanently adds `newproj` and `other` entries pointing at
   tmpdir paths that cleanup then deletes — dangling registry entries that
   later break resolution by those ids. tests/unit/projectRegistryDevice.test.ts:43
   shows the correct pattern.

6. LOW — src/daemon.ts:181. Merged meta makes port/pid permanently sticky.
   { ...readMeta(), ...meta } fixes the duplicate-launch case, but nothing ever
   removes port/pid and there is no shutdown write, so after the daemon stops —
   or fails to bind and exits before setDaemonPort runs — daemon.meta keeps
   advertising the last port and a dead PID. Since this same PR makes
   daemon.meta the FIRST source in the hooks' resolution chain, a stale meta now
   shadows a freshly-edited daemon.port in config.yaml. daemon --status (:670)
   also prints a dead PID as running.

7. LOW — hooks/issue-close-reminder.sh:45. grep -q '"results"' still reports a
   failed close as closed. The move from "status" to "results" correctly
   rejects auth/error envelopes, but /batch returns HTTP 200 with a populated
   results array even when an individual call fails (httpServer.ts:1417-1424 —
   partial failure is a deliberate 200). A trailer naming a nonexistent issue
   still prints "Closed ISS-9999". Should inspect .results[0] for an error
   rather than grep the envelope. Related to ISS-0168, same file.

8. LOW — src/tools/registry/index.ts:252. project_init now writes outside
   .decibel/ by default: args.claude_md !== false means the default appends to,
   and when absent creates, a top-level CLAUDE.md in the target repo. It is
   idempotent via the marker so the risk is surprise rather than damage, but
   defaulting a repo-root file write to on — where `cursor` is opt-in — is
   worth a second look.
