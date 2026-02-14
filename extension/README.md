# Decibel Tools for VS Code

Your project already has a plan, a history, and open questions. Decibel makes all of that visible to every agent you work with so they show up informed instead of blank.

Agents read the roadmap, architecture decisions, and open issues before touching code. They write back what they learn: new issues, experiments, design rationale. Project memory that compounds across sessions. Same context whether you're in Claude, Cursor, or Copilot.

## Install

`Cmd+Shift+P` > **Extensions: Install from VSIX...** > select the `.vsix` file.

Activates in any workspace with a `.decibel/` directory.

## Views

**Work.** Epics by status, issues by state, priority and severity at a glance.

**Incubation.** Wishes, proposals, experiments. Ideas in flight and what's ready to graduate.

## Commands

| Command | Action |
|---------|--------|
| `Decibel: Project Status` | Project health overview |
| `Decibel: Preflight Check` | Pre-commit quality checks |
| `Decibel: Create Issue` | Title + severity |
| `Decibel: Create Epic` | Title + summary |
| `Decibel: Add Wish` | Capability + reason |
| `Decibel: Refresh` | Reload views |

Status bar quick pick has all of these.

## Multi-Agent

Each agent spawns its own server by default. Daemon mode shares one:

```sh
npm run start:daemon
```

Set `decibel.useDaemon: true`, reload. Status bar shows **Decibel (daemon)**. Falls back to local if the daemon goes down.

## Pro

`Cmd+Shift+P` > **Decibel: Activate Pro** > `DCBL-XXXX-XXXX-XXXX`

Unlocks voice, studio, corpus, and agentic features. Dev override: `decibel.devMode: true`.

## Settings

| Setting | Default | |
|---------|---------|---|
| `decibel.serverPath` | auto | Path to server, or auto-detect |
| `decibel.useDaemon` | `false` | Bridge to running daemon |
| `decibel.daemonUrl` | `localhost:4888` | Daemon address |
| `decibel.autoRefresh` | `true` | Periodic tree refresh |
| `decibel.autoRefreshInterval` | `60` | Seconds between refreshes |
| `decibel.licenseKey` | | Pro key |
| `decibel.devMode` | `false` | Unlock pro without key |

## Build

```sh
cd extension && npm install && npm run package
```
