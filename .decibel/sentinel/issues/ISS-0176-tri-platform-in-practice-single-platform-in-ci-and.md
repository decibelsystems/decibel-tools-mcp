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
linked_commits:
  - sha: 3448fd96b87a9299df0a97f4597f139cd0098842
    shortSha: 3448fd9
    message: "sentinel: ISS-0176 — three platforms in use, one in CI"
    relationship: related
    linked_at: 2026-09-19T14:13:29.809Z
    linked_by: ai:claude
updated_at: 2026-09-19T14:32:24.363Z
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

[2026-09-19] CI MATRIX ADDED, and a prediction recorded BEFORE the first run so that red can be read.

New `test-platforms` job: macos-latest and windows-latest, node 20, fail-fast disabled so one platform failing cannot cancel the other. It runs the PORTABLE CORE only — lint, build, unit suite — and deliberately not the torture or e2e sweeps, which build fixtures with chmod and hardcoded /tmp and would report "the harness is POSIX-bound", a fact already known, while burying the signal actually wanted. It is not a dependency of `build`, so a platform failure is visible without blocking the pipeline.

macOS LEG: verified locally before pushing, on this machine, running exactly what CI runs — lint PASS, build PASS, unit 792/792. Expect green.

WINDOWS LEG: expect RED, and expect it for harness reasons rather than product reasons. Predicted failures, 8 of 59 unit files:

  agentIdentitySeam.test.ts   hardcoded /tmp
  config.test.ts              hardcoded /tmp
  extensionLoader.test.ts     hardcoded /tmp
  projectResolution.test.ts   hardcoded /tmp
  zoom.test.ts                hardcoded /tmp
  atomicWrite.test.ts         chmod — Windows has no equivalent permission semantics,
                              so a directory made unreadable to force EACCES stays readable
  readPathFailures.test.ts    chmod, same reason
  recordIdAllocator.test.ts   spawns a POSIX shell

The remaining 51 use os.tmpdir() and path.join and should port unchanged.

HOW TO READ THE RESULT. A failure on that list is a test-portability defect and belongs to a separate clean-up (swap `/tmp` for os.tmpdir(), and gate or rewrite the chmod-based absence fixtures). A failure OUTSIDE that list is a genuine cross-platform product finding and is the reason this job exists. Recording the prediction in advance is what makes that distinction checkable rather than a judgement call after the fact — if something outside the list fails, the prediction was wrong and that is itself worth knowing.

[2026-09-19] FIRST RUN RESULT, scored against the prediction. macOS green as predicted. Windows red as predicted — but my prediction of WHICH files would fail was materially wrong, and the way it was wrong is the useful part.

Actual: 11 failed, 48 passed, of 59 unit files.

  predicted to fail AND failed (4/8): atomicWrite, extensionLoader, readPathFailures,
                                      recordIdAllocator
  predicted to fail but PASSED (4):   agentIdentitySeam, config, projectResolution, zoom
  FAILED, NOT PREDICTED (7):          architect, daemonLaunchd, designer, guardian,
                                      issueUpdateRoundtrip, projectPaths, sentinel

So I called half of my own list and missed seven. The hardcoded-/tmp heuristic was the weak
part: four files containing a literal /tmp passed anyway, because they only used it in
strings that were never opened.

TRIAGE OF THE SEVEN. Six are one shared test-portability defect I did not anticipate:
assertions of the form `expect(p).toContain('sentinel/issues')`, comparing a FORWARD-SLASH
fragment against a real path that Windows builds with backslashes. The product builds those
paths correctly with path.join; only the assertions hardcode the separator. That pattern
accounts for architect, designer, sentinel, guardian, issueUpdateRoundtrip and part of
daemonLaunchd (whose plist test also asserts a POSIX path inside generated XML, and which
should be skipped off darwin anyway — launchd is macOS-only, which is item 2 of this issue).

THE SEVENTH IS A REAL PRODUCT BUG, filed as ISS-0177. projectPaths asserted that resolving
an unknown project id OUTSIDE a project throws; on Windows it resolved to
`{ projectId: 'RUNNER~1' }`. findDecibelDir() walks up looking for any `.decibel` and does
not exclude the home directory — but ~/.decibel is the GLOBAL CONFIG directory, so HOME gets
returned as a project root with id = basename(home). Windows only surfaced it because %TEMP%
lives inside %USERPROFILE%; it reproduces on macOS from ~/Documents, resolving to id
'Ashitaka'. Silent wrong answer, and what it writes into is the directory every project
shares.

VERDICT ON THE EXERCISE. The job paid for itself on its first run: one genuine
cross-platform defect, latent for as long as CI ran on a single platform, found within an
hour of adding the second and third. The prediction being wrong is not a failure of the
method — writing it down in advance is precisely what made "six share one cause and the
seventh is real" a checkable statement rather than a post-hoc story.

NEXT, and deliberately not done here: the separator assertions are a mechanical fix (assert
with path.join, or normalise before comparing) across six files; daemonLaunchd wants a
darwin guard; ISS-0177 wants a real fix. None of that blocks anything, since test-platforms
is not a dependency of build.
