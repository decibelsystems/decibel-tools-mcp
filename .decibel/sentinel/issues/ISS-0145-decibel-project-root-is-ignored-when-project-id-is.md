---
uid: 01a04f06-1fe9-7243-8aeb-a47ddb08b190
id: ISS-0145
projectId: decibel-tools-mcp
severity: med
status: open
created_at: 2026-08-29T19:36:36.585Z
---

# DECIBEL_PROJECT_ROOT is ignored when project_id is undefined — cwd wins instead

**Severity:** med
**Status:** open

## Details

Setting DECIBEL_PROJECT_ROOT=/some/other/checkout and calling a tool without an explicit project_id resolves to the CURRENT WORKING DIRECTORY's project, not the one named by the env var. The env var is silently ineffective.

REPRO
  cd /repo/decibel-tools-mcp
  DECIBEL_PROJECT_ROOT=/tmp/otherstore npx tsx -e "
    const { resolveProjectPaths } = await import('./dist/projectRegistry.js');
    console.log(resolveProjectPaths(undefined).projectPath);
  "
  => /repo/decibel-tools-mcp        (expected /tmp/otherstore)

Running the same code with cwd=/tmp/otherstore resolves correctly, which confirms cwd discovery is what is winning.

WHY IT HAPPENS
The documented strategy order (CLAUDE.md) is:
  3. DECIBEL_PROJECT_ROOT (basename match)
  5. walk up from cwd (basename match)
  6. DECIBEL_PROJECT_ROOT fallback (any id treated as label)
  7. cwd fallback

Strategies 1-3 all match an id against something. With project_id undefined there is no id to match, so 3 cannot fire and resolution falls through to 5/7. But strategy 6 — the DECIBEL_PROJECT_ROOT fallback — is documented to precede the cwd fallback at 7, and it does not fire either. With no id supplied, an explicitly-set DECIBEL_PROJECT_ROOT is the strongest signal available and should win over cwd.

WHY IT MATTERS BEYOND THE OBVIOUS
This produces silently-vacuous verification. It was found while diffing the issue store before and after the Phase 3 uid backfill: two runs pointed at two different stores via DECIBEL_PROJECT_ROOT both read the SAME store and reported "0 differences". The comparison looked like strong evidence the migration was inert and was in fact evidence of nothing. Any script, test, or agent that uses the env var to point at an alternate checkout is getting answers about the wrong project with no error and no warning.

That is the dangerous shape: not a crash, but a confident wrong answer.

SUGGESTED FIX
When project_id is undefined and DECIBEL_PROJECT_ROOT is set and contains a .decibel/ directory, resolve to it before attempting cwd discovery. Add a test asserting that two processes with different DECIBEL_PROJECT_ROOT values from the same cwd resolve to different projects.

Found during EPIC-0038 Phase 3.
