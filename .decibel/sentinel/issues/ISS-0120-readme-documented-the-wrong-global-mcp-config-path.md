---
uid: 019ff739-64f5-7387-8a87-794a3e5cee6f
id: ISS-0120
projectId: decibel-tools-mcp
severity: med
status: closed
created_at: 2026-08-12T18:26:01.589Z
closed_at: 2026-08-12T18:26:47.075Z
---

# README documented the wrong global MCP config path for Claude Code

**Severity:** med
**Status:** closed

## Details

README's "Connect your AI client → Claude Code" section said to add mcpServers to `~/.claude/settings.json` for a global install. That file holds model/hooks/enabledPlugins — Claude Code reads global MCP servers from `~/.claude.json`. Verified on this machine: ~/.claude.json has mcpServers (render, decibel-tools, supabase, claude-peers, figma); ~/.claude/settings.json has none.

Impact: anyone following the README for a global Claude Code install wrote a config that was silently ignored, with no error to diagnose. Caught while building the EPIC-0035 setup wizard, which had inherited the same wrong path from the README before it shipped.

Fixed in README (2026-08-12) and in src/setup.ts (detectClients now targets ~/.claude.json, with a regression test asserting the path). Filing for the record and because other docs may repeat it — docs/, llms.txt, llms-full.txt, and the marketing site should be swept for the same claim.

## Resolution

Fixed in 89490ac. README now points to ~/.claude.json for global Claude Code MCP config, and src/setup.ts detectClients targets that path with a regression test asserting it. Remaining docs hits for ~/.claude/settings.json are hooks-related and correct as written; llms.txt/llms-full.txt and the marketing site still worth a sweep under ISS-0093.
