---
projectId: decibel-tools-mcp
severity: med
status: closed
created_at: 2026-09-17T20:45:45.593Z
closed_at: 2026-09-17T20:45:51.364Z
---

# daemon.meta loses port field; SessionStart hook falls back to 4888 and reports daemon unreachable

**Severity:** med
**Status:** closed

## Details

Symptom: SessionStart hook injected "Daemon not reachable" while the daemon was healthy on 8787.

Cause: writeMeta() in src/daemon.ts replaced daemon.meta wholesale. checkCrashLoop() runs before checkRunning(), so a second `--daemon` launch (which then exits "already running") rewrote meta with only started_at/crash_count, dropping the port setDaemonPort() had recorded. scheduleHealthReset/resetCrashes had the same drop. hooks/session-init.sh and hooks/issue-close-reminder.sh then fell back to 4888 (config.yaml says 8787), and the jq/sed fallback chain never fired because empty output still exits 0.

Fix: writeMeta merges over the existing meta ({...readMeta(), ...meta}); both hooks resolve port as env → daemon.meta → config.yaml daemon.port → 4888 in three separate assignments. Verified: duplicate launch keeps port in meta; hook returns the compact digest with no env override.

## Resolution

Fixed in working tree (uncommitted): src/daemon.ts writeMeta merge; hooks/session-init.sh and hooks/issue-close-reminder.sh port fallback chain. Daemon restarted on 8787 with DECIBEL_PRO=1 DECIBEL_APPS=1, meta now carries port+pid, hook returns digest.
