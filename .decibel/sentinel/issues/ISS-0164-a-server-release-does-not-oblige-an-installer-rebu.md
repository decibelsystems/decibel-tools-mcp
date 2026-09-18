---
uid: 01a07d18-29d1-73c6-913a-999803b438b6
id: ISS-0164
projectId: decibel-tools-mcp
severity: med
status: open
priority: high
tags:
  - installer
  - release-process
  - cross-repo
  - drift
created_at: 2026-09-07T18:18:50.705Z
---
# A server release does not oblige an installer rebuild — the bundle sat a full major behind, unsignalled

**Severity:** med
**Status:** open

## Details

SYMPTOM. `decibel-installer` last moved 2026-08-27, one day BEFORE the 3.0 arc began (first 3.0 commit 2026-08-28), and its manifest still read "Bundled server: @decibelsystems/tools 2.1.4" while npm `latest` was 3.0.0. Nobody was told. Nothing turned red.

WHY IT MATTERS MORE THAN A STALE PIN. The installer is the only artifact a non-technical user ever touches, and 3.0 contains a change that is specifically FOR it: private facades (senken, deck, mother, terminal) left the public package, which is what makes a public bundle shippable without shipping a description of a live trading system. The release did the work and the artifact that needed it did not collect.

STRUCTURAL CAUSE. The two repos are coupled by a version string and nothing else. `decibel-installer/package.json` carries `decibel.serverVersion`, and there is no check anywhere — in either repo — that compares it to the published `latest`. The installer's own build is careful (allowlist packing, staged-tree verification, structure-drift assertion, facade allowlist) but every one of those guards fires only when someone chooses to run a build.

This is the same failure family the 3.0 torture test was written for. S7 asserts things about the packed tarball of THIS repo; nothing asserts anything about the downstream artifact that wraps it.

WHAT WOULD FIX IT (pick one, cheapest first):
1. A release-checklist item — weakest; it is what already implicitly existed and did not fire.
2. A check in this repo's release path that reads decibel-installer's `decibel.serverVersion` and warns when it trails the version being published.
3. A scheduled job in decibel-installer comparing its pin against `npm view @decibelsystems/tools version` and opening an issue on drift. Survives someone forgetting, which is the actual threat model.

VERIFIED COMPATIBLE. Checked 2026-09-07 before the 3.0 rebuild — every structural dependency the installer's build.mjs has on the server survives 3.0: `package.json.main` is still `dist/server.js`; `dist/tools/registry/index.js` still exists (assertStructureInSync reads it); `DECIBEL_FACADES` is still honored (`src/kernel.ts:362-370`, `src/toolConfig.ts:251-256`); `DECIBEL_STRUCTURE` still lives in the registry. So the lag cost nothing this time. That is luck, not design.

NOTE. `DECIBEL_APPS=1` was removed in 3.0. The manifest never set it, and build.mjs's `assertFacadeAllowlist` independently forbids the apps facades, so the breaking change did not reach the bundle — a second piece of luck worth converting into a test.
