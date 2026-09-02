---
uid: 01a0024d-ec80-74af-a541-627361c81b78
id: ISS-0127
projectId: decibel-tools-mcp
severity: high
status: in_progress
created_at: 2026-08-14T22:04:16.384Z
updated_at: 2026-09-01T04:23:41.244Z
---

# daemon --daemon install reports success while launchctl load silently fails (HOME on external volume)

**Severity:** high
**Status:** in_progress

## Details

CONFIRMED, not inferred. `--daemon install` tells the user "Installed and loaded. Daemon will auto-start on login" when the agent was never loaded. On this machine the plist has been sitting unloaded since 2026-02-26.

SYMPTOM: the SessionStart hook's "Daemon not reachable" message. Reported independently by the agent working in the plasiv repo, then reproduced here.

EVIDENCE:
- `~/Library/LaunchAgents/com.decibel.daemon.plist` exists, written 2026-02-26 23:21
- `launchctl print gui/501/com.decibel.daemon` -> `Could not find service` (never loaded)
- `curl 127.0.0.1:4888/health` -> no response
- `NFSHomeDirectory: /Volumes/Ashitaka` — HOME is an external volume, which is the underlying cause; launchd will not load agents from it
- Decisive: running `launchctl load ~/Library/LaunchAgents/com.decibel.daemon.plist` prints "Load failed: 5: Input/output error" AND EXITS 0

ROOT CAUSE (src/daemon.ts, installLaunchd, ~line 330): the code is
  try { execSync(`launchctl load ${PLIST_DEST}`, { stdio: 'pipe' }); } catch { ...fallback... }
Because the deprecated `launchctl load` exits 0 on failure, execSync never throws, the catch never runs, and the function falls through to the unconditional success return. stdio: 'pipe' also swallows the error text that would have made this visible.

Secondary defect: even on the path where the fallback DOES throw, the function returns `installed: true` with the failure only mentioned in the message string. Callers checking the boolean see success.

FIX:
1. Use `launchctl bootstrap gui/$(id -u) <plist>` instead of the deprecated `load`. It returns a real non-zero exit code and richer errors.
2. Do not trust the exit code alone — verify with `launchctl print gui/$(id -u)/com.decibel.daemon` and only then report success.
3. Return `installed: false` when the agent is not actually loaded.
4. Detect the external-HOME case and say so plainly, with the fallback (cron works fine on this machine — verified end to end under `env -i` by the plasiv agent). Related: existing note that $HOME is a RAID 0 external volume.

IMPACT BEYOND THE DAEMON: anything scheduled through launchd later inherits this failure. Relevant to EPIC-0036 — a scheduled zoom sync must not be built on `--daemon install`.

[2026-08-28] Reconfirmed 2026-08-28. `~/Library/LaunchAgents/com.decibel.daemon.plist` exists (dated Feb 26, RunAtLoad=true) but `launchctl list | grep -i decibel` returns nothing — the job is not loaded, so the daemon never autostarts. Meanwhile 6 stdio `dist/server.js` processes were running from Claude Desktop/Code, which is why tools work while /health on 4888 is dead. Also found stale state: `~/.decibel/daemon.meta` held pid 13425 from 2026-08-27T20:46Z with no matching `daemon.pid` — a dead instance left meta behind without cleanup. Second defect worth folding in: the plist sets NODE_ENV=production with no DECIBEL_PRO/DECIBEL_APPS, so post-943a642 (fail-closed tier gating) a launchd-started daemon would silently serve core-only.

[2026-09-01] [2026-08-31] FIX IMPLEMENTED (uncommitted on main). All four prescribed points done in src/daemon.ts:

1. `launchctl load` -> `launchctl bootstrap gui/<uid>`; `unload` -> `bootout`. bootout runs first so a reinstall picks up the plist just written.
2. New `isLaunchdLoaded()` shells `launchctl print <domain>/<label>` and is the ONLY success signal. The exit code is no longer trusted.
3. installLaunchd returns `installed: false` when the agent is not loaded, and `--daemon install` now exits 1. Verified: exit was 0 before, is 1 now.
4. New `isOnBootVolume()` detects the external-HOME case and the failure message prints both remedies (sudo cp to /Library/LaunchAgents, or cron @reboot) with real paths filled in.

Also folded in the secondary defects noted 2026-08-28:
- `daemonStatus()` split `launchd` (does launchd actually hold the job) from `launchdPlist` (does a file exist). The CLI now prints 'plist present but NOT loaded - will not auto-start' for the failure state that previously read as 'installed'.
- Template gains DECIBEL_PRO/DECIBEL_APPS, but PROPAGATED from the installing shell rather than hardcoded: a plist in /Library/LaunchAgents is world-readable, and guardian.ts:498 already flags DECIBEL_PRO=1 in production as an over-grant.
- uninstallLaunchd verifies the bootout took, and names the sudo commands when the job was bootstrapped from /Library.

NEW FINDING, not in the original report: launchd does not inherit the login shell, so the agent started with no SUPABASE_* vars (they live in ~/.zshrc). /health showed supabase_configured:false and both voice.inbox_sync and agentic.queue_sync returned 'Supabase is not configured' - the two facades session-init depends on most. A daemon that auto-starts but cannot sync is not a fix. Template now passes `--env-file-if-exists=~/.decibel/env`; that file was created on this machine (mode 600) from the repo .env.

Tests: new tests/unit/daemonLaunchd.test.ts (5 cases) guards unsubstituted {{TOKEN}}s, the env-file flag, port rendering, and that pro is granted only on explicit opt-in. renderPlist() was extracted from installLaunchd so substitution is testable without touching launchctl. Full suite 696/696.

REMAINING: commit; and on this machine re-copy the regenerated plist to /Library/LaunchAgents so the running agent picks up --env-file-if-exists (currently loaded from the older hand-written copy, so supabase_configured is still false).
