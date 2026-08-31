---
id: EPIC-0037
projectId: decibel-tools-mcp
title: "AgentHQ as post office: model-agnostic agent-to-agent messaging over remote MCP"
summary: Make the Decibel/HQ daemon the single integration surface through which heterogeneous agents (Claude Code, ChatGPT/OpenAI Responses API, local models) exchange work objects — not prompts. Both vendors now speak remote MCP over Streamable HTTP, so no OpenAI-specific bridge is needed. Agents talk to HQ; HQ never becomes a peer of either. The shared vocabulary is a small message/handoff envelope carrying references, while each agent performs work through its own tools.
status: in_progress
priority: high
tags:
  - hq
  - mcp
  - interop
  - agent-to-agent
  - openai
  - architecture
owner: ""
squad: ""
created_at: 2026-08-20T05:22:19.829Z
updated_at: 2026-08-30T23:16:20.240Z
---

# AgentHQ as post office: model-agnostic agent-to-agent messaging over remote MCP

## Summary

Make the Decibel/HQ daemon the single integration surface through which heterogeneous agents (Claude Code, ChatGPT/OpenAI Responses API, local models) exchange work objects — not prompts. Both vendors now speak remote MCP over Streamable HTTP, so no OpenAI-specific bridge is needed. Agents talk to HQ; HQ never becomes a peer of either. The shared vocabulary is a small message/handoff envelope carrying references, while each agent performs work through its own tools.

## Motivation

- Ben is using ChatGPT alongside Claude Code again and wants the two to collaborate without hand-carrying context between them.
- Both OpenAI and Anthropic now speak remote MCP over Streamable HTTP (SSE is deprecated on the Claude side), so a vendor-specific bridge would be strictly worse than the shared protocol.
- The existing claude-peers layer is machine-local: the peers facade is a thin pass-through to a broker on localhost:7899, so a ChatGPT session can never be a peer. The post office must live in the daemon, which is exactly why HQ sits above the peer layer rather than inside it.
- Roughly 80 percent of the substrate already exists — /mcp Streamable HTTP endpoint, per-session capability-token auth (ADR-0008), an agent registry at /agents, and a command inbox with enqueue/drain/ack in src/agentInbox.ts.
- What is missing is the messaging SEMANTICS, not the transport: today's channel is HQ-to-agent command dispatch, not agent-to-agent threaded conversation.
- Communication must not become the memory. Messages should reference artifacts rather than duplicate thousands of tokens of context, keeping .decibel/ as the epistemic layer and git as the implementation layer.

## Outcomes

- A deliberately small shared surface: agents.list, threads.open, messages.send, messages.read, messages.ack, handoff.request, handoff.respond — and nothing else exposed as the agent-to-agent language.
- A versioned message envelope (from, to, project, thread, intent, summary, context_refs, request, expected_output) and a response envelope (status, summary, artifact_refs, questions).
- A ChatGPT session can open a thread against a project, hand work to a Claude Code session, and receive a structured response referencing ADRs and specs rather than pasted prose.
- Model independence: swapping GPT, Claude, Gemini or a local model changes nothing about the protocol, because agents share work objects rather than prompts.
- The 250-plus Decibel tools stay OUT of the interop vocabulary; agents reach them through their own transport as they do today.

## Acceptance Criteria

> **Revised 2026-08-20 after design review by the decibel-hq session.** Three
> criteria below replace the originals; see "Design review corrections".

- [ ] The seven-verb surface is defined as a facade with a documented envelope schema, and is versioned independently of the internal tool registry.
- [ ] Messages address a DURABLE LOGICAL AGENT IDENTITY (org + runtime + name/role) that resolves to a live session at delivery time — never a session key. Threads and handoffs survive session churn on either side.
- [ ] Threads and messages persist in Supabase as new tables (`hq.agent_threads`, `hq.agent_messages`), org-scoped under RLS. `.decibel/` receives a provenance PROJECTION carrying thread id, intent and refs — never the message body.
- [ ] The endpoint STAMPS the envelope's `from` from the authenticating token and ignores any `from` supplied in the body. Org is a property of the credential, not a claim in the payload.
- [ ] An external agent authenticates with an org-scoped agent token (decibel-hq ADR-0009 class, sibling to `hq.daemon_tokens`), is listed by agents.list, and completes a full round trip: threads.open, messages.send, messages.read, handoff.request, handoff.respond.
- [ ] Remote access is served by a Supabase edge function (`supabase/functions/agent-mcp/`) speaking Streamable HTTP. The local daemon stays bound to 127.0.0.1:4888 (decibel-tools-mcp ADR-0006) and is NOT tunnelled.
- [ ] `agents.list` is a live view over `hq.agent_sessions` (active, recent `last_seen_at`), not a second roster. The daemon's `/agents` registry converges into that write path.
- [ ] An end-to-end demo: ChatGPT opens a thread on a real project, requests an architecture proposal, and a Claude Code session responds with artifact_refs that resolve to real files.
- [ ] Message bodies are bounded BY SCHEMA — a hard length constraint on the summary column (~2KB), with `context_refs[]` the only unbounded field. Oversized bodies are rejected, never silently truncated.

## Design review corrections

Reviewed by the decibel-hq session against that repo's migrations and ADRs. Four
corrections to this epic as originally filed:

1. **ADR references must be repo-qualified.** The numbers collide across repos.
   `ADR-0006` (daemon binds 127.0.0.1:4888), `ADR-0007` (org-scoped Supabase
   store) and `ADR-0008` (per-session capability tokens) are **decibel-tools-mcp**.
   In **decibel-hq**, `ADR-0005` is Plan D, `ADR-0007` is the agent-presence
   service_role exception, `ADR-0008` is git-vault/Supabase-active, and
   `ADR-0009` is the runtime-agnostic agent contract.

2. **Storage is Supabase, not `.decibel/`** — original criterion overruled. A
   ChatGPT connector is remote by definition and can never reach a box-local
   `.decibel/`; threads on disk would mean the post office only delivers when
   both agents share a filesystem. decibel-hq ADR-0008 also fixes git as vault
   and Supabase as the active surface, one-way only — and messages have mutable
   state (unread → read → acked), which is exactly the two-way sync that ADR
   refuses.

3. **`hq.agent_commands` cannot be the substrate.** Its
   `agent_commands_insert_admin` policy restricts INSERT to org admins, and
   decibel-hq ADR-0009 locks that in as a security invariant: agents only ever
   receive and ack, never originate. Agent-to-agent messaging requires a
   non-human principal to originate, so riding `agent_commands` would break the
   one guarantee the control surface makes.

4. **Session keys are not durable addresses.** A session key is stable for a
   session's lifetime but a restart correctly mints a new one. Addressing `to`
   as a peer means the first restart mid-handoff addresses a dead session. This
   was a real bug in the seven-verb design and is fixed by the logical-identity
   criterion above.

## Open questions

- **Blocking, unverified:** does ChatGPT's connector UI accept an opaque bearer
  token, or does it require OAuth on the remote MCP server? This determines
  whether agent tokens suffice or need an OAuth wrapper. Load-bearing for the
  whole epic — verify before building.
- **Sequencing — Ben's call.** decibel-hq considers this epic to be ADR-0009
  phase 4 plus a message schema: same edge function, same token class. Per
  POL-0001 the BYO write path ships only after its own security review. So
  either phase 4 sequences first, or the two are scoped as one piece of work.
  They are not parallel.

## Ownership

- **decibel-hq**: storage schema (`hq.agent_threads`, `hq.agent_messages`), the
  edge endpoint, and the agent-token model.
- **decibel-tools-mcp**: the seven-verb facade and the daemon-side client.

## Note (2026-08-30T23:16:20.240Z)

2026-08-30: HQ side is LIVE, not planned. Tables + RLS + OAuth 2.1 + both edge functions deployed; discovery answering at https://home.theagenthq.app with a correct RFC 9728 challenge. ISS-0134 and ISS-0135 closed against verified evidence. The client half is barely started: 1 of 7 verbs exists (agents.list, via listAgentRoster). The six unbuilt verbs were untracked until now — see the new issue. ChatGPT can write into a thread today; Claude Code cannot read or ack, and that is the only gap left before a real round trip.
