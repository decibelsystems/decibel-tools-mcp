---
id: ISS-0101
projectId: decibel-tools-mcp
severity: high
status: open
created_at: 2026-04-07T03:56:01.667Z
---

# Remove DECIBEL_PRO env var bypass from server-side tier gating

**Severity:** high
**Status:** open

## Details

## Problem

Setting `DECIBEL_PRO=1` bypasses the entire license validation system, even in production. This env var is checked in 6 places and grants pro tier without any license key.

## Affected Files

- `src/kernel.ts:54` — `PRO_ENABLED = process.env.DECIBEL_PRO === '1' || ...`
- `src/tools/index.ts:47` — same pattern, gates tool loading
- `src/httpServer.ts:465` — `resolveTier()` returns 'pro' if env var set
- `src/httpServer.ts:661` — health endpoint pro status
- `src/server.ts:50` — log line (cosmetic)
- `extension/src/proGate.ts:101` — extension bypass

## Required Changes

1. **Remove `DECIBEL_PRO === '1'` checks entirely** from all server-side code
2. **Keep `NODE_ENV !== 'production'`** as the legitimate dev-mode bypass
3. **Pass config license key into `createKernel()`** so stdio mode can resolve tier from `~/.decibel/config.yaml` at startup (currently kernel doesn't accept config)
4. **Extension**: replace env var check with `devMode` setting only

## Why This Matters

The license validator (Phase 8a) validates keys against Supabase with 24h cache and 72h offline grace. The env var completely sidesteps all of that — anyone who sets it gets pro for free, forever, with no validation.
