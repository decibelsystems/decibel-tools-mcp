---
id: ISS-0123
projectId: decibel-tools-mcp
severity: high
status: open
created_at: 2026-08-14T19:25:00.513Z
epic_id: EPIC-0036
---

# Keep the zoom facade local/stdio-only until hosted MCP auth is fixed

**Severity:** high
**Status:** open
**Epic:** EPIC-0036

## Details

The zoom facade holds an account-wide admin-scoped Zoom credential (meeting_summary:read:admin reads every meeting in the account). Exposing a sync/list/read action on an unauthenticated hosted daemon means anyone who can reach it pulls all company and client meeting summaries.

This is not hypothetical. senken.pro runs this repo as a submodule and serves /call, /batch and /tools unauthenticated. There is an open CRITICAL issue on exactly this: "Hosted MCP runs unauthenticated + queueForAgent service-role write with spoofable caller ids" (2026-06-04T23-51-33Z), plus the related high issue "Hosted (--http) mode serves /call,/connect,/batch,/events unauthenticated — make it fail closed" (2026-06-07T18-52-35Z).

ACTION: gate the zoom facade so it is unavailable over the HTTP transport until those are closed. Do not rely on tier gating alone — ISS-0101 (DECIBEL_PRO env var bypass) and the open issue on tier gating leaking pro+apps facades when NODE_ENV is unset both mean pro-tier is not currently a trustworthy boundary.

Blocks the sync/sync_all work from being considered shippable beyond a local stdio setup.
