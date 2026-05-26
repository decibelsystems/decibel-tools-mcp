---
projectId: decibel-tools-mcp
severity: high
status: open
created_at: 2026-04-29T04:31:27.431Z
---

# Tier gating leaks pro+apps facades when NODE_ENV unset (blocks npm publish)

**Severity:** high
**Status:** open

## Details

In src/kernel.ts:55-56:

```ts
const PRO_ENABLED = process.env.DECIBEL_PRO === '1' || process.env.NODE_ENV !== 'production';
const APPS_ENABLED = process.env.DECIBEL_APPS === '1' || process.env.NODE_ENV !== 'production';
```

In a default user install of @decibelsystems/tools, NODE_ENV is typically unset. `undefined !== 'production'` evaluates to true, so pro AND apps facades both auto-enable — exposing deck, mother, senken, terminal, agentic, corpus, studio, voice (all 8 non-core facades) to every user.

## Fix

```ts
const PRO_ENABLED = process.env.DECIBEL_PRO === '1';
const APPS_ENABLED = process.env.DECIBEL_APPS === '1';
```

Closed by default, opt-in only. Local dev sets DECIBEL_PRO=1 DECIBEL_APPS=1 in shell/.envrc — minor friction.

## Blocks

Do not bump version + npm publish until this lands. Currently on @decibelsystems/tools@2.1.2 with all 33 facades exposed by default.
