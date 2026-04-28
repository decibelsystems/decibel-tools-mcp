---
id: ISS-0102
projectId: decibel-tools-mcp
severity: high
status: open
created_at: 2026-04-10T06:36:11.312Z
---

# Project-level .mcp.json missing Supabase env vars — breaks session init for all Claudes in this repo

**Severity:** high
**Status:** open

## Details

## Problem

When Claude Code opens a session in this repo, the project-level `.mcp.json` overrides the global `~/.claude/.mcp.json`. The project config uses `--env-file=.env` but has no `env` block, so if the .env file isn't found (e.g. worktree agents, fresh clones), `voice inbox_sync` and `agentic queue_sync` fail with "Supabase is not configured".

The global config at `~/.claude/.mcp.json` works fine — it has an explicit `env` block with the Supabase vars. But the project-level config shadows it.

## Constraint

`.mcp.json` is tracked in git (not gitignored), so we can't put secrets directly in it.

## Options discussed

1. **Gitignore `.mcp.json`** — simplest, it's machine-specific anyway
2. **Drop `--env-file=.env`** and rely on shell env inheritance from `~/.zshrc`
3. **Split config** — keep `.mcp.json` clean for git, use `.mcp.local.json` or similar for env

## Files involved

- `.mcp.json` (project-level, tracked in git)
- `~/.claude/.mcp.json` (global, has env block, works)
- `.env` (has the vars, gitignored)
- `src/tools/voice.ts:735` — throws on missing Supabase
- `src/tools/agentic/agentQueue.ts:109,285` — throws on missing Supabase
