---
id: ISS-0134
projectId: decibel-tools-mcp
severity: med
status: open
created_at: 2026-08-20T05:35:08.761Z
epic_id: EPIC-0037
---

# Daemon ingest must resolve a registering session to a durable hq.agents identity (agent_id seam for EPIC-0037)

**Severity:** med
**Status:** open
**Epic:** EPIC-0037

## Details

New work on the decibel-tools-mcp side, created by the addressing fix in EPIC-0037 and flagged rather than assumed by the decibel-hq session.

decibel-hq's draft migration (supabase/migrations/20260820000001_hq_agent_post_office.sql, NOT yet applied) adds:

  alter table hq.agent_sessions
    add column if not exists agent_id uuid references hq.agents (id) on delete set null;

That column is the resolution edge between ephemeral presence and durable identity. It is additive and nullable, mirroring the `runtime` precedent from 20260612000001, and it is inert until OUR ingest path populates it. Nothing on the HQ side can fill it in — the daemon owns the presence write path that merges claude-peers peers plus locally-registered runtimes into hq.agent_sessions.

WHAT THE DAEMON NEEDS TO DO:
- On session registration/heartbeat, resolve or create the durable hq.agents row for this session (org + name unique) and write its id into agent_sessions.agent_id.
- `name` is the durable ADDRESS, so it must be stable across restarts. A session key is not a candidate; neither is anything derived from a PID or TTY. Likely inputs: project/repo identity plus role, or an explicitly configured agent name.
- `runtime` is a self-declared label and explicitly NOT a trust signal per the schema comment. Do not gate anything on it.

WHY IT MATTERS: without this, hq.resolve_agent_session(agent_id) can never find a live session, so every message resolves to delivered_session_key = NULL. The post office would accept and record traffic that is never delivered — and record it honestly, which is the design working as intended, but the system would be inert.

ALSO REVISED — agents.list shape. decibel-hq initially specified it as a live view over hq.agent_sessions and has since corrected that: it must be hq.agents LEFT JOIN liveness. The roster is the DURABLE agents, each annotated with whether a live session currently resolves. An agent that exists but is offline must appear as offline rather than vanish — under the earlier shape it would silently disappear from the roster, which is the same failure class as addressing a dead session.

Liveness comes from hq.resolve_agent_session(agent_id), matching the Roster presence convention (status='active' AND last_seen_at within 60s), returning the live session_key or NULL. The facade must surface a NULL delivery outcome to the caller rather than swallowing it.

Blocked on: the migration landing (decibel-hq, after its own POL-0001 security review), and the ADR-0009 phase 4 sequencing decision.
