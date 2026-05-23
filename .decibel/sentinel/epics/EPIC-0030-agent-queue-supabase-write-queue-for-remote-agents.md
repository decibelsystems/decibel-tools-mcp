---
id: EPIC-0030
projectId: decibel-tools-mcp
title: Agent Queue — Supabase Write Queue for Remote Agents
summary: Generic Supabase queue enabling remote agents to perform write operations (create issues, ADRs, friction logs, wishes, etc.) that get synced locally on demand. Mirrors the voice inbox pattern — Supabase as queue, local files as source of truth.
status: in_progress
status_updated_at: 2026-05-20T18:08:33.000Z
status_evidence: "agentQueue.ts + agenticJobs.ts present; MVP dispatch shipped (PR #21)"
priority: high
tags: [agent-queue, supabase, infrastructure, phase-9]
owner: 
squad: 
created_at: 2026-03-31T04:16:26.972Z
---

# Agent Queue — Supabase Write Queue for Remote Agents

## Summary

Generic Supabase queue enabling remote agents to perform write operations (create issues, ADRs, friction logs, wishes, etc.) that get synced locally on demand. Mirrors the voice inbox pattern — Supabase as queue, local files as source of truth.

## Motivation

- Remote agents (cloud Claude, mobile, external integrations) had zero write access to local .decibel/ project data
- Blocking step toward full Supabase migration for project data
- Agents need to log issues, decisions, and friction without filesystem access

## Outcomes

- agent_queue Supabase table with RLS and partial indexes
- Queueable actions allowlist covering 7 facades (sentinel, architect, dojo, friction, designer, feedback, provenance)
- agentQueueSync tool on agentic facade — replays queued items through kernel with provenance tracking
- agentQueueStatus tool for agents to poll sync results
- HTTP transport auto-queues write calls from remote agents (X-Agent-Id detection)
- 26 new tests, all passing
- Human-readable summary doc for Rich at .decibel/specs/2026-03-30-agent-queue-summary.md

## Acceptance Criteria

- [ ] Remote agent can POST /call with X-Agent-Id and get { status: 'queued' } for write operations
- [ ] agentic queue_sync replays queued items and writes local YAML + provenance events
- [ ] Non-queueable actions (reads) execute immediately as before
- [ ] Provenance ref backlinked to queue row after sync
