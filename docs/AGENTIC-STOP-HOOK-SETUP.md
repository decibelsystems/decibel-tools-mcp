# Agentic Stop-hook — Setup

This repo ships `scripts/agentic-stop-hook.mjs`, a Claude Code [`Stop` hook](https://docs.claude.com/claude-code/hooks) that auto-claims the oldest queued dispatch job in a project's `.decibel/agentic/jobs/` queue and feeds its prompt back as the session's next instruction — turning HQ's queue into a self-draining work loop.

The hook is **project-aware**: it walks up from the session's cwd to find `.decibel/` and only acts when an opt-in marker file is present. One global install on your machine serves every project.

---

## One-time install (per machine)

```bash
./scripts/install-stop-hook.sh
```

What it does (idempotent — safe to re-run):
1. Copies `scripts/agentic-stop-hook.mjs` → `~/.claude/scripts/`.
2. Ensures `~/.claude/package.json` + `~/.claude/node_modules/yaml` exist so the script can resolve its one external dep no matter where it's invoked from.
3. Detects whether `~/.claude/settings.json` already wires the Stop hook to the global path. If yes, says so. If no, prints the JSON snippet to add (it doesn't auto-edit `settings.json` because that file may already carry other hooks; merging JSON safely is the user's call).

After install, the Stop hook command line in `~/.claude/settings.json` looks like:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "test -f $HOME/.claude/scripts/agentic-stop-hook.mjs && node $HOME/.claude/scripts/agentic-stop-hook.mjs || true"
          }
        ]
      }
    ]
  }
}
```

The `test -f … && … || true` wrapper ensures the hook silently no-ops if the script gets removed, so no Claude Code session ever errors out at the Stop boundary.

---

## Per-repo opt-in

The installed hook is dormant in every project by default. To turn auto-pickup on for a specific repo, drop the marker file:

```bash
mkdir -p .decibel/agentic
touch .decibel/agentic/auto-pickup.on
```

The hook treats the *presence* of `.decibel/agentic/auto-pickup.on` as the on switch (file contents are ignored). Delete the file to turn it off.

To opt many repos in at once:

```bash
for d in ~/code/repo-a ~/code/repo-b ~/code/repo-c; do
  mkdir -p "$d/.decibel/agentic"
  touch "$d/.decibel/agentic/auto-pickup.on"
done
```

---

## How the hook works

1. Claude Code fires the Stop hook at the end of each session turn, piping a JSON payload to stdin (`{ cwd, session_id, ... }`).
2. The hook walks up from `payload.cwd` until it finds a `.decibel/` directory. If none, exit 0 silently.
3. It checks `<project>/.decibel/agentic/auto-pickup.on`. If absent, exit 0.
4. It scans `<project>/.decibel/agentic/jobs/*.yml` for jobs with `status: queued`, sorts by `created_at`, takes the oldest.
5. It atomically claims the job by writing `status: running` + `claimed_by` + `claimed_at` back to the file.
6. It writes a JSON response to stdout: `{ "decision": "block", "reason": "<prompt>" }`. Claude Code blocks the Stop and feeds `reason` as the session's next instruction.
7. The session executes the prompt as if the user had typed it. When it next stops, the hook fires again and picks up the next queued job, draining the queue one job per turn.

**Fail-open**: any error path exits 0 with no stdout. A Stop hook must never trap the user.

**Loop safety**: claiming flips `queued → running` *before* injecting, so the same job is never re-claimed. The queue strictly shrinks.

**Single-agent**: claiming is not atomic. Don't run this hook and `scripts/agent-worker.ts` against the same project at the same time.

---

## Why a global install instead of per-repo

`~/.claude/settings.json` is user-global on this machine. Every Claude Code session reads the same `Stop` hooks regardless of which repo it opens in. Because the script itself does the project-awareness work (walk-up + opt-in marker), one installed script serves every project — no per-repo `.claude/settings.json` files, no copies of the script in each repo.

The per-repo state is just the `.decibel/agentic/auto-pickup.on` marker, which **is** committed to the repo if you want auto-pickup on for everyone who works in it. Or `.gitignore` it for personal-only opt-in.

---

## Updating the script

The repo's `scripts/agentic-stop-hook.mjs` is the source of truth. After editing it, re-run `./scripts/install-stop-hook.sh` to push the change to `~/.claude/scripts/`. Without that step, the global hook keeps running the old version.

---

## Disabling everything

```bash
# Pause for one project:
rm <repo>/.decibel/agentic/auto-pickup.on

# Pause for the whole machine — comment out or remove the Stop hook entry in:
~/.claude/settings.json
```
