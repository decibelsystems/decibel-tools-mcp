---
id: EPIC-0038
projectId: decibel-tools-mcp
title: Decibel Runtime — repair, consolidation, and extensibility
summary: |-
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
status: in_progress
priority: high
tags: []
owner: ""
squad: ""
created_at: 2026-08-29T00:18:38.007Z
updated_at: 2026-08-29T03:59:41.367Z
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
