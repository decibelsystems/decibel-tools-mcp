---
uid: 01a0ba03-885d-77a6-b179-f27fb2e895ca
id: ISS-0176
projectId: decibel-tools-mcp
severity: med
status: open
priority: medium
tags:
  - cross-platform
  - ci
  - daemon
  - windows
  - linux
  - installer
created_at: 2026-09-19T14:13:08.829Z
---
# Tri-platform in practice, single-platform in CI — and the daemon installer is macOS-only with no guard

**Severity:** med
**Status:** open

## Details

CONTEXT. Ben, 2026-09-19: three platforms are in real use — Mac (Ben, primary dev),
Linux (Rich, the only Linux user), Windows (the installer's target, proven on Ben's PC
2026-08-27). "So far the issues have been minimal but it did come up with the PC installer
work." This issue records where the codebase currently assumes a platform, measured rather
than guessed.

1. CI RUNS ONLY ON UBUNTU. All three jobs in .github/workflows/ci.yml are
`runs-on: ubuntu-latest`; the matrix varies NODE VERSION (18/20/22), not OS. So the
platform with exactly one user is the only one continuously verified, while the primary
development platform and the installer's target platform are checked by hand, if at all.
The 894-test suite proves nothing about macOS or Windows today.

2. `--daemon install` IS macOS-ONLY, UNGUARDED. src/daemon.ts:25 sets
`LAUNCH_AGENTS_DIR = join(homedir(), 'Library', 'LaunchAgents')` and the install path
writes a launchd plist. There is no `process.platform` check anywhere in src/ — zero
occurrences in the whole tree. On Linux that resolves to `~/Library/LaunchAgents`, a
directory that has no meaning, so Rich gets either a silently created useless folder or a
confusing failure, and no message saying the feature is macOS-only. There is no systemd
unit and no Windows service/Task Scheduler path: grep finds no `systemd`, `systemctl`,
`schtasks` or `winsw` anywhere.

3. `spawn('python3')` BREAKS ON WINDOWS. src/tools/dojoBench.ts:164 runs the benchmark
script via `python3`, which is the POSIX spelling. Windows ships `python` and the `py`
launcher; `python3` typically resolves to a Microsoft Store shim that does not execute.
dojo bench therefore cannot work on Windows as written.

WHAT IS ALREADY FINE, so this is not a call for a platform abstraction layer: the code has
no platform branching because it mostly does not need any — `homedir()`, `path.join` and
fs are used correctly nearly everywhere, and the 3.0 runtime is platform-neutral. The gaps
are at the EDGES: process installation, shelling out, and the packaged installer.

SUGGESTED, cheapest first:

1. Add an OS matrix to CI — `os: [ubuntu-latest, macos-latest, windows-latest]`. This is
   the highest-value change by a distance, because it converts "we think it works" into a
   list of what does not. Expect initial red; that IS the result. Consider running the full
   matrix on one Node version and keeping the Node matrix on Ubuntu, to hold CI minutes
   roughly flat.
2. Guard the macOS-only entry points with an explicit refusal naming the platform and what
   to do instead, rather than letting them fail obscurely. A stated "not supported here"
   beats a mystery on the one platform we have exactly one user to notice it.
3. `python3` -> resolve the interpreter (`python3`, else `python`), or state the dependency.
4. Consider a `platforms` field on the kind:'tool' proposal format (WISH-0023). There is
   now a bug behind it, which is the bar that format's required fields are supposed to
   meet: this issue is the evidence that "which platforms does this work on" is a question
   nobody is being asked before a tool ships.

RELATED: the Windows install lessons already recorded — the Store/MSIX build virtualizes
%APPDATA% and breaks ${__dirname}, and Claude Desktop does not bundle node.
