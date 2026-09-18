# Changelog

## 3.0.0 — 2026-09-06

Decibel Tools stopped being a daemon, an MCP server, a CLI, a store and a VS Code
extension that happen to share a repo. It is **one runtime with several adapters**.
An adapter translates transport and establishes project context; it does not
instantiate its own store, caches, project registry, or write path.

That is the whole of 3.0. Everything below follows from it.

### Breaking

- **`DECIBEL_APPS=1` is gone, and no environment variable replaces it.** The
  apps-tier facades (`senken`, `deck`, `mother`, `terminal`) are no longer compiled
  into the package. They load at boot as extensions, from `extensions.allow` in
  `~/.decibel/config.yaml`, **by absolute path only** — a bare specifier would
  resolve against `node_modules`, which would hand facade selection to whoever can
  write a package. An extension may not shadow a registered facade name.

  Config-file state the owner edits beats environment state a generator has to
  remember: a regenerated launchd plist silently dropped those four facades once,
  and `/health` reported `status: ok` with no indication four were missing.

- **The public package no longer describes private facades.** It previously shipped
  compiled `senken.js` and `deck.js` — a description of a live trading Postgres and
  a wallet-spending tool it could never reach. `S7` now asserts their absence from
  the tarball on every run.

- **An unregistered facade is a hard error, not an empty success.** Fail-closed by
  absence is only safe if absence is loud. A call to something that was never
  registered returns `ok: false` / `TOOL_ERROR`; it does not return zero rows.

- **Issue records are canonical markdown.** All 58 remaining bare-YAML records were
  converted; the store is markdown-only. Timestamp-slug *filenames* are deliberately
  kept (ADR-0010) — 49 provenance events and 2 ADRs reference them, and provenance
  events are immutable audit records. Identity is the `id:` field, which is already
  how records resolve.

- **Adapters do not silently become writers.** There is no in-process fallback for
  mutations. A thin client auto-starts the runtime, retries briefly, then fails with
  an actionable error.

### The surface

| Tier | Facades | Actions | How it loads |
|---|---|---|---|
| core | 26 | 183 | always |
| + pro | 31 | 224 | license-gated at runtime |
| + apps | — | — | extensions, absolute-path allowlist, not in the package |

### Store integrity

- **One writer.** `sentinelIssues.createIssue` delegates to `FsIssueRepository`;
  there is no longer a second implementation emitting a different format into the
  same directory.
- **Id allocation is serialized across processes.** A file lock spans allocation
  *through successful write* — serializing only the id scan leaves the race intact,
  since both processes still compute the same number before either file lands — and
  the write itself is `O_EXCL` as a second, independent defence against callers that
  never take the lock. Applies to issues **and epics**; epics were still racing
  until the S5 sweep found it (ISS-0158).
- **Structured fields are parsed, mutated, serialized and atomically renamed**, never
  edited by regex. Values containing `#`, `:`, `---` or a markdown heading survive
  read-back.
- **Repair, once.** `degraded` went 10 → 0, duplicate ids 4 groups → 0, wrong
  `project` values 18 → 0. All three are now invariants CI can fail on. Most of the
  degraded records carried a completed resolution and were open only because an old
  status write had failed — the correct repair was to close them, not reformat them.
- **Status is no longer stored twice by hand.** Markdown records mirror status into
  the body; 16 had drifted from frontmatter, reading `open` to a person while every
  tool reported them correctly. `close_issue` rewrote the mirror and `updateIssue`
  never did. No test caught it because every test asserted through frontmatter, which
  was never wrong.

### Reads state absence honestly

Thirty-one store-backed reads can now tell an **empty** store apart from an
**unreadable** one, an **unparseable** one, and a **project that does not resolve**.
Previously `if (!parsed) continue` and `catch {}` turned every one of those into
`[]`.

Reads that skip a record now carry `store_status` and `unreadable_count`. Three
paths fail loudly instead, because a partial answer would have been dishonest:
context's whole-file `facts.json` and `events.json`, and `auditPolicies` — where one
bad policy used to abort the audit and report `summary.fail: 0`.

### Runtime and daemon

- `ensureRuntime({projectRoot, protocolVersion})` — one lifecycle primitive shared by
  every caller (MCP, CLI, VS Code, hooks). Arbitration is the socket bind or an
  atomic startup lock, never a PID file.
- Protocol negotiation refuses a version-skewed runtime at handshake rather than
  per-call. `/health` carries runtime version, protocol version, tier,
  `extensions.loaded` and `extensions.rejected` with per-entry reasons.
- **Error isolation**: no facade fault escapes `dispatch()`, including throws from
  parameter coercion and facade resolution (which the transports would otherwise turn
  into an MCP protocol fault rather than a failed tool call), and including dispatch
  event listeners, which run synchronously on the call path.
- **Per-facade circuit breaker.** The signal is *unresponsiveness*, not unhappiness:
  a throw always counts, an `isError` slower than 2s counts, a fast `isError` leaves
  the counters untouched. Five consecutive faults open a facade for 30s, then exactly
  one probe at a time — a recovering database gets one connection attempt, not six.
  Facade and direct-tool calls share one circuit, so `senken.trade_summary` and
  `senken_trade_summary` cannot each burn a budget against the same pool.
- Daemon hardening: timing-safe auth, body limits, rate limiting, log rotation,
  graceful drain, crash-loop protection.

### New

- **guardian** (core) — dependency, secret, HTTP and config scanning with A–F grading.
- **postoffice** (EPIC-0037) — model-agnostic agent-to-agent messaging, all seven
  verbs, two-way threaded exchange.
- **conductor** — run/dryrun/trace/cost/egress/routing.
- **zoom** (EPIC-0036) — meeting-summary ingestion, gated behind `DECIBEL_ZOOM=1`.
  **Not yet run against a live Zoom account.** It ships dark: unreachable unless
  explicitly enabled.

### The release gate

`@decibelsystems/tools@3.0.0` is the first release blocked on the **tool torture
test** (`.decibel/specs/2026-09-02-tool-torture-test.md`) — eight generated sweeps
over the whole surface across four transports, built on one observation:

> Every failure this project has actually shipped returned `ok: true`.

A voice inbox dead for five and a half hours read as `voice 0`. A regenerated plist
dropped four facades while `/health` said `status: ok`. `/batch` answered
`{ok: true}` for a facade that does not exist.

| Sweep | Gate |
|---|---|
| S0 enumeration | no unclaimed actions, no dangling actions, no expired waivers |
| S1 envelope | every action answers in a well-formed envelope |
| S2 absence | every read distinguishes the four situations above |
| S3 round-trip | hostile values survive write → read |
| S4 transports | stdio, thin, http-call and http-batch agree, differences declared |
| S5 concurrency | 50 concurrent creates across 10 processes; crash mid-write |
| S6 tier/extension | the apps boundary holds, and no env var reopens it |
| S7 artifact | the packed tarball, not the repo |

The surface is **generated from the kernel's own registries**, never enumerated by
hand: adding a tool without giving it coverage turns the build red. Every action is
claimed by a sweep or waived in `waivers.yaml` with a reason, an owner, and an
expiry. Waivers expire, and an expired waiver fails the build.

Six of the eighteen findings in S2 were the harness lying — fixtures planted at paths
no reader globs, so tools that handled absence correctly were reported broken. S5's
first crash test reported four successful `SIGKILL`s while all four victims kept
running. Every sweep now carries a calibration probe that asserts it can see a
deliberately broken tool before it is believed about the healthy ones.

881 tests.

---

## 2.x

Not tracked in this file. See the git history and `.decibel/sentinel/` for the
issue-level record.
