# Decibel Runtime — repair, consolidation, and extensibility

**Epic:** EPIC-0038
**Status:** reviewed, accepted — ready to execute
**Revision:** 2 (2026-08-29). Rev 1 sequencing was substantially revised by peer review; see *Review outcomes*.
**Scope:** `decibel-tools-mcp` — sentinel store, runtime topology, extension model

---

## The destination

Decibel Tools is not `daemon + MCP server + CLI + store + VS Code extension` as separate systems. It is **one runtime with several adapters**:

```
Claude Code ── stdio adapter ─┐
Cursor ─────── stdio adapter ─┤
Codex ──────── stdio adapter ─┼── Decibel Runtime ── Services ── Stores
VS Code ────── RuntimeClient ─┤          │
CLI ────────── RuntimeClient ─┘          └── Extensions (private: senken, deck)
```

One stdio process per MCP client is normal and expected — stdio is inherently bound to the session that launched it. **One complete Decibel runtime per MCP client is not.** An adapter should translate transport and establish project context. It should not instantiate its own store, caches, project registry, write path, or daemon logic.

This gives a simple test for any future code: *why is this in the stdio server instead of the runtime?* If the answer isn't "because it is specifically about stdio/MCP transport," it belongs elsewhere.

---

## Review outcomes (rev 1 → rev 2)

Rev 1 treated the shared runtime as an optional Phase 6 efficiency play. That was wrong on the merits, and the review corrected it. Changes carried into this revision:

| Rev 1 | Rev 2 | Why |
|---|---|---|
| Goal: "one process" | Goal: one runtime, thin adapters | Conflated transport multiplicity with runtime multiplicity |
| Runtime work last, possibly optional | Runtime work is the architectural destination | Justification isn't RAM or the ID race — it's one lifecycle, one resolver, one store impl, one behavioral model across every surface |
| Proxy falls back to in-process on daemon failure | **No mutation fallback.** Auto-start, retry briefly, then fail with a useful error | A proxy that silently becomes a writer defeats the single-writer invariant it exists to establish |
| `/health` check → spawn if dead | `ensureRuntime()` with bind-or-lock arbitration | Check-then-spawn *is* the startup race the doc itself warns about |
| Delete launchd | Make launchd non-essential | Auto-start is the correctness mechanism; launchd becomes an optimization |
| "Collapse to one `createIssue`" | Full `IssueRepository` interface | Collapsing one function leaves the coupling intact |
| Unescaped-YAML write in backlog | Promoted to Phase 1 | Same class of defect as the corruption already repaired; a single writer corrupts efficiently |
| Format decided by current file contents | Canonical model first, format second | `.md` lacking `project` is evidence of drift, not an argument about format |
| Backlog triage mid-plan | Backlog last | Near-zero architectural value |

Two additions from this revision, not in the review:

- **`ensureRuntime()` is shared between Phase 0 and Phase 4.** It is most of the client half of the topology work. Build it once as the shared lifecycle primitive, not as daemon-specific startup code.
- **Shared fate is a genuine regression risk.** Today a bad senken query kills one stdio process and six other sessions never notice. In a shared runtime it takes down everyone — and that sharpens with third-party extensions loaded in-process. Mitigation is designed in at Phase 3, not discovered at Phase 4.

---

## Measured state

Collected 2026-08-28. Commands included so figures can be re-derived.

| Claim | Figure | Verify |
|---|---|---|
| Issue files | 169 (111 `.md`, 58 `.yml`) | `ls .decibel/sentinel/issues \| sed 's/.*\.//' \| sort \| uniq -c` |
| Naming schemes | 90 `ISS-NNNN`, 79 `timestamp-slug` | `ls .decibel/sentinel/issues \| grep -c '^ISS-'` |
| Live `createIssue` impls | `src/sentinelIssues.ts:229`, `src/tools/sentinel.ts:779` | `grep -rn "export async function createIssue" src` |
| Reported open | 108 | `sentinel list_issues status:open` |
| Flagged degraded | 10 | same call, `degraded` |
| Duplicate ID groups | 4 | same call, `duplicate_ids` |
| `project:` values in `.yml` | 36 correct, 17 `decibel-tools`, 1 absolute path | `grep -h "^project:" .decibel/sentinel/issues/*.yml \| sort \| uniq -c` |
| `.md` carrying `project:` | 0 | `grep -l "^project:" .decibel/sentinel/issues/*.md \| wc -l` |
| Concurrent runtimes | 7 stdio + 1 daemon, ~883 MB RSS | `ps -o pid,rss,command -p $(pgrep -f dist/server.js \| tr '\n' ,)` |
| Private code in public package | `files: ["dist", ...]` ships `senken.js`, `deck.js` | `node -e "console.log(require('./package.json').files)"` |

---

## `degraded: 10` — resolved

**Not active corruption.** `close_issue` used to append a markdown `## Resolution` at column 0 into bare-YAML records, terminating the `description: |-` block scalar and invalidating the document, while the status write silently no-opped because its regexes were anchored on a leading `---`. Fixed in **`4ecad91`** (ISS-0129, closed 2026-08-20, shipped `2.2.0-beta.0`). `salvageBareYaml()` recovers already-damaged files and flags them rather than dropping them.

**The review's open question is now answered.** `src/tools/sentinel.ts:624`:

```js
const headingIdx = lines.findIndex((l) => /^#{1,6}\s/.test(l));
```

Anchored at column 0, no `\s*`. An indented `# heading` inside a block scalar is not matched — the safe case. Phase 2 is therefore cosmetic repair, not data recovery.

The regex is correct today but nothing pins it. **A fixture asserting that a `description: |-` block containing markdown headings survives round-trip is a Phase 1 deliverable**, before Phase 2 touches any record.

Residual risk is legibility and enforcement, not integrity: the reporting can't distinguish healed scar tissue from a fresh wound, and no CI check stops a regression. Once Phase 2 reaches `degraded: 0`, non-zero becomes an invariant violation that preflight/guardian should fail on — not a friendly metric.

---

## Still live: the ID race

`create_issue` allocates the next `ISS-NNNN` by reading the directory. With 7 concurrent processes, two can read the same maximum. **4 duplicate groups on disk** (`ISS-0015`, `ISS-0028`, `ISS-0054`, `ISS-0112`). Reported independently by the `machina` peer and reproduced here.

The lock must span **allocation through successful write**, not just ID calculation:

```
acquire → read max → allocate → write atomically → release
```

Otherwise two processes still allocate the same ID before either file appears. It must be a cross-process lock (file lock / `O_EXCL`), not an in-process mutex — old clients, scripts, and migrations are the threat model. **Keep it after the runtime exists**, as defence in depth.

---

## Phases

| # | Phase | Purpose |
|---|---|---|
| 0 | Reliable runtime lifecycle | No manual startup. `ensureRuntime()` becomes universal. |
| 1 | Integrity invariants + concurrency | Tests, validation, locking, typed serialization, atomic writes. |
| 2 | Repair existing damage | `degraded → 0`, duplicates renumbered, project values normalized. |
| 3 | Canonical model + boundaries | One domain model, one issue implementation, extension registry, error isolation. |
| 4 | Thin-client topology | stdio / VS Code / CLI become clients of the shared runtime. |
| 5 | Format convergence | `.yml` → canonical representation. |
| 6 | Backlog hygiene | Close historical junk, re-baseline health metrics. |
| 7 | Extension architecture | Private facades load out-of-package. |

### Phase 0 — Reliable runtime lifecycle

`launchd` never loads `com.decibel.daemon`: the plist exists with `RunAtLoad=true`, but `launchctl list | grep decibel` is empty because `$HOME` is `/Volumes/Ashitaka`, an external volume mounting after login (ISS-0127).

Build one shared lifecycle primitive used by **every** caller — MCP, CLI, VS Code, hooks:

```ts
const runtime = await ensureRuntime({ projectRoot, protocolVersion });
```

When six clients arrive at once, all six call it; one wins ownership, five connect. **Arbitration is the socket bind or an atomic startup lock, not a PID file** — PID files go stale. `~/.decibel/daemon.pid` already went stale once this session (held pid 13425 from a dead process with no matching file).

`/health` returns `status`, runtime version, protocol version, pid, uptime, capabilities/tier — so a client can detect version skew against a long-lived daemon rather than failing mysteriously.

Fold in the plist tier bug: it sets `NODE_ENV=production` with no `DECIBEL_PRO`/`DECIBEL_APPS`, so a launchd-started daemon silently serves core-only after `943a642`.

Restoring the runtime also restores something already built and currently dark: `~/.decibel/hooks/session-init.sh` prefers `/batch` and injects a compact digest into session context; the "run these 4 tools" nudge is only its fallback branch.

### Phase 1 — Integrity invariants + concurrency

- **1a. DONE** — `4ecad91` / ISS-0129. Do not redo.
- **1b.** CI frontmatter integrity check. Filed 2026-04-30, never actioned.
- **1c.** Round-trip tests: `create → close → re-read` on both formats, plus the block-scalar-with-headings fixture above.
- **1d.** Cross-process ID lock spanning allocation through write.
- **1e.** Replace all regex/string editing of structured fields with parse → typed mutation → serialize → temp file → atomic rename. Any path still interpolating arbitrary values into YAML goes now.
- **1f.** `update_epic` (ISS-0140). Small, and currently blocking clean revision of this very plan.

### Phase 2 — Repair existing damage

Most of the 10 degraded files carry a completed resolution and are open only because the old status write failed — **the correct repair is to close them, not reformat them**. Reformatting preserves a false `open` in a tidier file. Plus: renumber 4 duplicate groups (ISS-0136), normalize 18 wrong `project:` values. Reviewed script with dry-run, not by hand.

### Phase 3 — Canonical model + boundaries

Collapse all issue persistence behind one interface:

```ts
interface IssueRepository {
  create(input: CreateIssueInput): Promise<Issue>;
  get(id: IssueId): Promise<Issue | null>;
  list(query: IssueQuery): Promise<Issue[]>;
  update(id: IssueId, patch: IssuePatch): Promise<Issue>;
  close(id: IssueId, resolution: Resolution): Promise<Issue>;
}
```

Then neither `sentinel.ts`, MCP handlers, the CLI, nor import scripts know whether issues are `.md`, `.yml`, SQLite, or delivered by ravens.

Separate concerns explicitly: `IssueRepository` · `IssueCodec` · `ProjectResolver` · `RuntimeService` · `RuntimeClient` · `DaemonController`. Transport doesn't know storage; storage doesn't know MCP; project detection stops happening implicitly throughout the codebase.

Also lands here: the **extension registry seam** (Phase 7's foundation) and **error isolation** — no facade fault escapes `dispatch()`, plus a per-facade circuit breaker so a wedged Postgres pool degrades one facade rather than the runtime.

> ⚠️ `src/store/` is **not** dead code — `scripts/import-store.ts` imports it, and a previous session already misdiagnosed it as unreachable. ISS-0130 is filed on that wrong premise and needs correcting. Decide the importer's fate explicitly before deleting.

### Phase 4 — Thin-client topology

Adapters become clients of the shared runtime, reusing the Phase 0 primitive. `src/client/` already ships `FacadeClient` with stdio, HTTP, and bridge transports.

**No in-process fallback for mutations.** If the runtime is unavailable: auto-start, retry briefly, then fail with a useful error. Read-only fallback is arguable later; write fallback is not.

Targets: <200 MB total RSS with 6 clients (from ~883 MB); zero duplicate IDs under concurrent creates.

### Phase 5 — Format convergence

Converge behavior first, representation second. Running this before Phase 3 leaves a second writer re-emitting `.yml` behind the migration. Decide `.md` vs `.yml` from the canonical model, not from what files happen to contain today — if `project` is in the model, preserve it regardless of format. Markdown + structured frontmatter suits Decibel, since these are simultaneously machine records and human-readable artifacts, but that is secondary to having exactly one schema and one codec.

### Phase 6 — Backlog hygiene

108 open is inflated: 54 predate 2026, and `ISS-0001`–`ISS-0016` covers shipped work (plugin package, project registry, CLI entrypoint). Bulk close/wontfix, re-baseline.

### Phase 7 — Extension architecture

**Requirement:** private facades (`senken`, `deck`) load for owner use only and leave the public package entirely. Today `files: ["dist", ...]` ships compiled `senken.js` and `deck.js` — tier gating hides them at runtime but the code is published, including Mother's Postgres schema knowledge.

**Depends on Phase 4.** Extensions belong to the Runtime, not the adapter: loading senken under today's topology means seven `pg.Pool` instances against Mother's Postgres. One runtime means one pool, one lifecycle, one credential load.

The seam exists. `FacadeSpec` (`src/facades/types.ts:12`) already carries `name`, `description`, `compactDescription`, `microEligible`, `tier`, `actions`, and the kernel builds `toolToFacade` from those declarations. An extension is that plus implementations:

```ts
interface DecibelExtension {
  manifest: { name: string; version: string; protocolVersion: string; tier: Tier };
  facades: FacadeSpec[];
  tools: Record<string, ToolImpl>;
}
```

Loaded at runtime boot from an allowlist in `~/.decibel/config.yaml`, registered into the same registry core uses.

Three consequences:

1. **Tier gating gets simpler and safer.** Core ships in the package; everything else is a license-gated extension. You cannot call what was never registered — fail-closed by absence rather than by check. Strictly stronger than `943a642`, and it retires the "pro tool whose name doesn't prefix-match its facade" bypass class outright.
2. **Trust boundary needs an explicit call.** Extensions run in-process with full filesystem and DB access. For single-user private use an absolute-path allowlist in `config.yaml` is proportionate — don't build signing yet, but don't let the loader accept a bare package name from the environment either, or the allowlist is decorative.
3. **Protocol version reuses Phase 0's machinery.** An extension declares the runtime protocol it targets; the runtime refuses mismatches. Same negotiation as the `/health` skew check — build it once.

---

## Open questions

1. **`.md` or `.yml` as canonical?** Decide from the model. Markdown + frontmatter is the working preference; the binding constraint is one schema, one codec.
2. **Should degraded block CI?** Proposal: yes, once Phase 2 reaches 0.
3. **Extension failure policy.** Circuit-break the facade, or refuse to boot the runtime? Leaning circuit-break with a loud `/health` degradation.

## What would change the plan

- If `scripts/import-store.ts` is itself dead → Phase 3 simplifies to deleting `src/store/`.
- If the duplicate IDs predate the current `create_issue` (imported from the old store) → 1d's urgency drops, though the lock is still worth having.
- If an extension needs to run untrusted third-party code rather than owner-authored code → Phase 7 needs process isolation, not an allowlist, and grows substantially.

---

## Tracked items

| ID | Title | Status |
|---|---|---|
| EPIC-0038 | Runtime repair, consolidation, extensibility | planned |
| WISH-0021 | Single-service Decibel runtime | open |
| ISS-0129 | `close_issue` corrupts bare-YAML records | **closed** (`4ecad91`) |
| ISS-0127 | `--daemon install` reports success while launchctl fails | open — Phase 0 |
| ISS-0140 | No `update_epic` tool | open — Phase 1f |
| ISS-0136 | Renumber duplicate `ISS-NNNN` ids | open — Phase 2 |
| ISS-0105 | Converge sentinel issue stores on `.md` | open — Phase 5 |
| ISS-0130 | `src/store/` is dead code | open — **premise incorrect** |
| ISS-0110 | Oracle/roadmap report wrong epic state | open — related to ISS-0140 |
| — | No CI integrity check for frontmatter | open (2026-04-30) — Phase 1b |
| — | Resolution string written unescaped | open, raised to high — Phase 1e |
