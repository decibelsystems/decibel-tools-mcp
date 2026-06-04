# Session Summary — Plan D: HQ Multi-Tenant SaaS + Daemon Port Fix

**Dates:** 2026-05-24 → 2026-05-25
**Repos:** `decibel-tools-mcp` (daemon/MCP — this repo) + `decibel-hq` (Supabase schema/RLS + web), co-designed live over the claude-peers channel.
**Sentinel:** see the session epic + EPIC-0033 (daemon data layer).

---

## TL;DR
A "deck-web can't reach the daemon" report turned into (1) shipping a daemon **canonical-port fix**, then (2) building **Decibel HQ as a real multi-tenant SaaS** (Ben's "Plan D"): project intelligence moves from box-local `.decibel/` files into an **org-scoped Supabase store**, the **web reads it directly under RLS**, and the **daemon is the write/agent surface**. Sentinel + architect domains are live in prod with real data; two more domains + the daemon live-write path remain.

---

## 1. Daemon canonical-port fix — SHIPPED (PR #27, merged, ADR-0006)
**Symptom:** every SessionStart / deck-web reported "daemon not reachable" though the daemon was healthy.
**Root cause (not stale dist):** `parseHttpArgs()` baked in `port=8787` / `host=0.0.0.0` defaults for *every* mode; those truthy values won the `||` chains in `server.ts`, making `daemonConfig`'s `4888`/`127.0.0.1` **dead code** in daemon mode. One bug → three symptoms: wrong port, all-interfaces bind, bridge-mode misroute.
**Fix:** `parseHttpArgs` returns `undefined` when flags absent (still honors `PORT` for Render); `transports/http.ts` + `start.sh` → 4888; SessionStart doc `list_issues` casing.
**Also:** clients discover the live port from `~/.decibel/daemon.meta` (extension + `boot-local.sh`). Closed the long-standing 2026-04-01 `0.0.0.0` exposure. 3-way verified live (daemon + HQ + hook).

## 2. Multi-tenant store foundation — MERGED (PR #28, ADR-0007, EPIC-0033)
- **Locked decisions (Ben):** tenant = **org/workspace**; web **reads Supabase directly under RLS**; daemon = **write path** with **user-JWT write-identity** (`X-User-Key` → membership RLS, no service-role for tenant writes) + `X-Org-Key` tenant routing.
- **Built:** `Store` abstraction (`FsStore` local/git-tracked | `SupabaseStore` hosted), markdown-safe parsers, `getStore()` factory (`DECIBEL_STORE`), `X-Org-Key`/`X-User-Key` plumbing through `DispatchContext`.
- **Dissolved** the "daemon on web" problem — the web needs no daemon for reads.

## 3. Sentinel domain — LIVE + BACKFILLED
- One-time importer (`scripts/import-store.ts`, idempotent, service_role, `--dry-run`).
- **Project onboarding backfill:** 637 issues across **19 repos** imported into the Decibel org → **641 total, 20/20 projects**, HQ-verified under RLS (member sees all, non-member 0, anon denied).
- HQ `/issues` reader live (decibel-hq PRs #27/#28).

## 4. Architect domain — IMPORT + READER LIVE
- **ADRs unified on `.md`** (frontmatter + `## Context/## Decision/## Consequences`); **legacy `.yml` still read** (no migration — "support legacy yaml"). `create_adr` writes `.md`; `read_adr`/`list_adrs` tolerate both. Verified round-trip.
- Importer extended (domain-aware); **9 ADRs imported** into the decibel-tools-mcp project.
- HQ `/architecture` reader live (decibel-hq PR #34), 9 ADRs render under RLS.

## 5. Agent-presence domain — CO-DESIGNED (build pending)
Live agent monitoring (cloud + realtime Roster). Contract locked: `hq.agent_sessions` keyed `(org_id, host, session_key=claude-peers peer id)`, ~30s heartbeat + stale-sweep (>90s idle / >5min ended), `meta jsonb` for forward-compat, **service_role write for v1** (documented scoped exception — presence is telemetry, agents carry no user JWT), member SELECT RLS. HQ building the table; daemon presence-writer is mine to build next.

---

## Key decisions (durable)
- **4888 / 127.0.0.1 is canonical** for the local daemon.
- **Tenant = org/workspace**; RLS scoped by `hq.org_members`; billing/plan_tier per org.
- **Web reads Supabase directly under RLS**; daemon is the write/agent surface.
- **Write-identity = caller's user JWT** (`X-User-Key`); **no service-role for tenant content writes** (presence telemetry is the one scoped exception).
- **`.md` is the canonical local format** across issues/ADRs; legacy `.yml` is read, not migrated.

## Security
- Peer-reviewed HQ's schema for the MCP-tool paths → **green**; gave 4 hardening nits (auto-`updated_at`, `created_by=auth.uid()`, composite-FK `project_id↔org_id`, importer insert-if-absent) — **all adopted** by HQ (migration `..003`).
- HQ's `/security-review` caught + fixed a HIGH admin→owner RLS privilege-escalation (role-floor trigger).
- `/security-review` on the port-fix branch: clean.

## Artifacts created this session
- ADRs: **ADR-0006** (canonical port), **ADR-0007** (multi-tenant store).
- Epic: **EPIC-0033** (daemon data layer) + a session epic.
- Issues closed: 2026-05-23 port issue, 2026-04-01 `0.0.0.0` binding, EPIC-0033 importer.
- Memory updated: daemon port (→4888), senken hosting topology, issue-ID-split ghost (resolved), HQ multi-tenant SaaS project note.

## In-flight / open follow-ups
- **`feat/multi-tenant-store`** carries the ADR-unify + architect-importer commits — **not yet pushed**; open the domain-#2 PR.
- **Finish domain #2:** `ArchitectStore` live-write + `record_arch_decision` converge → joint member-JWT write-smoke with HQ.
- **Domains friction + oracle** — same domain-config pattern.
- **Agent-presence daemon writer** — once HQ's `agent_sessions` table lands.
- **`read_issue`/`update_issue` store-split fix** (issue `2026-05-23T23-45-31Z`) — point them at the `.md` store (the new Store layer already does this).
- **senken hosted-daemon cutover** (`DECIBEL_STORE=supabase` + submodule bump) — deliberate future step; senken untouched so far.

## Notable context
- **senken.pro hosts the MCP** = this repo as a submodule of senken-trading (Python/gunicorn) at `/opt/render/.../decibel-mcp`. Single-tenant/box-local today; the SaaS store supersedes it for the web.
- The "YAML ghost": a reverted April `ISS-NNNN`/`.yml` issue-store experiment whose remnants resurfaced; resolved — `.md` canonical, legacy `.yml` read.
