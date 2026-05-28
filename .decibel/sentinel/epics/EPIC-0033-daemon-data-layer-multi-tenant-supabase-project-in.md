---
id: EPIC-0033
projectId: decibel-tools-mcp
title: Daemon data layer: multi-tenant Supabase project-intelligence store
summary: Make the daemon/MCP serve org-scoped, tenant-isolated project intelligence (oracle/sentinel/architect/friction) from a shared Supabase store instead of box-local .decibel files — the daemon-side half of HQ's multi-tenant SaaS (Ben's decision D). Web reads Supabase directly under RLS; the daemon is the write/agent surface with user-JWT write identity. See ADR-0007 for full architecture. Cross-repo: HQ owns schema/RLS + web; this epic is the decibel-tools-mcp side.
status: planned
priority: high
tags: []
owner:
squad:
created_at: 2026-05-24T12:16:14.354Z
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
