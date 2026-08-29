---
id: ISS-0139
projectId: decibel-tools-mcp
severity: low
status: open
created_at: 2026-08-28T17:32:55.736Z
---

# Multilingual support for the setup flow (src/setup.ts user-facing strings)

**Severity:** low
**Status:** open

## Details

TODO captured 2026-08-28 (Ben).

**What**: The `decibel setup` flow is English-only. All user-facing copy in `src/setup.ts` (547 lines, ~40 `console.log` strings: banner, client detection table, dry-run preview, confirmation prompt "Write Decibel into N client config(s)? [y/N]", result lines, license/daemon/verify messages, and the "Next steps" block at :529-534) is hardcoded English.

**Why it matters**: The setup CLI is the first thing a new user touches — it ships in the .mcpb installer bundle and the npm package, so it's the widest non-English exposure surface we have.

**Scope to decide before implementing**:
1. Which strings — setup CLI only, or also the installer wizard and tool error messages (e.g. the PROJECT_NOT_FOUND actionable hints in projectRegistry.ts)?
2. Locale detection — `LANG`/`LC_ALL` env, a `--lang` flag, or `locale:` in `~/.decibel/config.yaml`? Probably all three with that precedence.
3. Mechanism — a plain `Record<locale, Record<key, string>>` message catalog (no runtime dep) vs. pulling in an i18n library. Lean toward the former; setup.ts has no deps today and the installer bundle is size-sensitive.
4. Which locales ship first. English + one other to prove the plumbing.
5. The y/N confirmation at :465 hardcodes `'y'` — affirmative-answer matching must be per-locale, not just the label.

**Not in scope (unless raised later)**: translating the MCP tool descriptions/schemas themselves, which the model reads rather than the user.

**Ambiguity flag**: read "db tools" as "decibel tools". If Ben meant the database-backed tools (senken/Postgres), this issue needs re-scoping.
