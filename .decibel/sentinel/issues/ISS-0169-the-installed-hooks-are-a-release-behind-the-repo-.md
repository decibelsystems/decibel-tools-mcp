---
uid: 01a0b677-4ab7-723f-aea9-71848d6107c5
id: ISS-0169
projectId: decibel-tools-mcp
severity: med
status: open
priority: high
tags:
  - hooks
  - drift
  - install
  - release-process
  - pr-75
created_at: 2026-09-18T21:41:06.359Z
---
# The installed hooks are a release behind the repo — Rich's PR #75 hardening is not running on this machine

**Severity:** med
**Status:** open

## Details

SYMPTOM. ~/.decibel/hooks/ and hooks/ in the repo have diverged, and the
installed copy is the one that actually runs. Verified 2026-09-18:

  session-init.sh          29 differing lines
  issue-close-reminder.sh  12 differing lines

In both cases the installed copy is OLDER. It is missing everything Rich
merged in PR #75 (2026-09-18):

  - the daemon auth token (Authorization: Bearer from config.yaml) — so the
    hook calls a token-protected daemon unauthenticated
  - the config.yaml port fallback, and the jq-based daemon.meta read that
    replaced a python3 one-liner
  - the `"results"` envelope check that replaced the `"status"` check — and
    per the feedback note on the /call envelope quirk, `status` is exactly the
    field that also appears in an auth/error envelope, so the stale copy treats
    a rejected call as a successful one
  - roadmap read in the batch, and the roadmap line in the digest

OBSERVABLE PROOF. This session's SessionStart digest had no roadmap line.
Running the repo copy by hand in the same directory, minutes later, produced
one: "roadmap: Domain Tooling (due 2026-10-31, 4 epics)". Same daemon, same
project, different hook.

WHY IT MATTERS. Every hook fix is written in the repo, reviewed in the repo,
and merged in the repo — and then does not run. The hardening most worth having
is the auth token and the envelope check, and both are sitting uninstalled. It
also means a hook bug fixed in the repo stays live on every machine until
someone remembers to copy files by hand, which is the same shape as the
installer-drift issue (ISS-0164): the artifact people actually use is not
rebuilt by the act of merging.

NOT A NEW OBSERVATION. ISS-0160 recorded repo-vs-installed hook drift already.
This issue records that it happened again, in the other direction, to the
specific commits from PR #75, with the proof above.

WHAT WOULD FIX IT (cheapest first):
1. An install step that copies hooks/ to ~/.decibel/hooks/ and is run by
   whatever already runs on upgrade.
2. A version or content hash in each installed hook, and a session-init check
   that says out loud when the installed copy differs from the repo's.
3. Point the settings.json hook entries at the repo copy directly for this
   project, so there is no second copy to drift.

Note the old .bak files beside them (session-init.sh.bak,
session-init.sh.bak-20260907) — evidence that the current install procedure is
someone copying a file by hand.
