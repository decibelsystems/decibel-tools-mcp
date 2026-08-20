---
id: EPIC-0036
projectId: decibel-tools-mcp
title: Zoom meeting-summary ingestion with multi-client routing
summary: "Port the plasiv Zoom AI Companion puller (bin/pull-zoom-summaries.py, Python, stdlib-only) into decibel-tools-mcp as a pro-tier `zoom` facade, and extend it from single-repo to multi-client routing so one account-wide pull fans out to the right client project. Zero new npm deps (Node >=18 global fetch + fs). Local/stdio only until hosted-MCP auth is fixed."
status: planned
priority: medium
tags: [zoom, ingestion, pro-tier, client-work, meetings]
owner: ""
squad: ""
created_at: 2026-08-14T19:24:18.031Z
---

# Zoom meeting-summary ingestion with multi-client routing

## Summary

Port the plasiv Zoom AI Companion puller (bin/pull-zoom-summaries.py, Python, stdlib-only) into decibel-tools-mcp as a pro-tier `zoom` facade, and extend it from single-repo to multi-client routing so one account-wide pull fans out to the right client project. Zero new npm deps (Node >=18 global fetch + fs). Local/stdio only until hosted-MCP auth is fixed.

## Motivation

- Decibel runs one client engagement (plasiv) today and expects more; the puller currently has to be copied and re-pointed per repo
- Nothing in src/ touches meetings today — no overlap with corpus or the voice inbox
- Zoom returns next_steps as a structured array, which maps onto sentinel issues

## Outcomes

- One zoom facade across all Decibel projects instead of a per-repo script copy
- A weekly sync_all that routes each meeting to the right client project
- No silently dropped meetings
- Foundation for meeting-summary to sentinel-issue extraction

## Acceptance Criteria

- [ ] zoom facade registered in tools/index.ts under loadProTools and visible in both transports
- [ ] Dedup keyed on meeting_uuid, not filename
- [ ] Credentials read from ~/.decibel/config.yaml
- [ ] Per-project match rules on ProjectEntry
- [ ] Unmatched meetings land in an unrouted bucket, never dropped
- [ ] dry-run prints the routing table before writing
