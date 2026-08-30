---
uid: 019f70ed-1730-76cd-a2d4-a23102c8de27
id: ISS-0115
projectId: decibel-tools-mcp
severity: med
status: open
created_at: 2026-07-17T16:33:34.000Z
---

# One-click Mac/PC installer for Decibel tools (non-technical onboarding)

**Severity:** med
**Status:** open

## Details

TODO/feature: a one-click (max two-click) installer flow so non-technical users can set up Decibel tools without live hand-holding. Directly addresses the onboarding friction logged 2026-06-24 (`.decibel/friction/2026-06-24T20-43-06Z-setting-up-decibel-tools-in-claude-desktop-for-a-l.md`) — the angela setup required a technical person walking through every step.

What it should automate (the manual chain we hit):
- Detect / install Node (Homebrew on macOS; bundled or winget/installer on Windows).
- Write the MCP config into the right client file (claude_desktop_config.json, .cursor/mcp.json, Claude Code) WITH the `/bin/zsh -lc` PATH-stripping wrapper on macOS so bare `npx` doesn't silently fail.
- Optionally install/start the daemon (launchd on macOS; a service/Startup equivalent on Windows) and offer the HTTP-connector URL path.
- Prompt the user to fully quit + reopen the client.
- Optionally collect a Pro license key and drop it into ~/.decibel/config.yaml.

Targets: macOS + Windows. Form factor TBD — candidates: a signed .pkg/.dmg + .msi, a `npx @decibelsystems/tools setup` interactive wizard, or a Claude Desktop one-click .dxt extension. Goal is "one click, maybe two."

Provenance: originally filed 2026-06-25 as ISS-0112 in the secondary checkout at /Volumes/Kiki/GitHub/decibel-tools-mcp; that ID was independently assigned to a different issue in this checkout, so re-filed here as ISS-0115 before retiring the Kiki copy.
