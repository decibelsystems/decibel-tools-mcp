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
linked_commits:
  - sha: b72a20dea89a08e96bfc2770b4cc7a8d64a3b1b4
    shortSha: b72a20d
    message: "sentinel: ISS-0169 — the installed hooks are a release behind the repo"
    relationship: related
    linked_at: 2026-09-18T21:41:22.686Z
    linked_by: ai:claude
  - sha: 3b03008c718d644229d9349da6cde172fdc5c6df
    shortSha: 3b03008
    message: "sentinel: auto-linked commit metadata for ISS-0169 and ISS-0170"
    relationship: related
    linked_at: 2026-09-18T22:09:49.676Z
    linked_by: ai:claude
updated_at: 2026-09-19T14:52:43.622Z
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

[2026-09-19] ROOT CAUSE FOUND — the hooks were installed by COPY when the design calls for SYMLINKS.

hooks/install.sh states the intent in its own header:

  "Single source of truth = this repo's hooks/. ~/.decibel/hooks/ symlinks back here,
   so editing the vendored files (or `git pull`) updates the live hooks."

That property is exactly what would make drift impossible. It is not in force here:

  ~/.decibel/hooks/session-init.sh          REAL FILE (not a symlink)
  ~/.decibel/hooks/issue-close-reminder.sh  REAL FILE (not a symlink)

So the live hooks are frozen copies, and every repo fix — including all of PR #75's
hardening — stops at the repo boundary. The stray session-init.sh.bak and
session-init.sh.bak-20260907 sitting beside them are the fingerprints of hand-copying.
install.sh has never been run on this machine (it is repo-only, not present in
~/.decibel/hooks/).

FULL HOOK HEALTH, measured 2026-09-19:

REGISTERED AND RUNNING (all three from the global ~/.claude/settings.json, i.e. all three
are the drifted copies — the decibel-tools plugin is NOT installed here, so hooks/hooks.json
never fires and its portable ${CLAUDE_PLUGIN_ROOT} registration is inert):

  SessionStart  session-init.sh          runs, exit 0, valid JSON, ~3.3s
  PostToolUse   vector-event.sh          runs, exit 0, ~89ms per tool call
  PostToolUse   issue-close-reminder.sh  runs

DEFECTS PRESENT IN THE RUNNING COPIES:
  session-init.sh          no Authorization header      (PR #75 fix not installed)
  session-init.sh          checks "status", not "results" (PR #75 fix not installed)
  session-init.sh          no roadmap line              (PR #75 fix not installed)
  issue-close-reminder.sh  D1 unanchored trailer grep   (ISS-0168, also in the repo copy)
  issue-close-reminder.sh  D2 resolution overwrite      (ISS-0168, also in the repo copy)

The first two are LATENT rather than active: config.yaml has no auth_token set and the
daemon answered an unauthenticated /batch, so nothing is being mis-read today. They become
live the moment a token is configured — and the "status" check is what makes that failure
silent, since an auth/error envelope carries that field too.

UNVERSIONED RUNNING CODE, which is the finding I did not expect. Four installed hooks exist
in no repository at all — vector-event.sh, vector-sync.sh, log-event.sh, sync-events.ts.
vector-event.sh is REGISTERED and fires after every tool call at ~89ms. If this machine is
lost, so is it, and no other machine has it.

SEQUENCE THAT FIXES THIS PROPERLY, and note the order matters:
1. Fix ISS-0168 in the repo first. Running install.sh today would ship a close hook that
   still clobbers resolutions — better than the current one in every other respect, but it
   would propagate that defect rather than retire it.
2. Then run hooks/install.sh so ~/.decibel/hooks/ becomes symlinks. That fixes drift
   permanently instead of once.
3. Decide what to do about the four unversioned hooks: vendor them into hooks/ or
   deliberately drop them. Leaving registered, unversioned code running on one machine is
   the weakest link in the chain.
