# Agent Queue — Summary for Review

**Date:** 2026-03-30
**Status:** Implemented

---

## What This Solves

Remote agents (cloud Claude instances, mobile app, external integrations) couldn't create issues, log decisions, or track friction because all Decibel project data lives in local `.decibel/` files. If an agent doesn't have filesystem access, it's locked out of every write operation.

## How It Works

We added a **Supabase queue table** (`agent_queue`) that acts as a mailbox. When a remote agent wants to create an issue, log friction, or record an ADR, the call gets stored in the queue instead of executing locally. Next time someone opens a local session, the queue gets synced — each queued item is replayed through the normal tool pipeline, creating the same files and provenance events as if it happened locally.

**The flow:**

1. Remote agent calls `POST /call` with a write operation (e.g. create issue)
2. HTTP layer detects it's a queueable write from a remote agent
3. Instead of executing, it inserts into `agent_queue` in Supabase
4. Agent gets back `{ status: "queued", queue_id: "..." }`
5. On next local session, `agentic queue_sync` pulls unsynced items
6. Each item replays through the tool pipeline → local YAML files + provenance events
7. Queue row gets updated with the result

**Same pattern as Voice Inbox** — Supabase as a queue, `synced_at` column marks what's been processed, local files remain the source of truth.

## What Agents Can Now Do

| Action | Facade | Example |
|--------|--------|---------|
| Create issues | sentinel | Bug reports, feature requests |
| Log epics | sentinel | Track large initiatives |
| Create ADRs | architect | Record architecture decisions |
| Add wishes | dojo | Submit feature ideas |
| Create proposals | dojo | Propose new capabilities |
| Log friction | friction | Flag recurring pain points |
| Bump friction | friction | Increase priority on known issues |
| Record design decisions | designer | Track UI/UX choices |
| Submit feedback | feedback | Tool and process feedback |
| Emit provenance | provenance | Custom audit trail entries |

All operations go through the **same allowlist** — only approved write operations can be queued. Read operations (list, search, status) execute immediately as before.

## What's NOT Included

- **Full Supabase migration** — project data still lives in local files. This is just a queue.
- **Real-time sync** — items are synced on demand (session start or manual), not pushed.
- **Webhooks** — agents can poll for results via `queue_status`, but there's no callback mechanism yet.
- **Agent read access** — agents can write but can't query existing project data remotely.

## Security

- Explicit **allowlist** of which operations can be queued (no open-ended execution)
- Supabase **Row Level Security** — agents can only insert, not read/modify other entries
- Queue items validated against the allowlist again at sync time
- All synced items produce **provenance events** for audit trail

## How to Use

**Automatic:** Every session start runs `agentic queue_sync` alongside `voice_inbox_sync`.

**Manual:** Call `agentic queue_sync` with a project ID at any time.

**Check status:** Agents can call `agentic queue_status` with their queue ID to see if their item has been synced, and what the result was.

## Future Direction

This is a stepping stone to full Supabase migration. The queue table stays useful as an audit log even after individual modules move to direct Supabase read/write. Next steps would be:

1. Webhooks for real-time agent notification
2. Per-module migration (sentinel first, then others)
3. Agent read access via Supabase queries
