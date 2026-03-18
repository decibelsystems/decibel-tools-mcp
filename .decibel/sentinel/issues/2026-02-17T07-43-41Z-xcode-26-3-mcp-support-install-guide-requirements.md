---
projectId: decibel-tools-mcp
severity: low
status: open
created_at: 2026-02-17T07:43:41.005Z
epic_id: EPIC-0026
---

# Xcode 26.3 MCP Support — Install Guide & Requirements

**Severity:** low
**Status:** open
**Epic:** EPIC-0026

## Details

Decibel Tools works with Xcode 26.3+ via stdio transport — zero code changes needed.

Requirements:
- macOS Tahoe (macOS 26) — Intelligence tab does not appear on Sequoia
- Apple Silicon (Intel Macs cannot enable Apple Intelligence)
- Xcode 26.3+ (MCP support not in 26.2)
- Node.js installed

Install Path:
1. brew install node
2. Xcode Settings Intelligence Enable MCP
3. Add config to ~/Library/Developer/Xcode/CodingAssistant/ClaudeAgentConfig/.claude with mcpServers pointing to /opt/homebrew/bin/npx -y @decibelsystems/tools
4. Intel Macs use /usr/local/bin/npx instead
5. In agent chat: Initialize this project with Decibel Tools

npm Package:
- Published as @decibelsystems/tools v2.0.1
- Old package decibel-tools-mcp v1.1.4 is stale

Known Issues:
- Xcode sandbox does not inherit shell config — must use absolute path to npx
- Xcode 26.3 RC had damaged app issues — may need sudo xattr or re-extract via terminal
- Intelligence tab requires macOS Tahoe not just Xcode 26.3
