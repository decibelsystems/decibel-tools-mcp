---
id: ISS-0127
projectId: decibel-tools-mcp
severity: high
status: open
created_at: 2026-08-14T22:04:16.384Z
---

# daemon --daemon install reports success while launchctl load silently fails (HOME on external volume)

**Severity:** high
**Status:** open

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
