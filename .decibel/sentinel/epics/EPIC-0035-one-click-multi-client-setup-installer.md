---
id: EPIC-0035
projectId: decibel-tools-mcp
title: One-click multi-client setup installer
summary: "Ship a one-click / single-command setup that gets a new user running with Decibel Tools across Cursor, Claude Code, and Claude Desktop without hand-editing config. The installer detects installed AI clients and writes the correct MCP server entry to each client's config location (Cursor ~/.cursor/mcp.json or per-project .cursor/mcp.json, Claude Code .mcp.json / ~/.claude/settings.json, Claude Desktop claude_desktop_config.json), and optionally provisions/writes the license key to ~/.decibel/config.yaml for the HTTP/production path. Removes the current manual, per-client, know-which-file-and-paste-JSON onboarding."
status: planned
priority: high
tags: []
owner: core
squad: ""
created_at: 2026-07-11T15:36:28.022Z
---

# One-click multi-client setup installer

## Summary

Ship a one-click / single-command setup that gets a new user running with Decibel Tools across Cursor, Claude Code, and Claude Desktop without hand-editing config. The installer detects installed AI clients and writes the correct MCP server entry to each client's config location (Cursor ~/.cursor/mcp.json or per-project .cursor/mcp.json, Claude Code .mcp.json / ~/.claude/settings.json, Claude Desktop claude_desktop_config.json), and optionally provisions/writes the license key to ~/.decibel/config.yaml for the HTTP/production path. Removes the current manual, per-client, know-which-file-and-paste-JSON onboarding.

## Motivation

- Onboarding a new teammate today requires knowing a different config file per client and pasting JSON by hand
- Installing the npm package creates no config; first-run never writes one, so users hit a wall
- Provisioning a pro license key is a manual SQL insert plus a hand-created `~/.decibel/config.yaml`
- Directly advances OBJ-0002 Universal Client Reach by lowering the barrier to every supported client

## Outcomes

- A single command or app installs Decibel into all detected clients in one step
- No manual JSON editing required for the common case
- Optional license/config provisioning handled by the same flow

## Acceptance Criteria

- [ ] Detects which of Cursor / Claude Code / Claude Desktop are installed
- [ ] Writes the correct MCP server block to each client's config path idempotently (no clobbering existing servers)
- [ ] Optionally writes `~/.decibel/config.yaml` with a provided license key
- [ ] Verifies the server connects after install
- [ ] Documented single-command entry point (e.g. `npx @decibelsystems/tools setup`)

## Scope split

Phase 1 and Phase 2 serve different users and have very different cost profiles. They are tracked separately so the milestone does not hinge on code signing.

### Phase 1 — `npx @decibelsystems/tools setup` (target: M-0003 / v2.2)

CLI wizard for users who already have Node. Covers every developer onboarding.

- Client detection (Claude Desktop, Claude Code, Cursor)
- Idempotent JSON merge per client — must preserve Claude Desktop's `preferences` / `coworkUserFilesPath` blob and any pre-existing `mcpServers` entries
- `/bin/zsh -lc` wrapper applied on macOS to defeat Desktop's stripped PATH
- Optional license key → `~/.decibel/config.yaml` (reuses `daemonConfig.ts`)
- Optional daemon install (reuses existing `--daemon install` launchd path)
- Post-write verification: spawn the server and confirm it lists tools
- Prompt for full quit (⌘Q) + reopen

Reuses: `daemonConfig.ts`, `--daemon install/uninstall/status`, `registry init`, the client config shapes already documented in README.

### Phase 2 — signed native installer (target: post-M-0003)

For non-technical users with no Node present. This is the Angela case from the 2026-06-24 friction log.

- Bundles or bootstraps Node (Homebrew fallback on macOS)
- Signed `.pkg`/`.dmg`, Developer ID cert + `notarytool` in CI (unsigned trips Gatekeeper for exactly the user this targets)
- Windows track: `.msi` / winget, no launchd, no zsh wrapper
- Candidate alternative form factor: `.dxt` Claude Desktop extension (true one-click, Desktop-only)

## Dependencies

- ISS-0094 (Stripe webhook for automatic license key generation) blocks fully automated license provisioning; until it lands, the installer can only accept a manually issued key.

## Related

- ISS-0115 — One-click Mac/PC installer for Decibel tools (non-technical onboarding)
- Friction: `.decibel/friction/2026-06-24T20-43-06Z-setting-up-decibel-tools-in-claude-desktop-for-a-l.md`
