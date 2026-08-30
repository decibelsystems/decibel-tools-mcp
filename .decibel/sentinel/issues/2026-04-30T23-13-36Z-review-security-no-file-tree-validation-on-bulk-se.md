---
uid: 019de0ab-4ddc-71be-9faf-92d823f43a5d
id: 2026-04-30T23-13-36Z-review-security-no-file-tree-validation-on-bulk-se
projectId: decibel-tools-mcp
severity: low
status: open
created_at: 2026-04-30T23:13:36.220Z
---

# [review/security] no file-tree validation on bulk sentinel operations — risk of leaking .decibel/runs/ runtime data into commits

**Severity:** low
**Status:** open

## Details

## Discovered during PR #16 (mediareason/decibel-tools-mcp) review

**Tagged in HQ-side review as Sec-L2.**

### Surface

PR #16 was a bulk-modification operation against 23 sentinel issue files. The commit was clean (only `.decibel/sentinel/issues/*.md` modifications), but that was verified manually via `git status` — there's no policy enforcement that bulk operations don't accidentally capture stray files.

### Threat

A bulk-modification flow that runs in a daemon working tree and uses `git add -A` (or any wildcard pattern that catches `.decibel/runs/`, `.decibel/provenance/events/`, or `.claude/`) could:

1. Leak local-only daemon runtime data into a public-facing PR
2. Leak Claude Code session state (prompts, tool calls) into committed history
3. Leak agent run artifacts that may contain partial outputs / intermediate state

During PR #16 a `git stash` mid-flow surfaced merge conflicts on `.decibel/runs/RUN-*/events.jsonl` — confirming these files exist in working trees and are easy to capture accidentally.

### Suggested fix

1. Daemon-side: emit a stricter `.gitignore` (or document a recommended template) that gitignores all auto-generated daemon working-tree artifacts (`.decibel/runs/`, `.decibel/provenance/events/` raw stream — keep only the curated list).
2. Add a bulk-operation safety hook: any sentinel/friction/provenance action that modifies >5 files at once should emit a console warning listing affected paths.
3. Add a `decibel-cli verify-clean` command that checks the working tree for runtime artifacts before committing, intended to be invoked from a pre-commit hook.

### Mitigated today by

The HQ repo's `.gitignore` (when imported via the mediareason fork) already excludes `.decibel/runs/` and `.decibel/provenance/events/`. But the daemon repo itself does NOT — see `git status` after any daemon invocation showing `.decibel/runs/RUN-*/` as untracked. Daemon-side hygiene is missing.

### Cross-references

- HQ-side fix: `c396d96 fix(.decibel): gitignore auto-generated subdirs so working tree stays clean` (already landed on HQ via mediareason PR #1)
- Same pattern needs to land daemon-side
