# Agent Queue: Supabase Write Queue for Remote Agents

**Date**: 2026-03-30
**Status**: Approved
**Author**: Claude + Brett

## Problem

Remote agents (cloud Claude instances, mobile app, external integrations) cannot write to local `.decibel/` project data. The entire Decibel tool system assumes local filesystem access — sentinel issues, ADRs, friction logs, etc. are all YAML files on disk. This blocks agents from doing useful work like logging issues or recording decisions.

## Solution

A generic Supabase queue table (`agent_queue`) that stores tool calls from remote agents. A local sync tool replays queued items through the existing tool functions, writing to `.decibel/` as if the call happened locally. Same pattern as `voice_inbox_sync`.

## Non-Goals

- Full Supabase migration of all project data (future work)
- Real-time sync / webhooks (future work)
- Agent read access to local data (separate concern)

---

## Architecture

```
Remote Agent                    Supabase                     Local Machine
─────────────                   ────────                     ─────────────
POST /call ──────┐
  (write op)     │
                 ▼
            Queue detection
            in httpServer.ts
                 │
                 ▼
         INSERT agent_queue ───► agent_queue table
                 │                    │
                 ▼                    │
         Return {status:"queued"}     │
                                      │
                              agent_queue_sync
                              (session start or manual)
                                      │
                                      ▼
                              SELECT unsynced rows
                                      │
                                      ▼
                              Replay each through
                              tool function directly
                                      │
                              ┌───────┴───────┐
                              ▼               ▼
                        .decibel/ YAML    provenance event
                              │               │
                              ▼               ▼
                        UPDATE agent_queue
                        SET synced_at, sync_result,
                            provenance_ref
```

---

## 1. Supabase Table: `agent_queue`

```sql
create table agent_queue (
  id              uuid primary key default gen_random_uuid(),
  project_id      text not null,
  facade          text not null,
  action          text not null,
  arguments       jsonb not null default '{}',
  created_by      text not null,
  created_at      timestamptz not null default now(),
  synced_at       timestamptz,
  sync_result     jsonb,
  sync_error      text,
  provenance_ref  text
);

create index idx_agent_queue_unsynced on agent_queue (project_id, synced_at) where synced_at is null;
create index idx_agent_queue_project  on agent_queue (project_id, created_at);
```

| Column | Purpose |
|--------|---------|
| `facade` | Module name: sentinel, friction, architect, etc. |
| `action` | Tool action: create_issue, log, create_adr, etc. |
| `arguments` | Exact args passed to the tool function |
| `created_by` | Agent ID, 'mobile:ios', 'api:webhook', etc. |
| `synced_at` | NULL until replayed locally (same pattern as voice_inbox) |
| `sync_result` | JSON result from tool execution after sync |
| `sync_error` | Denormalized error string for easy filtering |
| `provenance_ref` | PROV-* event ID created during sync replay |

### RLS Policy

- Service key: full access (used by sync tool)
- Anon key: INSERT only, scoped to project_id (used by remote agents)

---

## 2. Sync Tool: `agent_queue_sync`

Lives on the `agentic` facade (pro tier).

### Input

```typescript
interface AgentQueueSyncInput {
  projectId?: string;
  limit?: number;          // default 50
  facadeFilter?: string;   // optional: sync only one module
}
```

### Behavior

1. Query Supabase for unsynced rows, ordered by `created_at ASC`
2. For each row, **sequentially** (ordering matters for linked items):
   - Map `facade` + `action` to internal tool function
   - Call the tool function directly (same process, no HTTP overhead)
   - Capture result or error
   - Extract `provenance_ref` from emitted provenance event
   - Update row: `synced_at`, `sync_result`, `provenance_ref`, `sync_error`
3. Return summary

### Output

```typescript
interface AgentQueueSyncOutput {
  synced: number;
  failed: number;
  items: Array<{
    queue_id: string;
    facade: string;
    action: string;
    status: 'synced' | 'error';
    result?: unknown;
    error?: string;
    provenance_ref?: string;
  }>;
}
```

### Key Decisions

- **Sequential, not parallel**: Preserves ordering (epic created before linked issue)
- **Failures don't block**: Each item independent, errors recorded per-row
- **Direct function call**: No HTTP/kernel overhead, same as voice_inbox_sync

---

## 3. Queueable Action Allowlist

Explicit allowlist of which facade+action pairs can be queued. Prevents accidental queuing of read operations.

```typescript
const QUEUEABLE_ACTIONS: Record<string, string[]> = {
  sentinel:  ['create_issue', 'log_epic'],
  architect: ['create_adr'],
  dojo:      ['add_wish', 'create_proposal'],
  friction:  ['log', 'bump'],
  designer:  ['record_design_decision'],
  feedback:  ['submit'],
  provenance: ['emit'],
};
```

Exported from a shared config so both the HTTP layer and sync tool reference the same list.

---

## 4. HTTP Write Detection

In `httpServer.ts`, when a `POST /call` arrives from a remote agent:

1. Parse `facade` and `action` from the tool name
2. Check if `facade+action` is in `QUEUEABLE_ACTIONS`
3. If yes AND caller is remote (has `X-Agent-Id` header):
   - Insert into `agent_queue` via Supabase
   - Return `{ status: "queued", queue_id: "uuid" }`
4. If no, execute normally through kernel dispatch

### Envelope

Queued responses use a new status:

```json
{
  "status": "queued",
  "queue_id": "550e8400-e29b-41d4-a716-446655440000",
  "message": "Queued for local sync. Use agentic_queue_status to check result."
}
```

---

## 5. Result Polling: `agent_queue_status`

Lives on the `agentic` facade (pro tier). Lets agents check if their queued item has been synced.

### Input

```typescript
interface AgentQueueStatusInput {
  queueId: string;
}
```

### Output

```json
// Pending
{ "status": "pending", "position": 3, "created_at": "2026-03-30T11:55:00Z" }

// Synced
{ "status": "synced", "sync_result": { "id": "ISS-0042" }, "provenance_ref": "PROV-...", "synced_at": "..." }

// Failed
{ "status": "error", "sync_error": "Missing required field: severity", "synced_at": "..." }
```

---

## 6. Agent Write Paths

### Path 1: HTTP Transport (remote agents)

```
POST /call
Headers: X-Agent-Id: agent-abc123, Authorization: Bearer <token>
Body: { "tool": "sentinel_create_issue", "arguments": { ... } }

Response: { "status": "queued", "queue_id": "..." }
```

### Path 2: Direct Supabase Insert (mobile, external)

```typescript
supabase.from('agent_queue').insert({
  project_id: 'decibel-tools-mcp',
  facade: 'sentinel',
  action: 'create_issue',
  arguments: { severity: 'high', title: '...', details: '...' },
  created_by: 'mobile:ios'
});
```

---

## 7. Session Start Integration

Add to CLAUDE.md voice inbox protocol section:

```
agent_queue_sync with project_id: "decibel-tools-mcp"
```

Runs automatically at session start alongside `voice_inbox_sync`.

---

## File Touchpoints

| File | Change |
|------|--------|
| Supabase | New `agent_queue` table + RLS + indexes |
| `src/tools/agentic.ts` | New `agent_queue_sync` and `agent_queue_status` actions |
| `src/config/queueableActions.ts` | New file: shared allowlist |
| `src/httpServer.ts` | Queue detection in `POST /call` handler |
| `CLAUDE.md` | Add `agent_queue_sync` to session start protocol |

---

## Future Work

- **Webhooks**: Agent registers callback URL, gets POSTed on sync completion
- **Full Supabase migration**: Replace queue+sync with direct read/write per module
- **Agent read access**: Query project data without local filesystem
- **Batch queue**: Submit multiple actions in one request
