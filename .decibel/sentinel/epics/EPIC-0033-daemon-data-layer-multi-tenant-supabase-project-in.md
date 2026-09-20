---
id: EPIC-0033
projectId: decibel-tools-mcp
title: "Daemon data layer: multi-tenant Supabase project-intelligence store"
summary: "Make the daemon/MCP serve org-scoped, tenant-isolated project intelligence (oracle/sentinel/architect/friction) from a shared Supabase store instead of box-local .decibel files — the daemon-side half of HQ's multi-tenant SaaS (Ben's decision D). Web reads Supabase directly under RLS; the daemon is the write/agent surface with user-JWT write identity. See ADR-0007 for full architecture. Cross-repo: HQ owns schema/RLS + web; this epic is the decibel-tools-mcp side."
status: cancelled
priority: high
tags: []
owner: null
squad: null
created_at: 2026-05-24T12:16:14.354Z
updated_at: 2026-09-20T01:43:38.150Z
---

# Daemon data layer: multi-tenant Supabase project-intelligence store

## Summary

Make the daemon/MCP serve org-scoped, tenant-isolated project intelligence (oracle/sentinel/architect/friction) from a shared Supabase store instead of box-local .decibel files — the daemon-side half of HQ's multi-tenant SaaS (Ben's decision D). Web reads Supabase directly under RLS; the daemon is the write/agent surface with user-JWT write identity. See ADR-0007 for full architecture. Cross-repo: HQ owns schema/RLS + web; this epic is the decibel-tools-mcp side.

## Motivation

- senken.pro is single-tenant + box-local: serves only the Render box's decibel-mcp project, ignoring project_id (resolveProject strategy 6/7 fallback)
- No shared project-data store exists for general facades — blocks any hosted multi-project/per-user view
- Ben wants HQ to be a real multi-tenant product

## Outcomes

- Daemon resolves project_id to org-scoped Supabase rows for hosted deployments
- Daemon writes carry the caller user-JWT so Supabase RLS enforces tenant isolation end-to-end
- Local/dev keeps git-tracked .decibel via an FsStore behind the same interface
- Existing .decibel data migrated into the store, idempotently

## Acceptance Criteria

- Store interface with FsStore + SupabaseStore impls, selected by config
- oracle/sentinel/architect/friction read+write through the Store (no direct fs in handlers for the hosted path)
- Tenant-aware resolver replaces strategy 6/7 box-fs collapse for hosted
- X-User-Key/DispatchContext.userKey JWT forwarded to Supabase; RLS verified to block cross-org access
- One-time .decibel to store importer, idempotent, parses canonical .md frontmatter
- read_issue/update_issue store-split fixed before importer

> Note: this epic's Motivation/Outcomes/Acceptance sections were repaired by hand after the log_epic array-field serialization bug (issue 2026-05-25T15-16-24Z) rendered them char-per-line.

## Note (2026-09-20T01:43:38.150Z)

Superseded by EPIC-0039, 2026-09-19.

Ben decided that git is authoritative for project-intelligence records and Supabase is a
projection that must always be rebuildable from the repo. This epic's acceptance criteria
encode the opposite shape — "Store interface with FsStore + SupabaseStore impls", "no direct
fs in handlers for the hosted path" — i.e. Supabase replacing the fs writer rather than
mirroring it.

Left as written rather than rewritten in place. Editing the acceptance criteria would have
destroyed the record of what was decided in May and when, and the reasoning is the point of
keeping an epic at all.

Two of its premises also turned out to be factually wrong, which is worth recording here
rather than only in the successor:

- FsStore is not the writer. src/store/ is unreachable from live code; the live writers are
  FsIssueRepository via tools/sentinel.ts, and tools/architect.ts for ADRs.
- The daemon is not where most writes happen. decibel-tools is registered as a stdio server
  in ~/.claude.json, so each Claude session writes in its own process.

What carries forward: the org-scoped multi-tenant goal, ADR-0007, and the X-Org-Key
plumbing that already exists and is consumed by nothing. What does not: the store-swap.
