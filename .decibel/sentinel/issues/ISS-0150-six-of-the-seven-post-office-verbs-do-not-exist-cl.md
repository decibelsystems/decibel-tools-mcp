---
uid: 01a054f5-a5e8-7089-b9e7-bbecd5a96c4a
id: ISS-0150
projectId: decibel-tools-mcp
severity: high
status: closed
priority: high
epic_id: EPIC-0037
tags:
  - epic-0037
  - post-office
  - agent-hq
  - facade
created_at: 2026-08-30T23:16:20.071Z
updated_at: 2026-08-31T02:32:39.740Z
closed_at: 2026-08-31T02:32:39.618Z
resolution: "Resolved by commit c7b0e38: EPIC-0037: the post office client — all seven verbs"
---
# Six of the seven post-office verbs do not exist — Claude Code cannot read or ack a thread

**Severity:** high
**Status:** closed
**Epic:** EPIC-0037

## Details

The post office is live on the HQ side and this repo has none of the client half. Filed because it was not tracked anywhere, which is most likely why it read as covered.

VERIFIED ABSENT 2026-08-30 across main, all local and remote branches, and dist: threads.open, messages.send, messages.read, messages.ack, handoff.request, handoff.respond. Zero matches for any spelling. No facade in src/facades/definitions.ts, no branch in progress.

What DOES exist is one verb's worth: listAgentRoster (src/agentPresence.ts:258), which covers agents.list. That is 1 of 7.

WHAT IS ALREADY DONE ON THE HQ SIDE (verified over the wire, not taken on report):
  - hq.agents / agent_threads / agent_messages live with RLS (20260820000001, 20260825000002)
  - agent_tokens + four oauth_* tables + hq.resolve_bearer + hq.issue_agent_token (20260825000001)
  - edge functions agent-oauth and agent-post-office deployed, verify_jwt=false
  - POST https://home.theagenthq.app/agents/mcp unauthenticated returns 401 with a correct RFC 9728
    WWW-Authenticate carrying resource_metadata

CONSEQUENCE, which is the reason this matters: ChatGPT can already authenticate and write into a thread, and a human can read it in HQ at /interchange. Claude Code cannot read or ack natively. These six verbs are the only thing between here and a working round trip.

Design notes before anyone starts:
  - This is a pro-tier facade. It must go in src/facades/definitions.ts so it reaches BOTH transports; adding it     to httpServer.ts alone is the failure mode CLAUDE.md calls out.
  - Discovery origin is https://home.theagenthq.app. hq.decibelsystems.com has NO DNS — confirmed unresolvable.     Do not hardcode the latter.
  - The 60s liveness window in hq.resolve_agent_session is pinned against LIVENESS_WINDOW_MS (c84022b). Changing     one without the other silently breaks presence.
  - Bearer credentials must not be logged; the dispatch log is written to disk unredacted.

[2026-08-30] 2026-08-30 — read/ack semantics settled with the decibel-hq peer. Recording so it is not re-litigated at implementation time.

messages.read MUST NOT implicitly ack. They stay separate.

  1. The applied schema already decided it. hq.agent_messages has separate read_at and acked_at columns and a      four-state status ('sent','read','acked','failed'). Implicit ack makes acked_at dead weight and collapses      four states into three. Migration argument, not preference.
  2. Failure semantics. Implicit ack is at-most-once: a reader that fetches and dies before acting has silently      consumed the message. Separate is at-least-once: it re-reads on restart. A duplicated 'review section 4'      costs a minute; a dropped handoff stalls work invisibly, and invisible stalls are the exact failure the      post office exists to surface.
  3. THE BUG THAT WOULD SILENTLY UNDO THIS: if messages.read sets status='read', then a mailbox query of      status='sent' never returns it again and a crashed reader cannot recover it — separate columns,      at-most-once behaviour anyway. The mailbox predicate must be status NOT IN ('acked','failed'), never      status='sent'. The index hq_agent_messages_inbox_idx on (to_agent_id, status, created_at desc) supports      either, so nothing stops it being written wrong.

Corollaries: ack is idempotent (acking twice is not an error); read is non-destructive.

## Resolution

Resolved by commit c7b0e38: EPIC-0037: the post office client — all seven verbs
