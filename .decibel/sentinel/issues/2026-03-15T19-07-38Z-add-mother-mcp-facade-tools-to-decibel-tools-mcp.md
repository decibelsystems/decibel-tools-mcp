---
id: ISS-0098
projectId: decibel-tools-mcp
severity: high
status: open
created_at: 2026-03-15T19:07:38.498Z
---

# Add Mother MCP facade tools to decibel-tools-mcp

**Severity:** high
**Status:** open

## Details

## Context

The decibel-agent side of Mother 24/7 is complete (facade-router mappings, broadcast infra, transport hardening, 225 tests passing). However, the actual MCP tools that Mother calls don't exist yet in decibel-tools-mcp.

Without these, Mother's LLM reasoning has no way to write advice snapshots, propose policy patches, or publish incidents.

## Required Changes (decibel-tools-mcp repo)

### 1. Create `src/tools/mother.ts`

5 tools following the senken.ts pattern (lazy pg.Pool via `MOTHER_DATABASE_URL`):

| Tool | Type | DB Table | Description |
|------|------|----------|-------------|
| `mother_write_advice_snapshot` | WRITE | `mother_advice_snapshots` | Validate via `validateSnapshot()` logic, insert snapshot |
| `mother_propose_policy_patch` | WRITE | `mother_policy_patches` | Insert patch, auto-compute `revert_at` from TTL |
| `mother_publish_incident` | WRITE | `mother_incidents` | Insert incident with tags + reason_codes |
| `mother_get_advice_snapshot` | READ | `mother_advice_snapshots` | Latest non-expired snapshot for symbol×strategy |
| `mother_list_incidents` | READ | `mother_incidents` | Query by symbol/strategy/type/date range |

#### Validation for `write_advice_snapshot`:
- Verdict: `ALLOW` | `REDUCE` | `SKIP`
- Multiplier bounds: `confidence_mult` [0.0–1.2], `size_mult` [0.0–1.0], `exit_aggressiveness_mult` [0.7–1.3]
- `SKIP` verdict requires >= 2 `reason_codes`
- Reason codes from enum (15 values defined in `decibel-agent/packages/core/src/mother/types.ts`)

### 2. Register in `src/tools/index.ts`
- Import `motherTools` from `./mother.js`
- Add to `loadAppTools()` spread

### 3. Add facade definition in `src/facades/definitions.ts`
```
name: 'mother'
tier: 'apps'          // internal only, requires DECIBEL_APPS=1
microEligible: false
actions: [
  { action: 'write_advice_snapshot', tool: 'mother_write_advice_snapshot' },
  { action: 'propose_policy_patch', tool: 'mother_propose_policy_patch' },
  { action: 'publish_incident', tool: 'mother_publish_incident' },
  { action: 'get_advice_snapshot', tool: 'mother_get_advice_snapshot' },
  { action: 'list_incidents', tool: 'mother_list_incidents' },
]
```

## DB Tables (already exist)

Migration `20250124000005_mother_daemon.sql` created these tables with:
- RLS enabled
- CHECK constraints on verdict enum, multiplier bounds
- Auto-compute `expires_at` via trigger
- Indexes on (symbol, strategy, as_of DESC), (expires_at), (status), (incident_type), (created_at DESC)

## What's already done in decibel-agent

- `LEGACY_TOOL_MAP` entries for all 5 mother tools in `facade-router.ts`
- `TOOL_DESCRIPTIONS` with full inputSchema for LLM tool use
- `mother_*` added to AllowlistPolicy `globalAllow`
- `notifyChannels` broadcast infrastructure (daemon responses → Telegram/Discord)
- Mother app wired with `MOTHER_NOTIFY_CHANNELS` env var

## Env Vars

- `MOTHER_DATABASE_URL` — Postgres connection string for mother tables
- `DECIBEL_APPS=1` — enables apps-tier facades (mother, senken, deck, terminal)
