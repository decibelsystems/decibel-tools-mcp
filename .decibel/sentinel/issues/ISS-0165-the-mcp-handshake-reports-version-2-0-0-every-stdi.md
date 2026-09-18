---
uid: 01a07d19-ad7a-72d2-ab86-27de1a5ab725
id: ISS-0165
projectId: decibel-tools-mcp
severity: med
status: open
priority: medium
tags:
  - mcp
  - transports
  - version
  - misreporting
created_at: 2026-09-07T18:20:29.946Z
---
# The MCP handshake reports version 2.0.0 — every stdio client is told the wrong version

**Severity:** med
**Status:** open

## Details

SYMPTOM. Booting the packed 3.0.0 bundle and completing an MCP `initialize` returns:

    serverInfo -> @decibelsystems/tools 2.0.0

The package is 3.0.0. Found by booting the unzipped .mcpb rather than the source, during the 3.0 installer rebuild.

CAUSE. The version is a hardcoded string literal in two places, not read from package.json:

    src/transports/mcp.ts:26     { name: '@decibelsystems/tools', version: '2.0.0' }
    src/transports/bridge.ts:67  { name: '@decibelsystems/tools', version: '2.0.0' }

WHO SEES IT. Every stdio client — Claude Desktop, Claude Code, Cursor — because `serverInfo` is what the handshake returns. Claude Desktop surfaces it in the extension listing, so a user who installs the 3.0 bundle is shown 2.0.0.

WHY IT IS MORE THAN COSMETIC. 3.0 deliberately built version-skew detection: `/health` carries runtime version and protocol version so a client can refuse a mismatched runtime, and `ensureRuntime()` negotiates protocol at handshake. That machinery is on the HTTP side. On stdio, the one field a client would use to detect skew is a literal that has been wrong across at least one major version, so any skew check built against it compares against a constant. It also makes a support conversation ("what version are you running?") produce the wrong answer from the most obvious place to look.

FIX. Read the version from package.json once at module load and use it in both transports; assert in a test that `serverInfo.version` equals `package.json.version`, so the literal cannot drift back. Note this is exactly the shape S4 cannot see — every transport reports the same wrong version, so they agree with each other.

SECONDARY, LOW SEVERITY, SAME FAMILY. The startup banner prints `Environment: dev` on a production install. `config.env` reads `DECIBEL_ENV` (`src/config.ts:17`), which the installer manifest never sets, while the manifest sets `NODE_ENV=production`. It is NOT a tier hole — tier gating no longer keys off NODE_ENV (that fail-open is fixed and commented at `kernel.ts:71` and `tools/index.ts:47`), and `config.env === 'dev'` only gates whether `log()` writes to stderr (`src/config.ts:23-27`). Two consequences worth knowing: an operator reading "Environment: dev" on a user's machine would reasonably conclude gating is open when it is not, and every production Desktop install is running with debug logging on.
