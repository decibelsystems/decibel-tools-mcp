# Decibel Claude Code hooks

Version-controlled home for the two hand-maintained Claude Code hooks that were
previously only at `~/.decibel/hooks/` (untracked). Vendored here so they have
history, review, and a one-command install. Tracks sentinel issue
`2026-05-25T14-29-11Z` and pairs with the daemon port/discovery fix
(`2026-05-23T23-32-49Z`).

## The hooks

| File | Event | What it does |
|------|-------|--------------|
| `session-init.sh` | `SessionStart` | Discovers the daemon port from `~/.decibel/daemon.meta` (fallback 4888), POSTs `/batch` for `oracle.next_actions` + `voice.inbox_sync` + `agentic.queue_sync` + `sentinel.list_issues`, and injects a **compact digest** (counts + top-3 next actions, ~93 tok). Falls back to a one-line nudge if the daemon is down. |
| `issue-close-reminder.sh` | `PostToolUse` (Bash) | After a **successful `git commit`**, auto-closes any issue named in a `Closes:`/`Fixes:`/`Resolves:` trailer via `sentinel.close_issue`, auto-links the commit, and (at most **once per session**, one line) reminds about open issues. |

## Install

### Plugin install (recommended — automatic)

If you installed decibel-tools as a **Claude Code plugin** (`/plugin install
decibel-tools@decibel-marketplace`), the hooks are **already active** — no setup.
`hooks/hooks.json` declares them, Claude Code auto-discovers it, and the scripts
resolve via `${CLAUDE_PLUGIN_ROOT}` from the plugin cache. Plugin hooks **merge**
with your existing `~/.claude/settings.json` hooks (they don't replace them).

### Manual install (npm / non-plugin)

If you're running the MCP from npm or a raw checkout (not the plugin), register
the hooks into your global settings:

```sh
./hooks/install.sh
```

Copies both hooks into `~/.decibel/hooks/` and registers them in
`~/.claude/settings.json` (idempotent, backed up). Requires `jq`.

> Copies, not symlinks: the hooks are registered globally and fire for every
> Claude instance on the machine, so they must not depend on this repo's current
> checkout/branch. Re-run `./hooks/install.sh` (e.g. after `git pull`) to update.

> The hooks only depend on `~/.decibel/` for **runtime data** (`daemon.meta`,
> `runs/`) which is the same on every machine; they discover the daemon port
> dynamically. So the same script works identically whether run from the plugin
> cache (`${CLAUDE_PLUGIN_ROOT}`) or `~/.decibel/hooks/`.

## Commit convention

Add a trailer and the completion hook closes the issue deterministically:

```
fix(x): ...

Closes: 2026-05-23T23-32-49Z-...   # Fixes: / Resolves: also work; one id per line
```

## Design constraints (preserve these — learned the hard way)

- **Token-lean output.** Never dump raw JSON or full issue lists into context —
  counts + top-3 only; nudges at most once per session.
- **Port discovery via `daemon.meta`**, never a hardcoded port (fallback 4888,
  the canonical daemon default).
- **Facade action names are snake_case** (`list_issues`, not `listIssues`).
- **Use `printf '%s'` (not `echo`)** when piping daemon JSON to `jq` — zsh `echo`
  mangles `\n` / `\"` escapes.
- Hooks **always exit 0** and print JSON (or `{}`) — never block the user's flow.
