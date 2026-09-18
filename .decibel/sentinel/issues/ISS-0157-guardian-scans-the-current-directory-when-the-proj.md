---
uid: 01a0729f-35b6-7daa-a5c7-a87ec442c475
id: ISS-0157
projectId: decibel-tools-mcp
severity: med
status: open
priority: medium
tags:
  - guardian
  - torture-test
  - project-resolution
created_at: 2026-09-05T17:30:31.733Z
linked_commits:
  - sha: 256e95c5913fb4eadea3b6f6703981cd3f7f1ee0
    shortSha: 256e95c
    message: "sentinel: file ISS-0157 for guardian's cwd fallback"
    relationship: related
    linked_at: 2026-09-05T17:30:36.853Z
    linked_by: ai:claude
  - sha: b8ada1501beb525461c3b6b58c5c1f2b431fc9b5
    shortSha: b8ada15
    message: "sentinel: link ISS-0157 to the commit that filed it"
    relationship: related
    linked_at: 2026-09-06T02:00:06.944Z
    linked_by: ai:claude
updated_at: 2026-09-06T02:00:06.944Z

---
# guardian scans the current directory when the project id resolves to nothing

**Severity:** med
**Status:** open

## Details

Found by the torture test's S2 sweep (unresolvable situation), while waiving guardian from S2 for a different reason.

Every guardian scan resolves the project and falls back to process.cwd() on failure:

    try { projectPath = resolveProjectPaths(input.project_id).projectPath; }
    catch { projectPath = process.cwd(); }

(src/tools/guardian.ts — scanDeps ~line 226, scanSecrets ~line 256, and the same shape in the others.)

So `guardian scan_deps project_id: "typo-here"` does not fail. It audits whatever directory the caller happens to be in and returns a grade, reported under a project id that names nothing on this machine. All five actions behave this way, and guardian.report aggregates them.

The fallback is deliberate — the pre-push hook calls guardian with no project_id and relies on the cwd walk — so removing it outright would break that. The distinction worth drawing is between "no project_id given" (walk the cwd, as designed) and "a project_id was given and did not resolve" (say so).

Not the same defect as ISS-0153. That one is about a store you cannot read being reported as empty. This is about the WRONG project being reported as the right one, which no store fix touches.

Repro: from any repo, call guardian scan_deps with project_id set to a string that is not in the registry. Compare against calling it with a valid id for a different project — the answers describe the same directory.

S2 waivers for guardian.* record this in tests/torture/waivers.yaml.
