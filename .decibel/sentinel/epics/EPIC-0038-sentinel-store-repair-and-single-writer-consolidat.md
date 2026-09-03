---
id: EPIC-0038
projectId: decibel-tools-mcp
title: Decibel Runtime — repair, consolidation, and extensibility
summary: >-
  Runtime repair, consolidation, and extensibility. Rev 2, 2026-08-29 —
  sequencing substantially revised by peer review; full reviewed plan at
  .decibel/specs/EPIC-0038-cleanup-plan-review.md.


  DESTINATION

  Decibel Tools is not daemon + MCP server + CLI + store + VS Code extension as
  separate systems. It is ONE RUNTIME WITH SEVERAL ADAPTERS. One stdio process
  per MCP client is normal — stdio is bound to the session that launched it. One
  complete Decibel runtime per MCP client is not. An adapter translates
  transport and establishes project context; it does not instantiate its own
  store, caches, project registry, write path, or daemon logic. Test for any
  future code: why is this in the stdio server instead of the runtime? If the
  answer is not "because it is specifically about stdio/MCP transport", it
  belongs elsewhere.


  WHAT REVIEW CHANGED FROM REV 1

  Runtime consolidation was rev 1's optional Phase 6 efficiency play. It is now
  the architectural destination, promoted ahead of cosmetic format convergence.
  Its justification is not RAM and not the duplicate-ID race (fix that
  independently) — it is one lifecycle, one tool implementation, one project
  resolver, one cache, one store implementation, one behavioral model across
  MCP/CLI/VS Code. The advisory lock makes the current architecture safe; the
  runtime architecture makes it sane. Also changed: no in-process fallback for
  mutations (a proxy that silently becomes a writer defeats the invariant);
  ensureRuntime() with bind-or-lock arbitration instead of check-then-spawn;
  /health carries version and protocol for skew detection; launchd demoted to
  optimization rather than deleted; full IssueRepository interface rather than
  collapsing one function; unescaped-YAML writes promoted into Phase 1;
  canonical model decided before format; backlog triage moved last.


  MEASURED STATE

  169 issue files (111 .md, 58 .yml). Two naming schemes: 90 ISS-NNNN, 79
  timestamp-slug. Two live createIssue impls: src/sentinelIssues.ts:229 and
  src/tools/sentinel.ts:779. 108 reported open, 10 flagged degraded, 4
  duplicate-id groups. project: field holds 36 correct values, 17
  `decibel-tools`, 1 absolute path; .md records carry none. 7 stdio runtimes + 1
  daemon, ~883 MB RSS. package.json files:["dist",...] ships compiled senken.js
  and deck.js to the public npm package.


  degraded: 10 IS RESOLVED SCAR TISSUE, NOT ACTIVE CORRUPTION

  Fixed in 4ecad91 (ISS-0129, closed 2026-08-20, shipped 2.2.0-beta.0). The
  review's open question is now answered: salvageBareYaml uses /^#{1,6}\s/ at
  src/tools/sentinel.ts:624 — anchored at column 0 with no \s*, so an indented
  heading inside a description block scalar is not matched. The safe case. Phase
  2 is cosmetic repair, not data recovery. The regex is correct today but
  nothing pins it; a fixture asserting block-scalar-with-headings survives
  round-trip is a Phase 1 deliverable before Phase 2 touches any record.


  STILL LIVE: THE ID RACE

  create_issue allocates the next ISS-NNNN by reading the directory; concurrent
  processes collide. 4 duplicate groups on disk. The lock must span allocation
  THROUGH successful write, not just id calculation, and must be cross-process
  (file lock / O_EXCL) rather than an in-process mutex — old clients, scripts
  and migrations are the threat model. Keep it after the runtime exists as
  defence in depth.


  PHASE 0 — Reliable runtime lifecycle

  No manual startup. Build ensureRuntime({projectRoot, protocolVersion}) as one
  shared primitive used by every caller (MCP, CLI, VS Code, hooks) — not
  daemon-specific startup logic duplicated per surface. Arbitration is the
  socket bind or an atomic startup lock, NOT a PID file; ~/.decibel/daemon.pid
  already went stale once. /health returns status, runtime version, protocol
  version, pid, uptime, capabilities/tier so clients can detect version skew.
  launchd becomes non-essential, which exits the external-volume failure mode
  (ISS-0127) entirely. Fold in the plist tier bug (NODE_ENV=production with no
  DECIBEL_PRO/DECIBEL_APPS serves core-only after 943a642). Restores the
  session-init.sh digest injection that is already built and currently dark.
  NOTE: ensureRuntime() is most of the client half of Phase 4 — build it once,
  here.


  PHASE 1 — Integrity invariants + concurrency

  1a DONE (4ecad91 / ISS-0129) — do not redo. 1b CI frontmatter integrity check,
  filed 2026-04-30 and never actioned. 1c round-trip tests
  create->close->re-read on both formats plus the block-scalar fixture. 1d
  cross-process ID lock spanning allocation through write. 1e replace all
  regex/string editing of structured fields with parse -> typed mutation ->
  serialize -> temp file -> atomic rename; any path still interpolating
  arbitrary values into YAML goes now. 1f update_epic (ISS-0140) — small, and
  currently blocking clean revision of this epic.


  PHASE 2 — Repair existing damage

  degraded -> 0. Most of the 10 carry a completed resolution and are open only
  because the old status write failed, so the correct repair is to CLOSE them,
  not reformat them. Renumber 4 duplicate groups (ISS-0136), normalize 18 wrong
  project values. Reviewed script with dry-run. Once at 0, non-zero degraded
  becomes an invariant violation CI/preflight/guardian can fail on.


  PHASE 3 — Canonical model + boundaries

  One IssueRepository interface (create/get/list/update/close) so no caller
  knows whether issues are .md, .yml, or SQLite. Separate IssueRepository /
  IssueCodec / ProjectResolver / RuntimeService / RuntimeClient /
  DaemonController — transport does not know storage, storage does not know MCP,
  project detection stops happening implicitly. Also lands the extension
  registry seam (Phase 7 foundation) and error isolation: no facade fault
  escapes dispatch(), plus a per-facade circuit breaker so a wedged Postgres
  pool degrades one facade rather than the runtime. CAUTION: src/store/ is NOT
  dead code — scripts/import-store.ts imports it and a previous session already
  misdiagnosed it; ISS-0130 rests on that wrong premise.


  PHASE 4 — Thin-client topology

  Adapters become clients of the shared runtime, reusing the Phase 0 primitive.
  src/client/ already ships FacadeClient with stdio, HTTP and bridge transports.
  NO IN-PROCESS FALLBACK FOR MUTATIONS: auto-start, retry briefly, then fail
  with a useful error. Targets: under 200 MB total RSS with 6 clients, zero
  duplicate ids under concurrent creates.


  PHASE 5 — Format convergence

  Converge behavior first, representation second. Running before Phase 3 leaves
  a second writer re-emitting .yml behind the migration. Decide from the
  canonical model, not from what files happen to contain — if project is in the
  model, preserve it regardless of format.


  PHASE 6 — Backlog hygiene

  108 open is inflated: 54 predate 2026, ISS-0001..ISS-0016 covers shipped work.
  Bulk close/wontfix, re-baseline. Near-zero architectural value, hence last.


  PHASE 7 — Extension architecture

  Private facades (senken, deck) load for owner use only and leave the public
  package. Depends on Phase 4: extensions belong to the Runtime, not the adapter
  — under today's topology loading senken means 7 pg.Pool instances against
  Mother's Postgres; one runtime means one pool. A DecibelExtension is
  {manifest:{name,version,protocolVersion,tier}, facades: FacadeSpec[], tools}
  loaded at boot from an allowlist in ~/.decibel/config.yaml and registered into
  the same registry core uses. Three consequences: (1) tier gating gets simpler
  AND safer — core ships, everything else is a license-gated extension, so you
  cannot call what was never registered; fail-closed by absence rather than by
  check, retiring the prefix-match bypass class outright. (2) Trust boundary
  needs an explicit call — extensions run in-process with full fs and DB access;
  an absolute-path allowlist is proportionate for single-user private use, but
  the loader must not accept a bare package name from the environment or the
  allowlist is decorative. (3) Protocol version reuses Phase 0's negotiation
  machinery.
status: in_progress
priority: high
tags: []
owner: ""
squad: ""
created_at: 2026-08-29T00:18:38.007Z
updated_at: 2026-09-02T19:26:11.854Z
linked_commits:
  - sha: 19d8c06a37b1e16f31ba2e821b849eb64879709f
    shortSha: 19d8c06
    message: "EPIC-0038 Phase 7: apps facades become allowlisted extensions"
    relationship: related
    linked_at: 2026-09-02T19:25:46.275Z
    linked_by: ai:claude
  - sha: 85b1ab958c46b89d76a3d10d10886a93d1ed953f
    shortSha: 85b1ab9
    message: "sentinel: EPIC-0038 Phase 7 notes and six evidence-based closures"
    relationship: related
    linked_at: 2026-09-02T19:26:11.854Z
    linked_by: ai:claude

---

# Decibel Runtime — repair, consolidation, and extensibility

## Summary

Runtime repair, consolidation, and extensibility. Rev 2, 2026-08-29 — sequencing substantially revised by peer review; full reviewed plan at .decibel/specs/EPIC-0038-cleanup-plan-review.md.

DESTINATION
Decibel Tools is not daemon + MCP server + CLI + store + VS Code extension as separate systems. It is ONE RUNTIME WITH SEVERAL ADAPTERS. One stdio process per MCP client is normal — stdio is bound to the session that launched it. One complete Decibel runtime per MCP client is not. An adapter translates transport and establishes project context; it does not instantiate its own store, caches, project registry, write path, or daemon logic. Test for any future code: why is this in the stdio server instead of the runtime? If the answer is not "because it is specifically about stdio/MCP transport", it belongs elsewhere.

WHAT REVIEW CHANGED FROM REV 1
Runtime consolidation was rev 1's optional Phase 6 efficiency play. It is now the architectural destination, promoted ahead of cosmetic format convergence. Its justification is not RAM and not the duplicate-ID race (fix that independently) — it is one lifecycle, one tool implementation, one project resolver, one cache, one store implementation, one behavioral model across MCP/CLI/VS Code. The advisory lock makes the current architecture safe; the runtime architecture makes it sane. Also changed: no in-process fallback for mutations (a proxy that silently becomes a writer defeats the invariant); ensureRuntime() with bind-or-lock arbitration instead of check-then-spawn; /health carries version and protocol for skew detection; launchd demoted to optimization rather than deleted; full IssueRepository interface rather than collapsing one function; unescaped-YAML writes promoted into Phase 1; canonical model decided before format; backlog triage moved last.

MEASURED STATE
169 issue files (111 .md, 58 .yml). Two naming schemes: 90 ISS-NNNN, 79 timestamp-slug. Two live createIssue impls: src/sentinelIssues.ts:229 and src/tools/sentinel.ts:779. 108 reported open, 10 flagged degraded, 4 duplicate-id groups. project: field holds 36 correct values, 17 `decibel-tools`, 1 absolute path; .md records carry none. 7 stdio runtimes + 1 daemon, ~883 MB RSS. package.json files:["dist",...] ships compiled senken.js and deck.js to the public npm package.

degraded: 10 IS RESOLVED SCAR TISSUE, NOT ACTIVE CORRUPTION
Fixed in 4ecad91 (ISS-0129, closed 2026-08-20, shipped 2.2.0-beta.0). The review's open question is now answered: salvageBareYaml uses /^#{1,6}\s/ at src/tools/sentinel.ts:624 — anchored at column 0 with no \s*, so an indented heading inside a description block scalar is not matched. The safe case. Phase 2 is cosmetic repair, not data recovery. The regex is correct today but nothing pins it; a fixture asserting block-scalar-with-headings survives round-trip is a Phase 1 deliverable before Phase 2 touches any record.

STILL LIVE: THE ID RACE
create_issue allocates the next ISS-NNNN by reading the directory; concurrent processes collide. 4 duplicate groups on disk. The lock must span allocation THROUGH successful write, not just id calculation, and must be cross-process (file lock / O_EXCL) rather than an in-process mutex — old clients, scripts and migrations are the threat model. Keep it after the runtime exists as defence in depth.

PHASE 0 — Reliable runtime lifecycle
No manual startup. Build ensureRuntime({projectRoot, protocolVersion}) as one shared primitive used by every caller (MCP, CLI, VS Code, hooks) — not daemon-specific startup logic duplicated per surface. Arbitration is the socket bind or an atomic startup lock, NOT a PID file; ~/.decibel/daemon.pid already went stale once. /health returns status, runtime version, protocol version, pid, uptime, capabilities/tier so clients can detect version skew. launchd becomes non-essential, which exits the external-volume failure mode (ISS-0127) entirely. Fold in the plist tier bug (NODE_ENV=production with no DECIBEL_PRO/DECIBEL_APPS serves core-only after 943a642). Restores the session-init.sh digest injection that is already built and currently dark. NOTE: ensureRuntime() is most of the client half of Phase 4 — build it once, here.

PHASE 1 — Integrity invariants + concurrency
1a DONE (4ecad91 / ISS-0129) — do not redo. 1b CI frontmatter integrity check, filed 2026-04-30 and never actioned. 1c round-trip tests create->close->re-read on both formats plus the block-scalar fixture. 1d cross-process ID lock spanning allocation through write. 1e replace all regex/string editing of structured fields with parse -> typed mutation -> serialize -> temp file -> atomic rename; any path still interpolating arbitrary values into YAML goes now. 1f update_epic (ISS-0140) — small, and currently blocking clean revision of this epic.

PHASE 2 — Repair existing damage
degraded -> 0. Most of the 10 carry a completed resolution and are open only because the old status write failed, so the correct repair is to CLOSE them, not reformat them. Renumber 4 duplicate groups (ISS-0136), normalize 18 wrong project values. Reviewed script with dry-run. Once at 0, non-zero degraded becomes an invariant violation CI/preflight/guardian can fail on.

PHASE 3 — Canonical model + boundaries
One IssueRepository interface (create/get/list/update/close) so no caller knows whether issues are .md, .yml, or SQLite. Separate IssueRepository / IssueCodec / ProjectResolver / RuntimeService / RuntimeClient / DaemonController — transport does not know storage, storage does not know MCP, project detection stops happening implicitly. Also lands the extension registry seam (Phase 7 foundation) and error isolation: no facade fault escapes dispatch(), plus a per-facade circuit breaker so a wedged Postgres pool degrades one facade rather than the runtime. CAUTION: src/store/ is NOT dead code — scripts/import-store.ts imports it and a previous session already misdiagnosed it; ISS-0130 rests on that wrong premise.

PHASE 4 — Thin-client topology
Adapters become clients of the shared runtime, reusing the Phase 0 primitive. src/client/ already ships FacadeClient with stdio, HTTP and bridge transports. NO IN-PROCESS FALLBACK FOR MUTATIONS: auto-start, retry briefly, then fail with a useful error. Targets: under 200 MB total RSS with 6 clients, zero duplicate ids under concurrent creates.

PHASE 5 — Format convergence
Converge behavior first, representation second. Running before Phase 3 leaves a second writer re-emitting .yml behind the migration. Decide from the canonical model, not from what files happen to contain — if project is in the model, preserve it regardless of format.

PHASE 6 — Backlog hygiene
108 open is inflated: 54 predate 2026, ISS-0001..ISS-0016 covers shipped work. Bulk close/wontfix, re-baseline. Near-zero architectural value, hence last.

PHASE 7 — Extension architecture
Private facades (senken, deck) load for owner use only and leave the public package. Depends on Phase 4: extensions belong to the Runtime, not the adapter — under today's topology loading senken means 7 pg.Pool instances against Mother's Postgres; one runtime means one pool. A DecibelExtension is {manifest:{name,version,protocolVersion,tier}, facades: FacadeSpec[], tools} loaded at boot from an allowlist in ~/.decibel/config.yaml and registered into the same registry core uses. Three consequences: (1) tier gating gets simpler AND safer — core ships, everything else is a license-gated extension, so you cannot call what was never registered; fail-closed by absence rather than by check, retiring the prefix-match bypass class outright. (2) Trust boundary needs an explicit call — extensions run in-process with full fs and DB access; an absolute-path allowlist is proportionate for single-user private use, but the loader must not accept a bare package name from the environment or the allowlist is decorative. (3) Protocol version reuses Phase 0's negotiation machinery.

## Note (2026-08-29T03:59:41.367Z)

Phases 0 and 1 shipped: ensureRuntime lifecycle (#50), serialized id allocation and round-trip tests (#51), CI build-before-test fix (#52), atomic writes and update_epic (this change). Phase 2 repair migration is next.

## Note (2026-08-29T16:50:14.538Z)

Phase 2 COMPLETE (0ad8141, d5004ec). degraded -> 0, duplicate_ids -> 0, project values normalized, and a fourth defect found and fixed along the way.

WHAT THE PLAN GOT RIGHT: "most of the 10 carry a completed resolution and are open only because the old status write failed, so the correct repair is to CLOSE them, not reformat them." That was exactly right, and the scope was larger than the plan's count — 16 records, not 10, because `degraded` only flags records broken badly enough to need salvage. Six more parsed fine while carrying a stranded resolution and a stale `open`. On disk: 113 -> 97 open across an unchanged 169 records.

WHAT THE PLAN GOT WRONG: it treated the 4 duplicate groups as one problem wanting one renumbering policy (ISS-0136 is even titled "renumber the existing duplicate ISS-NNNN ids"). They are four unrelated accidents. Reading them individually, not one needed a live issue renumbered — every loser was already-closed legacy, a 2025-12-14 test fixture, or a stray copy from the /Volumes/Kiki checkout that ISS-0115 had already documented as retired. The repair is a RETIRE manifest with per-group evidence, not a rule. Three of the four predate the allocator (2026-04-28), so Phase 1's lock is not what prevents them and their absence is not evidence it works. ISS-0136 closed.

NEW: markdown records mirror status into the body as `**Status:** x`, and 16 had drifted from frontmatter — the file read `open` to a person while every tool reported it correctly. Root cause: close_issue rewrites the mirror, updateIssue never did (src/sentinelIssues.ts). No test caught it because every existing test asserts through frontmatter, which was never wrong. Both the 16 records and the writer are fixed, with regression tests.

CARRY INTO PHASE 3/5: the mirror is derived state duplicated into the body, and it will drift again through any writer that forgets it. The canonical model should own status once and render the body, rather than keeping two copies in sync by hand. This is a concrete argument for the IssueRepository/IssueCodec split, not just a tidiness one.

PHASE 2 INVARIANTS NOW AVAILABLE TO CI: degraded == 0, duplicate_ids == 0, and frontmatter status == body mirror. The repair script re-runs clean and reports 0 actions, so it doubles as the checker.

NEXT: Phase 3 (canonical model + boundaries). Note the epic's own CAUTION still stands — src/store/ is reachable via scripts/import-store.ts, and ISS-0130 rests on the wrong premise.

## Note (2026-08-30T02:25:02.915Z)

Phase 3 error isolation + per-facade circuit breaker shipped (bb17353). 586 tests green.

WHAT THE PLAN UNDERSTATED: "no facade fault escapes dispatch()" read as a one-line try/catch, but the inner handler call was already wrapped — the real holes were everywhere else. Two of them: (1) anything thrown OUTSIDE the handler (param coercion, facade resolution) escaped as a rejected promise, which the transports turn into an MCP protocol fault rather than a failed tool call; (2) dispatch event listeners run synchronously on the call path, so an SSE writer whose socket died mid-write threw out of a call that had already succeeded. Fixed with an outer dispatch() wrapper and safeEmit().

THE BREAKER'S REAL DESIGN QUESTION was not state machine mechanics — it was which failures count, and the plan's framing ("a wedged Postgres pool degrades one facade") would have produced a breaker that never fires. Decibel tools catch their own errors: senken_trade_summary returns {isError:true} for an unreachable Postgres (src/tools/senken.ts:117), identically to how it reports a bad strategy name. Count only throws → never trips on the motivating case. Count every isError → five malformed create_issue calls from one confused agent take sentinel offline for every client.

Resolution: the signal is UNRESPONSIVENESS, not unhappiness. A throw always counts; an isError slower than 2s counts; a fast isError is neither a fault nor proof of health, so it leaves the counters untouched. Five consecutive faults open the facade for 30s, then exactly one probe at a time — a recovering database gets one connection attempt, not six. In half-open, any answer (even a domain error) closes the circuit, because answering is what is being measured.

Facade and direct-tool calls share one circuit via toolToFacade, so senken.trade_summary and senken_trade_summary cannot each burn their own budget against the same pool. Open circuits surface on /health as `circuits`; `{}` is the healthy case.

STILL OPEN IN PHASE 3: the ProjectResolver / RuntimeService / RuntimeClient / DaemonController separation (only IssueRepository/IssueCodec are extracted so far), and the extension registry seam Phase 7 depends on. sentinelIssues.ts still carries its own updateIssue — the second writer Phase 5 removes.

## Note (2026-08-30T17:36:15.427Z)

Phase 4 target correction (rev 3, 2026-08-30) — "under 200 MB total RSS with 6 clients" is arithmetically unreachable and is withdrawn as an acceptance criterion.

Six MCP stdio processes cannot cost less than ~371 MB. The SDK floor is per-process (61.8 MB for a bare stdio MCP server that serves an empty tool list), and each MCP client spawns its own process. Going below that needs FEWER PROCESSES, which stdio does not permit. No amount of thinning the adapter reaches 200.

More importantly, the byte count was the wrong criterion. Rev 2's own review outcomes already said this: "Justification isn't RAM or the ID race — it's one lifecycle, one resolver, one store impl, one behavioral model across every surface." The Phase 4 target contradicted the rev-2 reasoning by reintroducing RSS as the goal. Confirmed by Ben 2026-08-30: efficient OPERATION is the goal, not memory size.

Phase 4 should be judged on the operating model, and by that measure it is met:
  - no in-process mutation fallback (thin adapter fails with an actionable error rather than silently becoming a second writer — BridgeAdapter still has this defect)
  - one kernel, one registry, one resolver, one write path
  - protocol negotiation refuses a skewed runtime at handshake, not per-call

Memory now serves as evidence that running thin is not penalised, not as the objective. Measured 2026-08-30 via scripts/measure-memory.mjs (external ps, not self-report):

  daemon + 6 full stdio (today's default)   665.9 MB     <- reproduces the 883/663 MB figure in Measured state
  daemon + 6 thin, as PR #58 merged it      791.3 MB     <- opting into the correct model COST 19%
  daemon + 6 thin, after PR #59             548.9 MB     -18%
  achievable floor (daemon + 6 bare MCP)    482.9 MB     -27%

PR #58 shipped the adapter; the saving was not real because server.ts statically imported kernel.js, and an ESM static import is evaluated at module load before main() picks a mode. Skipping the createKernel() call freed the registry and nothing else. PR #59 breaks that import graph, moves argv parsing out of httpServer.ts, makes yaml lazy, and takes the thin client off undici. A thin client is now 72.8 MB against the 61.8 MB floor.

Revised Phase 4 acceptance: zero duplicate ids under concurrent creates; no mutation fallback in any adapter; --thin costs no more than a full stdio client. Follow-up on the residual 11 MB per client is tracked separately and is explicitly low priority.

## Note (2026-08-31T00:05:28.738Z)

2026-08-30: PHASE 5 COMPLETE. Behaviour converged first (#62: sentinelIssues.createIssue delegates to FsIssueRepository, so one writer instead of two emitting different formats into one directory), then representation (#64: all 58 bare-YAML records converted to canonical markdown; store is 174 .md, 0 .yml). Phase 5 also surfaced two defects that had nothing to do with format: #61, create_issue silently dropped priority and tags because the schema allows additional properties while the forwarding call site listed five fields; and #63, extractDetails truncated every issue body at its first author heading, which the migration caught by round-trip verification when 49 of 58 records failed it.

The remaining item — renaming 79 timestamp-slug filenames — is DELIBERATELY NOT DONE and will not be done. See ADR-0010. 49 of 194 provenance events plus 2 ADRs reference those filenames, and provenance events are immutable audit records carrying content fingerprints; renaming dangles them and rewriting them falsifies the log. Identity is the id: field, which is already correct and already how records resolve. Do not reopen without building resolver aliasing first.

Also closed against verified evidence this session: the ISS-NNNN collision friction (signal 3) and ISS-0136 — allocator holds a lock across allocation THROUGH write plus O_EXCL, and 0 duplicate id groups remain on disk, down from 4. Phase 2 fully done: degraded 10 to 0, wrong project values 18 to 0.

## Note (2026-09-01T21:49:57.870Z)

2026-09-01: PHASE 7 COMPLETE. Private facades are no longer compiled into the package or gated by an env var — they load at boot from `extensions.allow` in ~/.decibel/config.yaml as DecibelExtensions (src/runtime/extensions.ts). The four apps facades moved their FacadeSpec out of src/facades/definitions.ts into their own already-excluded modules, so the public package stops carrying a description of a live trading Postgres and a wallet-spending tool it can never reach. DECIBEL_APPS is removed from tools/index.ts, kernel.ts, server.ts and the launchd plist template. Live: 35 facades / 272 tools, zero rejections, 720/720 tests.

Scope decision (Ben, 2026-09-01): apps-tier only. Pro (voice, agentic, postoffice, corpus, studio) still ships in the public package, license-gated at runtime. The public mirror and npm history keep the old private sources — removing them going forward does not retract what is published, and nothing there is a live credential. Cut forward, do not rewrite history.

WHAT MOTIVATED THE ENV-VAR REMOVAL, and it is worth generalising. Two hours before this work, the daemon silently lost those same four facades: the regenerated launchd plist carried DECIBEL_PRO but not DECIBEL_APPS, because installLaunchAgent copies the tier opt-in from the installing shell's environment. The flag lived in a world-readable plist that has to be regenerated correctly every time, and losing it produced no error on any surface — /health returned status ok with 31 facades and nothing said 4 were missing. Config-file state that the owner edits beats environment state that a generator has to remember.

TRUST BOUNDARY, stated explicitly because the epic asked for it: extensions run in-process with full fs and DB access and there is no sandbox. The allowlist is what makes that proportionate, so it accepts absolute paths ONLY — a bare specifier would be resolved against node_modules, which would mean whoever can write a package chooses what runs. The path is never read from the environment, and an extension may not shadow an already-registered facade name.

FAIL-CLOSED BY ABSENCE IS ONLY SAFE IF ABSENCE IS LOUD (raised by the decibel-hq peer, and it is the sharpest point of the day). An unregistered facade must be a hard error, not a zero-shaped success — otherwise "not loaded" is indistinguishable from "nothing to report", which is exactly how a dead voice inbox read as "voice 0" in the session digest for five and a half hours that same morning. Verified: an unknown facade returns ok:false / TOOL_ERROR. /health now also carries extensions.loaded and extensions.rejected with per-entry reasons.

Found while wiring it: /health's internal_tool_count counted the array getAllTools() returns rather than the dispatch map, so it under-reported by exactly the extension tools (227 vs 272). Same family as the read-paths-that-turn-failure-into-emptiness bug from ISS-0146 — a number that looks plausible and disagrees with what dispatch can actually reach.

PHASE 6 STARTED, NOT FINISHED. 98 open to 92. The epic's own premise is wrong and should not be acted on as written: it says "54 predate 2026" — only 20 do (18 from 2025-12 plus 2 with no created_at). More importantly the age rule is the wrong instrument, the same way the four duplicate-id groups in Phase 2 did not share a root cause. Six issues were closed against specific evidence, not age: ISS-0014, ISS-0029, ISS-0108, ISS-0017, ISS-0009 (all verifiably shipped), and ISS-0012 (obsolete — its premise was that context tools shell out to a CLI, and they no longer spawn anything).

Left for Ben, because each needs a judgment call rather than a rule: ISS-0020..0025 (EPIC-0020 agentic dialects) are implemented in src/agentic/ but structured differently from the issues' file-by-file spec — delivered-differently, so closing them is a decision about intent; ISS-0011 (decibel CLI with context subcommands) was never built and EPIC-0038 arguably supersedes it; ISS-0004 (.mcpb) shipped as a bundle from the decibel-installer repo but Extension Directory submission is still gated on code-signing certs; ISS-0010, ISS-0019, ISS-0027, ISS-0109 need a look each.
