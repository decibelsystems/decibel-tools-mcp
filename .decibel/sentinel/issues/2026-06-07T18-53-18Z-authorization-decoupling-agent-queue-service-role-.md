uid: 019ea36e-a675-7de6-8525-34aee0ee36de
id: 2026-06-07T18-53-18Z-authorization-decoupling-agent-queue-service-role-
title: Authorization decoupling agent queue service role
project: decibel-tools-mcp
severity: high
status: in_progress
created_at: 2026-06-07T18:53:18.325Z
updated_at: 2026-08-29T18:20:54.576Z
description: |-
  

  [2026-06-07] [2026-06-07] PARTIAL fix shipped (commit fdd2822) + crucible re-run verified. queueForAgent is now reached only when an authenticated principal authorizes it (localhost-daemon bind, OR hosted+authToken) AND the agent is known (registry/config). In hosted mode /connect is now behind the auth gate, so the spoof-then-register path is closed there. RESIDUAL (verified at source, httpServer.ts queueForAgent created_by: agentId): created_by is still taken from the X-Agent-Id HEADER, so an AUTHENTICATED caller can still attribute a queue row to a DIFFERENT known agent's id. Reducing this fully requires a cryptographic token→agent_id binding — which IS the swarm's agent-token credential (agent-runtime-contract.md, BYO ingest). So the COMPLETE fix for B lands with the agent-token work; until then the gap is bounded to "valid-auth caller can mis-attribute among known agents" (down from "any anonymous caller, any project/agent"). This is the concrete reason security-then-swarm is the right order AND why B's final close is coupled to the agent-token credential.
