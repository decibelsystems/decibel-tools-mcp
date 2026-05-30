---
id: EPIC-0032
projectId: decibel-tools-mcp
title: Claude Code Hooks for Decibel Tool Integration
summary: Automated Claude Code hooks that trigger Decibel tools at key development moments — session init, pre-commit, pre-push, and post-edit.
status: in_progress
status_updated_at: 2026-05-20T18:08:33.000Z
status_evidence: "3 of 4 hook types active in .claude/settings.json (pre-commit pending)"
priority: high
tags: [hooks, automation, dx, guardian, sentinel, oracle, designer, architect]
owner: Ben
squad: 
created_at: 2026-04-08T05:36:05.446Z
---

# Claude Code Hooks for Decibel Tool Integration

## Summary

Automated Claude Code hooks that trigger Decibel tools at key development moments — session init, pre-commit, pre-push, and post-edit.

## Motivation

- Manual tool invocation is easy to forget (oracle, voice sync, queue sync)
- Security issues can slip through without pre-push guardian scans
- Architecture-sensitive edits happen without ADR consideration
- Designer review of UI changes requires manual opt-in

## Outcomes

- SessionStart hook injects oracle/voice/queue sync reminders
- Sentinel pre-commit agent checks open issues against commits
- Guardian pre-push agent blocks on D/F grade findings
- Architecture nudge prompts ADR on sensitive file edits
- Designer visual-review hook documented as opt-in
- Peer agents (decibel-agent) adapting the pattern for marketer/mother peers
