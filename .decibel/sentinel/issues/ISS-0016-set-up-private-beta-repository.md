---
uid: 019b3436-128b-7522-8cd5-b9e8c6874c6e
id: ISS-0016
projectId: decibel-tools-mcp
status: closed
priority: high
epic_id: EPIC-0001
tags:
  - beta
  - release
  - distribution
created_at: 2025-12-19T01:25:17.579Z
updated_at: 2026-08-29T16:18:24.809Z
closed_at: 2026-08-29T16:18:24.809Z
resolution: "Completed: Beta repo created, package published to npm as @anthropic/decibel-tools. Distribution now via npm + Claude Code plugin."
---
# Set up private beta repository

**Status:** closed
**Epic:** EPIC-0001

## Details

Create a private beta release at https://github.com/decibelsystems/decibel-tools-beta

## Completed
- [x] Create repository structure
- [x] Beta README with feature matrix
- [x] RELEASES.yaml for stage tracking
- [x] Issue templates
- [x] CHANGELOG.md
- [x] Beta testing guide

## Pending
- [ ] Sync full source code (see issue #1 in beta repo)
- [ ] Invite beta testers
- [ ] Set up feedback collection process

## Release Staging System
Implemented: dojo → alpha → beta → release

See ADR-0003 for details.

## Resolution

Completed: Beta repo created, package published to npm as @anthropic/decibel-tools. Distribution now via npm + Claude Code plugin.
