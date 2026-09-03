# Tool Torture Test — release gate for 3.0

**Status:** design, not built
**Date:** 2026-09-02
**Surface under test:** 35 facades / ~269 facade actions / 272 internal tools, across 4 transports
**Blocks:** publishing `@decibelsystems/tools@3.0.0` to the `latest` npm tag

---

## The premise

Every failure this project has actually shipped returned `ok: true`.

| Incident | What the caller saw |
|---|---|
| Voice inbox dead for 5½ hours | `voice 0` in the session digest |
| Regenerated plist dropped 4 facades | `/health` → `status: ok`, 31 facades |
| `/batch` given a facade that does not exist | `{status: 'executed', ok: true}` |
| Agentic zod validator orphaned 7.7 months / 98k events | rendered payloads, `ok: true` |
| `internal_tool_count` counted the wrong collection | a plausible number, 227 vs 272 |
| Three releases of a hollow `.mcpb` bundle | every test green |
| `read_epic` dropping the notes `update_epic` wrote (#72) | a well-formed epic, minus a field |

None of these threw. None would be caught by a fuzzer looking for crashes, and none
were caught by 735 passing tests. The failure mode of this system is **a plausible,
well-formed, wrong answer** — usually one shaped like emptiness.

So the torture test is not "throw garbage at it and see if it falls over." It is:

> **For every tool, on every transport: is a failure distinguishable from a success,
> and is a full answer distinguishable from a truncated one?**

Everything below serves that question.

---

## Structural rule: generate, never enumerate by hand

The harness is built **from `coreFacades` / `proFacades` / loaded extensions at
runtime**, not from a hand-written list of tools to test.

This is the single most important design decision here, and it is a direct
consequence of the orphaned-validator bug: a hand-maintained test list drifts out of
sync with the surface silently, which is the same class of bug we are trying to
catch. A generated harness cannot drift — adding a tool without giving it torture
coverage turns the build red.

Consequence: every action must be **claimed** by a sweep or **waived** in
`tests/torture/waivers.yaml` with a reason and an owner. An unclaimed action fails
S0. A waiver is a visible, reviewable decision; an untested tool is not.

```yaml
# tests/torture/waivers.yaml
- action: studio.generate_video
  sweeps: [S1, S2]
  waived: [S3]
  reason: "Write has no paired read; output is a remote asset URL, not a stored record."
  owner: ben
  expires: 2026-12-01
```

Waivers expire. An expired waiver fails the build.

---

## S0 — Enumeration invariant (the meta-sweep)

Runs first; everything else is downstream of it.

1. Every facade action resolves to a tool registered in the kernel's `toolMap`.
2. Every internal tool is reachable — from a facade action, or named in the
   raw-name allowlist (`sentinel_listIssues`, `sentinel_createIssue`,
   `codereview_ingest`), or it fails.
3. Every action is claimed by ≥1 sweep or carries an unexpired waiver.
4. Counts reported by `/health` equal counts derived from the registry. (The
   `internal_tool_count` bug was exactly this assertion, absent.)

**Catches:** orphaned code paths, tools that exist but nothing can call, drift
between what the server reports and what it can do.

---

## S1 — Envelope conformance (all ~269 actions)

Call every action with minimally valid params. **Success is not asserted** — many
will legitimately fail on missing required arguments. What is asserted is that the
answer is *legible*:

- `content[0]` parses as JSON. Always. Including on the failure path.
- The failure marker is present **iff** the call failed — no prose-only errors, no
  error text smuggled into a success payload.
- No response is *only* human-readable text.
- Structural failures (unknown facade/action) carry a machine-readable `code`, set
  before dispatch, with no `result` key at all.

**Catches:** the `/batch` family — a failure that survives only as prose in a text
node. `toolResponseShape.test.ts` asserts this today for two helpers; S1 makes it
universal.

---

## S2 — Absence is loud (the negative sweep)

The sharpest sweep, and the one aimed straight at this project's worst bug class.

For every read action, produce four situations and demand four **distinguishable**
answers:

| Situation | Must not be confusable with |
|---|---|
| Store genuinely empty | anything below |
| Store unreadable (chmod 000) | empty |
| Records present but unparseable | empty |
| Project does not resolve | empty |

The core assertion is a **difference**, not a value:

```
read(empty_store) !== read(broken_store)
```

Plus: unreadable and unparseable records must be **counted**, not dropped —
`readPathFailures.test.ts` already asserts this for `listProvenance`; S2 generalizes
it to every read in the registry.

Also here: a pro/apps facade that is not loaded must return a hard error, never a
zero-shaped success. *Fail-closed by absence is only safe if absence is loud.*

**Catches:** `voice 0`, the missing four facades, and every future instance of
"nothing to report" being indistinguishable from "I could not look."

---

## S3 — Round-trip saturation (write/read pairs)

Declared pairs (`create_issue`↔`read_issue`, `log_epic`↔`read_epic`,
`friction_log`↔`friction_list`, …). For each: write a record with **every optional
field populated**, read it back, assert nothing was silently dropped or mutated.

The point is saturation. `read_epic` lost notes (#72) because the round-trip that
was tested used a record with the common fields set, and notes were not among them.

**Hostile value corpus** — every string field gets each of these in turn:

- YAML metacharacters: `: `, `#`, `---`, `|`, `>`, `&anchor`, `*ref`, `!!str`, leading/trailing space
- Type-ambiguous scalars: `"true"`, `"no"`, `"1.0"`, `"0755"`, `"2026-09-02"`, `"null"`, `"~"`
  (these are where a YAML round-trip turns a string into a bool/int/date/null)
- Multiline, `\r\n`, tabs, a 10 000-character value
- Unicode: emoji, combining marks, RTL, zero-width joiner, NFC vs NFD pairs
- Empty string — asserted **distinct from absent**, in both directions
- Markdown that collides with the file format: `## Resolution`, `---` frontmatter fences

Assertions: deep equality on every written field; type preserved (`"true"` reads
back as the string, not `true`); no field silently normalized; the on-disk file
re-reads identically after a no-op update.

**Catches:** the writer/reader drift family — three confirmed bugs, one of them
merged eight days ago.

---

## S4 — Transport equivalence

The same call, four ways: **stdio**, **thin stdio client**, **HTTP `/call`**,
**HTTP `/batch`**. Payloads must be identical modulo a declared, asserted list of
legitimate envelope differences.

Run the S1 and S2 sweeps through each transport rather than only through the kernel.
A kernel-level test cannot see a transport that mangles or swallows a result — and
"both transports must stay in sync" is a stated project rule with no test behind it.

Include the batch-specific contract: outer `ok: true` with an inner `isError` is a
normal partial failure; outer `ok: false` is reserved for structural misses. Assert
both, since the distinction is load-bearing and easy to "simplify" away.

**Catches:** a tool that works in Claude Code and is missing in ChatGPT.

---

## S5 — Concurrency and crash (the actual torture)

`atomicWrite` and single-writer are tested sequentially today. Under contention:

- N=50 concurrent `create_issue` → 50 distinct IDs, 50 files, zero lost writes.
  (There have already been four duplicate-id groups in this store.)
- Concurrent `update_issue` on one issue → last-write-wins or explicit conflict;
  never a merged/corrupt file.
- `SIGKILL` mid-write, then read → the file is the old version or the new version,
  never a truncated one, and never a stray temp file left behind.
- Daemon killed with in-flight requests → drain behaves as documented; restart
  finds a consistent store.
- Interleaved write via HTTP and via stdio against the same project simultaneously.

**Catches:** the class this store is structurally exposed to — one writer claim,
many callers, files on a RAID volume with a slow catalog.

---

## S6 — Tier and extension boundary

- Core tier calling a pro or apps facade → refused, loudly, before dispatch.
- Extension not in the allowlist → not loaded **and** listed in
  `/health.extensions.rejected` with a reason.
- Relative-path allowlist entry → refused (a bare specifier resolves against
  `node_modules`, which hands facade selection to whoever can write a package).
- Extension shadowing a registered facade name → refused.
- Extension whose module throws on import → rejected with a reason, server still boots.
- No environment variable can re-enable an apps facade. (Assert `DECIBEL_APPS=1`
  is inert now — it is gone, and it must stay gone.)

**Catches:** regression of Phase 7's whole point.

---

## S7 — The packed artifact, not the source

Everything above runs a second time against `npm pack` output, installed into a
clean temp directory with a **scrubbed environment** (no `DECIBEL_*`, no
`SUPABASE_*`, no `NODE_ENV=development`, `HOME` pointed at an empty dir).

Three releases shipped a hollow bundle while every source test passed. Source tests
cannot see `tsconfig.build.json` excludes, `files:` in package.json, a missing
export map, or a dependency that was transitive-and-undeclared (which `zod` was,
until three commits ago).

Release-blocking assertions on the tarball itself:

- The server boots from the packed entry point (`dist/server.js`) with an empty env.
- S1 and S2 pass against it — a core-tier install answers, or refuses loudly.
- Every declared runtime dependency is present; `npm ls` is clean.
- **The tarball contains no apps sources** — no `senken`, `deck`, `mother`,
  `terminal` implementation, and no FacadeSpec describing them. This is Phase 7's
  promise to the public mirror and it is now a release gate, not an intention.
- A core install with no license and no network still starts and serves core.

**Catches:** everything that is true of the repo and false of the thing users install.

---

## What blocks 3.0

| Sweep | Gate |
|---|---|
| S0 enumeration | **hard** — no unclaimed actions, no expired waivers |
| S1 envelope | **hard** — 100% of actions |
| S2 absence | **hard** — 100% of read actions |
| S3 round-trip | **hard** for declared pairs; unpaired writes need a waiver |
| S4 transports | **hard** — stdio and HTTP must agree |
| S5 concurrency | **hard** for sentinel issues/epics; advisory elsewhere for 3.0 |
| S6 tier/extension | **hard** |
| S7 artifact | **hard** — this is the one that has actually bitten us |

## Build order

1. **S0 + S1** — the generated harness itself. Everything else is a sweep plugged
   into it. Expect this alone to surface unreachable tools.
2. **S2** — highest bug yield per line, aimed at the known-worst class.
3. **S7** — cheap once S1 exists, and it guards the actual release.
4. **S3** — most laborious (pairs must be declared) and highest long-term value.
5. **S4**, then **S6**, then **S5**.

Stop after step 3 and 3.0 is already better guarded than any release so far.

## Expected outcome

This will fail on first run, and the failures are the deliverable. If S0–S2 come
back green across 269 actions on the first attempt, **distrust the harness** — the
likeliest explanation is that the sweep is not reaching the tools, which is itself
the bug it was built to detect. Verify non-circularly: assert the harness can see a
deliberately broken tool before believing it about the healthy ones.

## Related

- `EPIC-0038` — runtime consolidation; Phase 7 is what S6 and S7 defend
- ISS-0020 — orphaned validator; `validateRoleRequirements` is still unenforced
- PR #72 — `read_epic`/`update_epic` drift, the most recent S3-class bug
- `tests/unit/readPathFailures.test.ts` — S2 done by hand for one module
- `tests/unit/toolResponseShape.test.ts` — S1 done by hand for two helpers
