---
uid: 01a07a19-1ea7-78fe-832d-465ffa94aec9
id: ISS-0159
projectId: decibel-tools-mcp
severity: med
status: open
priority: low
created_at: 2026-09-07T04:21:01.734Z
---
# Two builds share one dist/ — postpack patches the symptom, one build would remove the cause

**Severity:** med
**Status:** open

## Details

Filed as the considered alternative to the postpack hook added 2026-09-06, so the
structural option is a recorded decision rather than an unwritten thought.

THE SHAPE OF IT

`dist/` serves two masters. It is the directory that gets packed, and it is the
directory every local client reads — Claude Desktop spawns `dist/server.js`, the
daemon runs from it, and the extension allowlist in ~/.decibel/config.yaml names
`dist/tools/*.js` by absolute path. Two different builds write to it:

  build       tsc                                    (tsconfig.json — everything)
  build:dist  rm -rf dist && tsc -p tsconfig.build.json  (excludes the 4 apps modules)

`prepack` runs the second. So packing or publishing in the repo root replaces the
working build with the publish build, and every local client silently loses four
facades. The only signal is four "Extensions: rejected — file does not exist" lines
on stderr; /health would have said status ok. This broke Claude Desktop on
2026-09-06, twice, from `npm pack --dry-run` run merely to INSPECT the tarball.

WHAT SHIPPED INSTEAD

`postpack: npm run build`, which restores the dev build after packing, plus
tests/unit/packLifecycle.test.ts asserting the restore exists and uses the dev
config. Verified: `npm pack --dry-run` now leaves dist intact, and the guard fails
when postpack is deleted.

That is a patch on the symptom. It leaves the trap armed for any path where
postpack does not run — `--ignore-scripts`, an interrupted publish, a pack that
throws before the hook.

THE STRUCTURAL FIX, and why it was not done tonight

Drop the second build entirely. Nothing statically imports the apps modules — Phase
7 moved their FacadeSpec out and they load only by absolute path from the allowlist
(verified: the sole reference left in src/ is a comment in circuitBreaker.ts). So one
dev build could serve both purposes, with npm excluding the private artifacts at pack
time via negation in package.json `files`:

  "files": ["dist", "!dist/tools/senken.*", "!dist/tools/deck.*",
            "!dist/tools/mother.*", "!dist/tools/terminal.*", ...]

Then there is no rm -rf, no publish-specific tsconfig, nothing to restore, and the
hazard is gone rather than papered over.

Not done on the night of the 3.0.0 publish, for one reason: if `files` negation
misbehaves on some npm version, the failure mode is that four private modules —
including a live trading Postgres client and a wallet-spending tool — LEAK into the
public package. That is the exact leak EPIC-0038 Phase 7 closed. S7 does guard it
(the tarball assertion is a hard release gate), so the change is testable and
probably safe; it is simply not a thing to do at speed hours after a major release.

BEFORE DOING IT, CHECK
- `files` negation behaviour on the npm versions in use (10.9.2 locally, CI matrix).
- That .d.ts, .js.map and .d.ts.map variants are all covered by the patterns.
- That S7's premise is updated: it currently packs through prepack and comments that
  "packing any other way would test a tarball nobody ships."
- Whether the extension modules should simply live outside src/ altogether, which is
  the Phase 7 idea taken to its conclusion and makes the exclusion structural rather
  than a list someone must remember to extend.</details>
<parameter name="tags">["build", "packaging", "footgun", "epic-0038"]
