---
projectId: decibel-tools-mcp
severity: high
status: open
created_at: 2026-02-26T18:58:04.737Z
---

# Replace --private-key CLI arg with Foundry keystore in terminal facade

**Severity:** high
**Status:** open

## Details

`src/facades/terminal.ts` passes the wallet private key via `execSync` command strings using `--private-key ${key}`. Two security issues:

1. **Visible in `ps`** — any user on the machine can see the key in the process argument list while `cast` is running
2. **Leaks in error messages** — if `cast` fails, the full command (including the key) appears in the error string, which may reach the LLM via tool error output

### Solution: Foundry Keystore
Replace `--private-key` with `--account` + `--password-file`. The private key never appears in env vars, CLI args, or `ps`.

**Env vars (replaces DX_TERMINAL_PRIVATE_KEY):**
```
DX_WALLET_ACCOUNT=dx-tournament
DX_WALLET_PASSWORD_FILE=~/.decibel/dx-tournament.pass
```

### Changes Required

1. **`src/facades/terminal.ts`** — all `cast send` / `cast call` invocations:
   - Replace: `--private-key "${process.env.DX_TERMINAL_PRIVATE_KEY}"`
   - With: `--account "${process.env.DX_WALLET_ACCOUNT}" --password-file "${process.env.DX_WALLET_PASSWORD_FILE}"`
   - Keep `--private-key` as fallback if `DX_WALLET_ACCOUNT` is not set (backward compat)

2. **`src/transports/stdio.ts`** — ensure `DX_TERMINAL_PRIVATE_KEY` is NOT in subprocess env. Only `DX_WALLET_ACCOUNT` and `DX_WALLET_PASSWORD_FILE` should be forwarded.

3. **Error handling** — `execSync` catch blocks must NOT include the full command string in thrown errors (it may contain the key). Use `cast command failed: ${stderr}` instead.

### Context
`decibel-agent` already has defense-in-depth: `redactSecrets()` strips keys from tool output, `<system-provenance>` tells the LLM to never disclose keys, persona has explicit constraints, startup validates wallet env. But the key should never reach the agent in the first place — fix at source.

### Acceptance Criteria
- `cast send` uses `--account` + `--password-file` when `DX_WALLET_ACCOUNT` is set
- Falls back to `--private-key` only if `DX_WALLET_ACCOUNT` is not set
- Private key never appears in `execSync` command strings in keystore mode
- Error messages from `cast` failures do not include the private key
- `DX_TERMINAL_PRIVATE_KEY` not passed to subprocess env in keystore mode
- Existing tests pass, new tests cover both auth paths
