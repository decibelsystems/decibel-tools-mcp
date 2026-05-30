---
id: EPIC-0034
projectId: decibel-tools-mcp
title: Plan D rollout: HQ multi-tenant SaaS + daemon port fix (2026-05-24/25 session)
summary: Session arc: a deck-web "daemon unreachable" report uncovered a daemon port-binding bug, which expanded into building Decibel HQ as a real multi-tenant SaaS (Ben's "Plan D"). Cross-repo effort with decibel-hq (HQ owns Supabase schema/RLS + web readers; this repo owns the daemon data layer + importer). Shipped to prod within the session.
status: planned
priority: high
tags: []
owner:
squad:
created_at: 2026-05-25T06:47:25.701Z
---

# Plan D rollout: HQ multi-tenant SaaS + daemon port fix (2026-05-24/25 session)

## Summary

Session arc: a deck-web "daemon unreachable" report uncovered a daemon port-binding bug, which expanded into building Decibel HQ as a real multi-tenant SaaS (Ben's "Plan D"). Cross-repo effort with decibel-hq (HQ owns Supabase schema/RLS + web readers; this repo owns the daemon data layer + importer). Shipped to prod within the session.

## Motivation

- deck-web + every Claude SessionStart reported "daemon not reachable" despite a healthy daemon (port drift: bound *:8787, clients expected 4888)
- Ben's decision to make HQ a real multi-tenant SaaS (chose option D over single-tenant/box-local)
- Support users who don't have or don't want git — cloud-backed project intelligence via Supabase

## Outcomes

- Daemon binds canonical 127.0.0.1:4888 (PR #27, ADR-0006) + clients discover via daemon.meta; the *:8787/0.0.0.0 all-interfaces exposure closed
- Multi-tenant org-scoped Supabase store: Store abstraction (FsStore|SupabaseStore), user-JWT write-identity (X-User-Key) + X-Org-Key routing, domain-aware importer (PR #28, ADR-0007, EPIC-0033)
- Sentinel domain LIVE: 641 issues across 20 projects in the Decibel org, RLS-verified (member sees all, non-member 0, anon denied)
- Architect domain: ADRs unified on .md (legacy .yml still read), 9 ADRs imported, /architecture reader live
- Agent-presence domain co-designed (hq.agent_sessions write contract)

## Acceptance Criteria

- DONE: canonical port fix + client discovery shipped + merged (CI green)
- DONE: multi-tenant store foundation merged; sentinel domain live + 637-issue/19-repo backfill verified
- DONE: architect import (9 ADRs) + reader live
- REMAINING: ArchitectStore live-write + record_arch_decision converge -> joint member-JWT write-smoke
- REMAINING: friction + oracle domains (same domain-config pattern)
- REMAINING: agent-presence daemon writer (HQ building the table)
- REMAINING: push feat/multi-tenant-store + open domain-#2 PR

> Note: this epic's Motivation/Outcomes/Acceptance sections were repaired by hand after the log_epic array-field serialization bug (issue 2026-05-25T15-16-24Z) rendered them char-per-line.
