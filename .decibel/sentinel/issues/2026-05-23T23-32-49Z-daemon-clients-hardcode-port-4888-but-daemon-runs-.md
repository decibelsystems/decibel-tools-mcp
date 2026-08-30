---
uid: 019e572f-29c9-7b23-90c1-2c6235124b8d
id: 2026-05-23T23-32-49Z-daemon-clients-hardcode-port-4888-but-daemon-runs-
projectId: decibel-tools-mcp
severity: med
status: closed
created_at: 2026-05-23T23:32:49.225Z
closed_at: 2026-05-24T17:12:16.041Z
---

# Daemon clients hardcode port 4888 but daemon runs on 8787 — discover from daemon.meta + reconcile default + fix sentinel action casing

**Severity:** med
**Status:** closed

## Details

Filed from a decibel-agent session after debugging "deck-web didn't see the daemon HQ was running." Local symptoms already patched outside this repo; the durable fixes belong here.

## Symptom
Every Claude Code SessionStart (deck-web, decibel-agent, etc.) reported "Daemon not reachable" even though the daemon was healthy (PID 11709, up 30h, /health 200, 33 facades). HQ's web UI saw the daemon fine.

## Root cause: port drift
- Running daemon binds *:8787 — ~/.decibel/daemon.meta = {"port":8787,"pid":11709}.
- But the source default is 4888 in many places: daemonConfig.ts:42, daemon.ts:318, server.ts:76 (`port || daemonConfig.daemon.port || 4888`), scripts/boot-local.sh:15 (DAEMON_PORT=4888), extension/src/mcpClient.ts:38 + extension/package.json:155 (default http://localhost:4888).
- Clients that HARDCODE 4888 fail; the only client that works (HQ vite.config.ts) works precisely because it READS ~/.decibel/daemon.meta (fallback 8787).
- Open question for an owner: why is the live daemon on 8787 (and bound to * not 127.0.0.1) when config.yaml is absent and the source default is 4888/127.0.0.1? Decide which port is canonical, then make it consistent so daemon.meta and client defaults can't drift again. (Related still-open issue: "MCP daemon was binding 0.0.0.0 — broke senken.pro routing", 2026-04-01.)

## Fixes wanted in this repo
1. Make daemon clients discover the port from ~/.decibel/daemon.meta (fallback to the canonical default), mirroring HQ's vite.config: VS Code extension (mcpClient.ts + package.json default), scripts/boot-local.sh, and any session-init hook template/installer this repo ships.
2. Reconcile the canonical default port across daemonConfig.ts / daemon.ts / server.ts so it matches what the daemon actually binds.
3. Sentinel facade action casing: the daemon /batch facade action is `list_issues` (snake_case). The MCP tool is named `sentinel_listIssues` and the session-init pattern + global CLAUDE.md used `listIssues` → daemon returns {"error":"Unknown action \"listIssues\" for sentinel"}. Standardize docs/examples/hook templates on the facade action name `list_issues` (camelCase silently errored on every boot).

## Already fixed locally (NOT in this repo)
- ~/.decibel/hooks/session-init.sh: now resolves PORT from daemon.meta (fallback 8787) and uses sentinel `list_issues`; fallback-nudge text also corrected.
- ~/.claude/CLAUDE.md mandatory-init: sentinel `listIssues` → `list_issues`.

## Security note
Daemon binds *:8787 (all interfaces) and /health answers with no auth (config.yaml absent) — reachable beyond localhost. Default host should arguably remain 127.0.0.1 (see the 2026-04-01 binding issue).

## Resolution Progress (2026-05-23)
Ben confirmed **4888 canonical** (8787 was the anomaly). Root cause was NOT stale dist — it was a logic short-circuit: `parseHttpArgs` baked port=8787/host=0.0.0.0 defaults that won the `||` chains in server.ts, making daemonConfig's 4888/127.0.0.1 dead code in daemon mode (also affected bridge mode + the 2026-04-01 0.0.0.0 issue).

**DONE:**
- (fix #2 reconcile default) `parseHttpArgs` returns undefined when --port/--host absent, still honoring PORT for Render; `transports/http.ts` fallback 8787→4888; `start.sh` default 8787→4888. Committed as 7cb7e07.
- daemon restarted + verified live on 127.0.0.1:4888 (daemon.meta={port:4888,pid:65603}, /health ok). 3-way verified (daemon + HQ + hook).
- (fix #3 casing) project CLAUDE.md SessionStart row `sentinel listIssues`→`list_issues`; local hook + global CLAUDE.md fixed by decibel-agent.
- (security) all-interfaces bind removed → localhost-only. Cross-linked + closed the 2026-04-01 0.0.0.0 issue (ADR-0006).
- senken.pro routing re-verified: senken.ts is Postgres-only, no port/host coupling — unaffected by the port change.
- (fix #1) extension (mcpClient.ts + package.json) and scripts/boot-local.sh now discover the port from ~/.decibel/daemon.meta (fallback 4888), mirroring HQ's vite.config.

**NOTE:** This file was reformatted to flat YAML by a buggy `update_issue` (YAML round-trip drops markdown body) and restored by hand. That destructive behavior is the separate `read_issue`/`update_issue` store-split bug — issue 2026-05-23T23-45-31Z.
