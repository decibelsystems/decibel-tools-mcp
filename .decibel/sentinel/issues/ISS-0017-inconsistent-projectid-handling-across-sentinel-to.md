---
uid: 019b3dd8-89b4-703f-ba94-2186cd97c027
id: ISS-0017
projectId: decibel-tools-mcp
status: closed
priority: high
tags:
  - pathing
  - beta-blocker
  - consistency
created_at: 2025-12-20T22:19:19.860Z
updated_at: 2026-09-01T21:49:11.109Z
closed_at: 2026-09-01T21:49:11.043Z
resolution: Fixed. sentinel_log_epic declares projectId in its input schema (src/tools/sentinel/index.ts), so it no longer depends on cwd or an env var.
---
# Inconsistent projectId handling across Sentinel tools

**Status:** closed

## Details

sentinel_log_epic does not accept projectId parameter - relies on cwd/env var. But sentinel_createIssue and sentinel_listIssues DO accept projectId. This breaks remote/MCP usage where there's no cwd context. All tools must accept explicit projectId for beta rollout.

## Resolution

Fixed. sentinel_log_epic declares projectId in its input schema (src/tools/sentinel/index.ts), so it no longer depends on cwd or an env var.
