# Decibel Tools for VS Code

Project intelligence that compounds across sessions. Agents read the roadmap, architecture decisions, and open issues before touching code. They write back what they learn. Same context whether you're in Claude, Cursor, or Copilot.

## Features

**Work tracking.** Epics grouped by status (in progress, planned, shipped, on hold). Issues by open/closed with severity badges. Create both from the command palette.

**Incubation.** Wishes (ideas), proposals (ready to build), and experiments (in flight). Track the journey from "wouldn't it be nice" to shipped feature.

**Voice inbox (Pro).** Voice messages from iOS sync to your sidebar. Grouped by status — queued, processing, completed, failed. Each message shows its parsed intent and transcript.

**Daemon mode.** Multiple agents share one server. Status bar shows whether you're running local (stdio) or connected to a daemon.

## Free vs Pro

| Feature | Free | Pro |
|---------|------|-----|
| Work view (epics, issues) | Yes | Yes |
| Incubation view (wishes, proposals, experiments) | Yes | Yes |
| Create issues, epics, wishes | Yes | Yes |
| Project status, preflight | Yes | Yes |
| Daemon bridge mode | Yes | Yes |
| Voice inbox view | - | Yes |
| Voice sync and commands | - | Yes |
| Studio, corpus, agentic facades | - | Yes |

Pro requires a license key: `Cmd+Shift+P` > **Decibel: Activate Pro** > `DCBL-XXXX-XXXX-XXXX`.

Dev override: set `decibel.devMode: true` in settings.

## Install

**From VSIX:** `Cmd+Shift+P` > **Extensions: Install from VSIX...** > select the `.vsix` file.

Activates automatically in any workspace with a `.decibel/` directory.

## Commands

| Command | Action |
|---------|--------|
| `Decibel: Project Status` | Project health overview |
| `Decibel: Preflight Check` | Pre-commit quality checks |
| `Decibel: Create Issue` | Log a new issue (title + severity) |
| `Decibel: Create Epic` | Start a new epic (title + summary) |
| `Decibel: Add Wish` | Add a capability wish (capability + reason) |
| `Decibel: Refresh` | Reload all tree views |
| `Decibel: Activate Pro` | Enter license key |
| `Decibel: Deactivate Pro` | Remove license key |
| `Decibel Pro: Sync Voice Inbox` | Pull voice messages from Supabase |
| `Decibel Pro: Voice Command` | Send a text command through voice pipeline |

All commands are also available via the status bar quick pick.

## Multi-Agent / Daemon Mode

By default each VS Code window spawns its own MCP server. To share one server across windows and agents:

```sh
npm run start:daemon   # starts daemon on :4888
```

Then in VS Code settings: `decibel.useDaemon: true`. Status bar shows **Decibel (daemon)**. Falls back to local stdio if the daemon goes down.

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `decibel.serverPath` | (auto) | Path to MCP server entry point |
| `decibel.useDaemon` | `false` | Connect to running daemon |
| `decibel.daemonUrl` | `http://localhost:4888` | Daemon address |
| `decibel.autoRefresh` | `true` | Periodic tree refresh |
| `decibel.autoRefreshInterval` | `60` | Seconds between refreshes (10-600) |
| `decibel.licenseKey` | | Pro license key |
| `decibel.devMode` | `false` | Unlock pro without key (dev only) |

## Troubleshooting

**Trees are empty.** Check the Decibel Tools output channel (`View > Output > Decibel Tools`). Common causes: no `.decibel/` directory in workspace, MCP server failed to start.

**"MCP server not connected" message in tree.** The server process crashed or couldn't start. Check that `dist/server.js` exists (run `npm run build` in the parent directory). The extension auto-restarts up to 3 times.

**Pro features not showing.** Verify your key format is `DCBL-XXXX-XXXX-XXXX`. The extension validates against Supabase — if offline, a previously validated key is cached for 24 hours.

**Daemon mode not connecting.** Ensure the daemon is running (`curl http://localhost:4888/health`). Check `decibel.daemonUrl` matches the daemon's port.

## Privacy

- **License validation** sends your license key to Supabase to check validity. No other data is transmitted. Results are cached locally for 24 hours.
- **Voice sync** (pro only) pulls messages from your Supabase project. Messages stay in your account.
- **All project data** (epics, issues, wishes, experiments) is stored locally in `.decibel/` within your workspace. Nothing is uploaded.

## Build

```sh
cd extension && npm install && npm run package
```

Produces `decibel-tools-{version}.vsix`.
