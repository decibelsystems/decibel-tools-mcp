---
uid: 01a07cf9-d1e4-7584-85bb-1cc436cdc981
id: ISS-0160
projectId: decibel-tools-mcp
severity: med
status: open
priority: medium
tags:
  - hooks
  - drift
  - tooling
created_at: 2026-09-07T17:45:42.116Z
---
# hooks/ in the repo drifted behind the installed copies in ~/.decibel/hooks

**Severity:** med
**Status:** open

## Details

The tracked hooks/session-init.sh was BEHIND the live one at ~/.decibel/hooks/session-init.sh: the daemon-boot retry loop (three attempts with a 2s sleep, added because a single attempt loses the race against a daemon still binding its port) existed only in the installed copy and was never vendored back.

Nothing detects this. hooks/install.sh copies repo -> ~/.decibel, so a fix made live is invisible to git and is silently reverted by the next install. The drift was found by accident while fixing a separate bug in the same file.

Resolved for now by copying the installed file over the repo copy (both hooks are now byte-identical, verified by diff). The structural fix is a test or CI check asserting hooks/*.sh == ~/.decibel/hooks/*.sh, or making the installed copy a symlink into the repo so drift is impossible.

Related to the existing issue "vendor session-init + issue-close hooks into repo" (2026-05-25), which anticipated exactly this.
