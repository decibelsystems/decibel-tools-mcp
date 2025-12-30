---
id: EPIC-0023
projectId: decibel-tools-mcp
title: Decibel Tools Mobile Controller
summary: iOS Pocket Console for Decibel ecosystem - capture voice inputs, observe project health, trigger tool actions, share artifacts with team
status: planned
priority: high
tags: [mobile, ios, capture, voice, sharing]
owner: 
squad: 
created_at: 2025-12-30T05:22:39.251Z
---

# Decibel Tools Mobile Controller

## Summary

iOS Pocket Console for Decibel ecosystem - capture voice inputs, observe project health, trigger tool actions, share artifacts with team

## Motivation

- Ideas happen away from desk - need capture anywhere
- Need visibility into project health on the go
- Team communication needs frictionless artifact sharing
- Desktop dashboards don't work on mobile

## Outcomes

- iOS app in App Store
- Voice capture of Dojo events
- Glanceable project status
- One-tap sharing of ADRs/Epics
- Voice commands for tool actions

## Acceptance Criteria

- [ ] Cold launch to recording <= 2s
- [ ] Zero offline data loss
- [ ] Sync latency <= 60s when online
- [ ] Share extension creates events
- [ ] Status glance <= 10s
- [ ] SharePacks work via native share sheet
