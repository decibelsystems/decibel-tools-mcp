# Proposal: Shared Agent Context Layer

**Status**: Draft v2 (fleet-reviewed)
**Date**: 2026-03-26
**Origin**: Multi-agent coordination session — manual relay bottlenecks exposed gaps between memory (long-term) and tasks (checklist)
**Reviewed by**: deck-web, deck-arena, decibel-agent, deck (iOS), studio (frontend_v0.2), machina (VTT)

---

## Problem

Today we ran a 5-agent fleet across 4 repos coordinated by a 5th. Every finding, decision, and blocker had to route through the coordinator as a manual relay. When decibel-agent found a bug in deck_search, it took 3 message hops and ~5 minutes before deck-web even knew. A redundant fix was built because agents couldn't see each other's work. There's no shared understanding of "the mission," no way to publish a finding to whoever needs it, and no shared workspace for intermediate artifacts.

**Current tools and their gaps:**

| Tool | Timeframe | Gap |
|------|-----------|-----|
| Memory | Weeks–months | Too slow, too permanent for active work |
| Tasks | Hours | Checklist only — no context, no sharing across agents |
| Peer messaging | Minutes | Point-to-point, requires knowing peer IDs, no persistence |

What's missing: a **live, shared context layer** for multi-agent sessions with a shelf life of hours to weeks.

---

## Design: Five Primitives

### 1. Session

A named, mission-scoped container for multi-agent coordination. Not repo-scoped — a session can span any number of repos.

```yaml
session:
  id: "SESSION-2026-03-26-marketer-push"
  mission: "Strengthen DeckScry marketer agent with gameplay/price insights"
  started: 2026-03-26T21:14:00Z
  coordinator: decibel-tools-mcp
  status: active | paused | completed | abandoned
  participants:
    - id: ppve5vvh
      repo: deck-web
      role: "Data layer — Supabase cards, prices, decks"
      capabilities: ["query_supabase", "modify_deck_web", "run_scryfall_sync"]
      subscriptions: ["card_data", "content_pipeline", "api_contracts"]
    - id: i5mxz6go
      repo: deck-arena
      role: "Gameplay data — draft picks, match results, win rates"
      capabilities: ["arena_log_parsing", "17lands_data", "match_analytics"]
      subscriptions: ["card_data", "shared_schema", "arena_log"]
    - id: n2t6xcnr
      repo: decibel-agent
      role: "Agent intelligence — marketer skills, scheduling, content DNA"
      capabilities: ["agent_skills", "content_generation", "scheduling"]
      subscriptions: ["*"]  # coordinator sees all
    - id: 74ryxfa5
      repo: deck
      role: "Mobile UX — engagement formats, push notification hooks"
      capabilities: ["ios_development", "storekit", "push_notifications"]
      subscriptions: ["api_contracts", "breaking_change", "new_capability"]
  closed: null
  resumed_from: null  # for session continuation
```

**Key behaviors:**
- **Zero-ceremony creation**: auto-created from the first signal on a new mission, or explicitly via tool call
- **Capability registration**: on join, agents declare what they can do — enables routing requests to the right participant without knowing peer IDs
- **Topic subscriptions**: on join, agents declare what topics they care about — signals are filtered accordingly
- **Pause vs close**: `paused` sessions survive indefinitely for multi-day/week epics; `closed` sessions trigger learnings extraction. Auto-pause after 24h inactivity, auto-close after 7 days paused.
- **Session resume**: a new agent can join an existing paused session and see all prior signals + artifacts

**Tool surface:**
- `context_start_session` — create session with mission, optionally invite participants
- `context_join_session` — join active/paused session, declare role + capabilities + subscriptions
- `context_session_status` — read current state (mission, participants, signals, artifacts, snapshots)
- `context_pause_session` — pause for later continuation
- `context_close_session` — close session, trigger learnings extraction

### 2. Signals

Structured, typed events published to the session. Routed by topic, not by peer ID. Append-only with timestamps.

```yaml
signal:
  id: "SIG-001"
  session: "SESSION-2026-03-26-marketer-push"
  type: bug_found
  topic: "deck_search"
  emitter: n2t6xcnr
  emitter_role: "Agent intelligence"
  severity: high
  summary: "deck_search returns empty for current Standard staples"
  payload:                    # typed JSONB — structure depends on signal type
    searched: "Thalia and The Gitrog Monster"
    result_count: 0
    works_for: "Ancient Tomb"
    hypothesis: "Data coverage gap in cards table"
  needs: "deck_search owner to investigate data source"
  claimed_by: null
  resolved: false
  resolution: null
  acks:
    - peer: ppve5vvh
      status: "will_act"
      at: 2026-03-26T22:22:30Z
  timestamp: 2026-03-26T22:21:59Z
```

**Signal types:**

| Type | Semantics | Example |
|------|-----------|---------|
| `bug_found` | Something's broken | "deck_search empty for Standard cards" |
| `fix_applied` | Something was fixed | "Scryfall fallback added to deck_search" |
| `blocker` | Can't proceed without help | "Need image_uri — blocked on card data" |
| `decision` | A choice was made | "Adding fallback at tool layer, not just marketer" |
| `finding` | Useful info discovered | "cards table has 2,625 rows, seeded at $5+ only" |
| `request` | Need something from someone | "Need bulk ingest cron on deck-web" |
| `api_changed` | Endpoint/contract changed | "GET /api/movers now available with period/format params" |
| `breaking_change` | Urgent — will break consumers | "cards table schema changed, image_uri column renamed" |
| `schema_changed` | DB migration applied | "Added mana_value column to cards table" |
| `new_capability` | New feature available | "Movers endpoint live, marketer can consume it" |
| `gate` | Blocking dependency resolved | "Core build complete, downstream safe to proceed" |
| `intent` | Declaring upcoming action | "About to migrate machina_characters table" |

**Signal lifecycle:**
- **Emit**: any participant publishes to a topic
- **Ack**: lightweight acknowledgment — `seen`, `will_act`, `not_relevant` (closes the loop without full response)
- **Claim**: for `request` signals — first-claim-wins, prevents duplicate work
- **Release**: unclaim a request you can't fulfill — returns to unclaimed pool
- **Resolve**: mark resolved with resolution note and optional link to fix

**Delivery guarantees:**
- Signals delivered to subscribed participants via MCP push
- Explicit `check_signals(since=timestamp)` polling fallback for missed signals (learned from Machina's Supabase Realtime reliability issues)
- `requires_ack: true` flag for breaking changes — surfaces prominently until acknowledged

**Tool surface:**
- `context_emit_signal` — publish a signal to the session
- `context_read_signals` — list signals, filterable by type/topic/resolved/since
- `context_ack_signal` — lightweight acknowledgment (seen/will_act/not_relevant)
- `context_claim_signal` — claim a request signal
- `context_release_claim` — unclaim a request
- `context_resolve_signal` — mark resolved with resolution note

### 3. Artifacts

Named, versioned outputs shared across the session. Deliberate productions — analysis results, specs, brainstorms, data snapshots.

```yaml
artifact:
  id: "ART-001"
  session: "SESSION-2026-03-26-marketer-push"
  name: "marketer-brainstorm-results"
  type: analysis | spec | data | decision_log | api_contract
  author: coordinator
  version: 1
  summary: "Fleet brainstorm: 25+ content ideas across 4 domains"
  content: |
    ## deck-arena: Draft Signal of the Day, Concede Index, Trap Card...
    ## deck-web: Price Spike Alert, Sleeper Pick, Format Pulse...
    ## deck: $5 vs $50, Collection Moved, Reprint Roulette...
    ## decibel-agent: Meta-Shift Reactor, Content DNA, Reply Intelligence...
  tags: ["marketer", "content-strategy"]
  persist: false  # if true, graduates to .decibel/ on session close
  superseded_by: null
  timestamp: 2026-03-26T21:22:00Z
```

**Key behaviors:**
- Any participant can read any artifact in the session
- Versioned — updates create new version, `superseded_by` links to latest
- On session close, artifacts tagged `persist: true` graduate to `.decibel/` project files
- Large artifacts stored as references (file path or URL) rather than inline

**Tool surface:**
- `context_add_artifact` — publish an artifact to the session
- `context_read_artifact` — read by name or ID (returns latest version by default)
- `context_list_artifacts` — list all artifacts, filterable by type/tags

### 4. Context Snapshots

Persistent shared registries that live **beyond any single session**. Ambient state that any agent can query at any time. Supports both publish-on-change and pull-on-demand patterns.

This primitive emerged from studio's need (design tokens, asset types, feature flags) and machina's need (external API contracts, type exports). These aren't session artifacts — they're long-lived shared state.

```yaml
snapshot:
  id: "SNAP-studio-design-tokens"
  owner: frontend_v0.2
  topic: "design_tokens"
  summary: "Active design system: decibelTokens (red accent, zinc surfaces)"
  payload:
    accent: "#FF3B30"
    surface: "zinc"
    token_file: "src/styles/decibelTokens.js"
    # ... structured, queryable data
  publish_mode: on_change   # on_change | manual | scheduled
  last_verified: 2026-03-26T22:50:00Z
  last_changed: 2026-03-26T22:45:00Z
  version: 12
  staleness_threshold: "7d"  # warn consumers if older than this
  previous_version: 11
  diff_from_previous:
    changed: { "accent": { from: "#FF2D20", to: "#FF3B30" } }
```

**Snapshot categories:**

| Category | Examples | Publish Mode |
|----------|----------|--------------|
| Design systems | Tokens, theme config | on_change |
| Asset registries | Asset types, schemas | on_change |
| Feature flags | Flag state, rollout % | on_change |
| API contracts | Endpoint shapes, rate limits | manual |
| External dependencies | Service status, rate limits | scheduled |
| Type exports | Shared type definitions | on_change |

**Key behaviors:**
- **Publish on change**: owner pushes diff + full snapshot when data changes — subscribers notified immediately
- **Pull on demand**: any agent can query any snapshot at any time for reference
- **Staleness indicators**: `last_verified` timestamp + `staleness_threshold` — consumers see "this is 3 weeks old, verify before relying"
- **Diff + full**: updates include both the delta and the current full state
- **Independent of sessions**: snapshots persist indefinitely, owned by the publishing agent/repo

**Tool surface:**
- `context_publish_snapshot` — create or update a snapshot (includes diff)
- `context_read_snapshot` — read a snapshot by ID or topic
- `context_list_snapshots` — list all snapshots, filterable by topic/owner/staleness
- `context_subscribe_snapshot` — register for push notifications on change

### 5. Learnings Extraction

When a session closes, the system reviews signals + artifacts and extracts what should persist. Agent-level logic, tool-level storage.

**Extraction rules:**
- `decision` signals → candidate memory entries or ADRs (via architect)
- `bug_found` + `fix_applied` pairs → friction log entries (via friction)
- `finding` signals → project memory updates
- Unresolved `request` signals → sentinel issues
- Artifacts tagged `persist` → `.decibel/` project files
- Signal patterns → self-learning (via decibel-agent's extraction layer)

**Key behaviors:**
- Extraction runs automatically on `context_close_session`
- Coordinator reviews extracted learnings before they're committed
- Uses existing Decibel tools as destinations (sentinel, architect, friction, learnings, memory)
- Content DNA pattern: structured signals → categorized patterns → extractable profile

**Tool surface:**
- `context_close_session` triggers extraction automatically
- `context_review_learnings` — coordinator reviews/approves extracted items before commit

---

## Architecture

### Backing Store: MCP facade over Supabase

**Interface**: MCP tool calls (clean, repo-agnostic — any MCP client participates without filesystem coupling)
**Storage**: Supabase tables (queryable, supports Realtime for push, accessible from all repos)

This follows the existing pattern: deck tools are MCP facades over Supabase. Agents don't need to know the backing store.

```
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│  deck-web   │  │ deck-arena  │  │   machina   │
│  (Claude)   │  │  (Claude)   │  │  (Claude)   │
└──────┬──────┘  └──────┬──────┘  └──────┬──────┘
       │                │                │
       └────────────────┼────────────────┘
                        │
                   MCP tool calls
                        │
              ┌─────────┴─────────┐
              │  context facade   │
              │ (decibel-tools)   │
              └─────────┬─────────┘
                        │
              ┌─────────┴─────────┐
              │     Supabase      │
              │  agent_sessions   │
              │  agent_signals    │
              │  agent_artifacts  │
              │  agent_snapshots  │
              └───────────────────┘
                        │
              Supabase Realtime (push)
              + polling fallback (pull)
```

**Tables:**

```sql
agent_sessions (id, mission, coordinator, status, participants JSONB,
                created_at, paused_at, closed_at, resumed_from)

agent_signals  (id, session_id, type, topic, emitter_id, emitter_role,
                severity, summary, payload JSONB, needs, claimed_by,
                resolved, resolution, acks JSONB, requires_ack, created_at)

agent_artifacts (id, session_id, name, type, author, version, summary,
                 content TEXT, tags TEXT[], persist, superseded_by, created_at)

agent_snapshots (id, owner, topic, summary, payload JSONB, publish_mode,
                 last_verified, last_changed, version, staleness_threshold,
                 diff_from_previous JSONB, created_at)
```

**Why not file-based:**
- Cross-repo access is the hard problem (unanimous from fleet review)
- Supabase Realtime enables push notifications for signals and snapshot changes
- SQL queryable for post-hoc analysis and self-learning extraction
- Already used by deck tools — no new infrastructure

**Reliability:**
- Polling fallback (`check_signals(since=timestamp)`) for missed Realtime events
- Learned from Machina's Supabase Realtime reliability issues
- Signal compaction / TTL for long sessions (archive resolved signals after 48h)

---

## Resolved Open Questions

| Question | Resolution | Source |
|----------|-----------|--------|
| Conflict on claims | First-claim-wins + `release_claim` to unclaim | deck-arena |
| Cross-repo access | MCP tool interface, Supabase backing store | All 6 (unanimous) |
| Session scope | Mission-scoped, not repo-scoped | All 6 (unanimous) |
| Signal routing | Topic subscriptions, broadcast as escape hatch | deck-arena, deck iOS |
| Session duration | Hours to weeks — `pause` vs `close` distinction | machina |
| Persistence | Supabase (survives restarts, queryable, supports Realtime) | decibel-agent |

## Remaining Open Questions

1. **Signal compaction** — How aggressively to archive/compact old signals in long-running sessions? TTL-based? Or keep everything queryable?
2. **Snapshot ownership transfer** — What happens when the owning agent/repo goes offline? Should snapshots have backup owners?
3. **Multi-coordinator** — Can sessions have multiple coordinators, or always one? What about leaderless sessions?
4. **Cost model** — At scale (10+ agents, hundreds of signals), what's the Supabase cost profile? When to compact?
5. **Auth/permissions** — Should some signals or artifacts be restricted to certain participants, or is everything visible within a session?

---

## How Today Would Have Gone

1. I create a session: "Strengthen DeckScry marketer" — auto-assigns ID
2. Each agent joins, declares role + capabilities + topic subscriptions
3. All brainstorm results → artifacts (any agent can read, future sessions can reference)
4. decibel-agent emits `bug_found` on topic "deck_search" — deck-web and I see it immediately (we subscribe to card_data)
5. deck-web acks with `will_act`, publishes `finding`: "cards table is static, 2,625 rows, $5+ seed only"
6. I claim the "add Scryfall fallback" request, deck-web claims "run bulk ingest"
7. decibel-agent sees both claims — knows not to build redundant workaround
8. I emit `fix_applied`, deck-web emits `new_capability` ("95k cards loaded, movers API live")
9. deck iOS sees `new_capability`, knows to wire up movers client
10. Session pauses (multi-day epic) or closes → learnings extracted

**Time saved:** ~15 minutes of manual relay. **Duplicate work prevented:** decibel-agent's redundant Scryfall fallback. **Context preserved:** future sessions can reference the brainstorm artifact and the deck_search root cause.

---

## Implementation Priority

| Phase | What | Why First |
|-------|------|-----------|
| 1 | Sessions + Signals (+ Supabase schema) | Eliminates the relay bottleneck — biggest pain point |
| 2 | Artifacts | Shared workspace for intermediate outputs |
| 3 | Context Snapshots | Persistent shared registries (design tokens, API contracts, etc.) |
| 4 | Learnings Extraction | Closes the loop — sessions feed back into the knowledge system |

Phase 1 is the MVP. A session you can join + signals you can emit/read/claim solves 80% of today's coordination pain.

---

## Fleet Review Summary

| Peer | Key Contribution |
|------|-----------------|
| **deck-web** | MCP over files (unanimous driver), capability registration, signals over messages |
| **deck-arena** | Signal ack lifecycle, release_claim, topic subscriptions over broadcast |
| **decibel-agent** | Tool-level not agent-level, Supabase backing, strict signal schema, context snapshots, auto-session creation |
| **deck (iOS)** | `api_changed`/`breaking_change` signal types, staleness concern, consumer perspective |
| **studio** | Context Snapshots primitive, publish/pull hybrid, diff+full pattern, staleness indicators |
| **machina** | Dependency gates, intent/conflict detection, session pause/resume, polling fallback, monorepo generalization |
