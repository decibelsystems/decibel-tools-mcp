---
uid: 01a0ba14-e7b4-7435-941d-3b97547cf5d6
id: ISS-0177
projectId: decibel-tools-mcp
severity: high
status: closed
priority: high
tags:
  - cross-platform
  - project-resolution
  - silent-wrong-answer
  - windows
  - ci-found
created_at: 2026-09-19T14:32:07.348Z
updated_at: 2026-09-20T00:07:33.650Z
closed_at: 2026-09-20T00:07:33.549Z
resolution: "Resolved by commit 43864d9: registry: the global config directory is not a project"
linked_commits:
  - sha: bcc5422bad2b1aac0beaf02406003c878d0c9dea
    shortSha: bcc5422
    message: "sentinel: the Windows leg found a real one on its first run — ISS-0177"
    relationship: related
    linked_at: 2026-09-19T14:32:48.348Z
    linked_by: ai:claude
---
# The project walk-up mistakes the global ~/.decibel config directory for a project, so HOME resolves as a project root

**Severity:** high
**Status:** closed

## Details

FOUND BY the Windows CI leg on its first run, one hour after it was added (ISS-0176).

SYMPTOM. projectPaths.test.ts asserts resolveProjectRoot THROWS for an unknown projectId
when not inside a project. On Windows it resolved instead:

    promise resolved "{ projectId: 'RUNNER~1', ... }" instead of rejecting

RUNNER~1 is the 8.3 short-name of the runner's home directory.

CAUSE, and it is not Windows-specific. src/projectPaths.ts findDecibelDir() walks up from
a starting directory looking for ANY `.decibel` folder, with no exclusion for the home
directory:

    while (true) {
      const candidate = path.join(current, '.decibel');
      if (exists && isDirectory) return current;   // "project root"
      ...walk to parent
    }

But `~/.decibel` is the GLOBAL CONFIG directory — it holds projects.json, device.json,
daemon.meta, config.yaml and hooks/. It is not a project. The walk-up cannot tell the
difference, so it returns HOME as a project root and derives the project id from
path.basename(home).

WHY WINDOWS SURFACED IT AND THE OTHERS DID NOT. It is purely where the temp directory
lives. On macOS os.tmpdir() is /var/folders/..., on Linux /tmp — neither is under $HOME, so
a walk-up from a temp directory never reaches ~/.decibel and the bug stays latent. On
Windows %TEMP% is C:\Users\<user>\AppData\Local\Temp, INSIDE the home directory, so every
walk-up from a temp path passes through it.

REPRODUCED ON macOS, so this is a product defect rather than a CI artifact:

    from ~/Documents  -> ~   HOME mistaken for a project, id=Ashitaka
    from ~/Desktop    -> ~   HOME mistaken for a project, id=Ashitaka
    from os.tmpdir()  -> (none)

So on any platform, running Decibel from a directory under $HOME that is not itself a
project resolves to a "project" rooted at the home directory.

CONSEQUENCE. Instead of a clean PROJECT_NOT_FOUND — which the registry has good, actionable
error text for — the caller silently gets a project whose root is $HOME and whose id is the
home folder's name. Any subsequent write targets ~/.decibel/sentinel/issues/... , i.e. it
writes project records INTO the global config directory. This is the silent-wrong-answer
family again: the failure mode is not an error, it is a confident wrong answer, and the one
place it writes to is the directory every project shares.

SUGGESTED FIX:
1. findDecibelDir must not treat os.homedir() as a project root. Stop the walk before HOME,
   or skip a candidate whose parent is HOME, or require a project marker that the global
   config directory does not have (projects.json/device.json/daemon.meta living there is
   itself the discriminator).
2. Whichever is chosen, a `.decibel` directly in HOME should produce the actionable
   "not a project" error rather than a resolution.
3. Add the macOS repro above as a test — it does not need Windows to fail once the walk-up
   is asked about ~/Documents.

WORTH NOTING for the tri-platform discussion: this bug is platform-independent in cause and
was invisible for as long as CI ran on one platform. It was caught within an hour of adding
the second and third. That is the return on ISS-0176.

## Resolution

Resolved by commit 43864d9: registry: the global config directory is not a project
