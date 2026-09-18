---
uid: 019efc74-06e4-7edc-b66f-b75fb3448497
id: ISS-0144
projectId: decibel-tools-mcp
severity: med
status: closed
created_at: 2026-06-25T01:45:22.916Z
updated_at: 2026-08-29T16:45:59.259Z
closed_at: 2026-08-29T16:45:59.259Z
resolution: "Superseded by ISS-0115, which records the provenance: this issue was filed as ISS-0112 in the /Volumes/Kiki checkout, re-filed here as ISS-0115 because ISS-0112 was independently taken, and the Kiki copy was meant to be retired but was committed instead. Not a second issue — a stray copy."
---

# One-click Mac/PC installer for Decibel tools (non-technical onboarding)

**Severity:** med
**Status:** closed

## Details

TODO/feature: a one-click (max two-click) installer flow so non-technical users can set up Decibel tools without live hand-holding. Directly addresses the onboarding friction logged 2026-06-24 (`.decibel/friction/2026-06-24T20-43-06Z-setting-up-decibel-tools-in-claude-desktop-for-a-l.md`) — the angela setup required a technical person walking through every step.

What it should automate (the manual chain we hit):
- Detect / install Node (Homebrew on macOS; bundled or winget/installer on Windows).
- Write the MCP config into the right client file (claude_desktop_config.json, .cursor/mcp.json, Claude Code) WITH the `/bin/zsh -lc` PATH-stripping wrapper on macOS so bare `npx` doesn't silently fail.
- Optionally install/start the daemon (launchd on macOS; a service/Startup equivalent on Windows) and offer the HTTP-connector URL path.
- Prompt the user to fully quit + reopen the client.
- Optionally collect a Pro license key and drop it into ~/.decibel/config.yaml.

Targets: macOS + Windows. Form factor TBD — candidates: a signed .pkg/.dmg + .msi, a `npx @decibelsystems/tools setup` interactive wizard, or a Claude Desktop one-click .dxt extension. Goal is "one click, maybe two."
