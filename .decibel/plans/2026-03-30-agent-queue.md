# Agent Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable remote agents to queue write operations via Supabase, synced locally on demand.

**Architecture:** Generic `agent_queue` Supabase table stores any facade write call. A sync tool on the `agentic` facade replays queued items through existing tool functions. The HTTP transport auto-queues write calls from remote agents instead of executing them locally.

**Tech Stack:** TypeScript, Supabase (PostgREST), existing MCP kernel + facade system

**Spec:** `.decibel/specs/2026-03-30-agent-queue-design.md`

---

### Task 1: Supabase Migration — `agent_queue` Table

**Files:**
- Create: `supabase/migrations/20260330_agent_queue.sql`

This task creates the Supabase table. Apply via Supabase dashboard or CLI.

- [ ] **Step 1: Write the migration SQL**

```sql
-- supabase/migrations/20260330_agent_queue.sql

-- Agent write queue: stores tool calls from remote agents for local sync
create table if not exists agent_queue (
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

-- Fast lookup for unsynced items per project
create index if not exists idx_agent_queue_unsynced
  on agent_queue (project_id, created_at)
  where synced_at is null;

-- General project timeline queries
create index if not exists idx_agent_queue_project
  on agent_queue (project_id, created_at);

-- RLS: service key gets full access, anon key can only INSERT
alter table agent_queue enable row level security;

create policy "Service key full access"
  on agent_queue for all
  using (true)
  with check (true);

create policy "Anon insert only"
  on agent_queue for insert
  to anon
  with check (true);

create policy "Anon select own"
  on agent_queue for select
  to anon
  using (true);
```

- [ ] **Step 2: Apply migration**

Run via Supabase MCP tool:

```
mcp__supabase__apply_migration with name: "agent_queue" and query: <the SQL above>
```

Or apply via dashboard SQL editor.

- [ ] **Step 3: Verify table exists**

```
mcp__supabase__execute_sql with query: "select column_name, data_type from information_schema.columns where table_name = 'agent_queue' order by ordinal_position;"
```

Expected: 11 columns matching the schema above.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260330_agent_queue.sql
git commit -m "feat: add agent_queue Supabase migration"
```

---

### Task 2: Queueable Actions Allowlist

**Files:**
- Create: `src/config/queueableActions.ts`
- Test: `src/__tests__/queueableActions.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/__tests__/queueableActions.test.ts
import { describe, it, expect } from 'vitest';
import { QUEUEABLE_ACTIONS, isQueueable } from '../config/queueableActions.js';

describe('queueableActions', () => {
  it('allows sentinel create_issue', () => {
    expect(isQueueable('sentinel', 'create_issue')).toBe(true);
  });

  it('allows friction log', () => {
    expect(isQueueable('friction', 'log')).toBe(true);
  });

  it('rejects unknown facade', () => {
    expect(isQueueable('oracle', 'next_actions')).toBe(false);
  });

  it('rejects read-only action on known facade', () => {
    expect(isQueueable('sentinel', 'list_issues')).toBe(false);
  });

  it('exports a record of all queueable facades', () => {
    expect(Object.keys(QUEUEABLE_ACTIONS)).toContain('sentinel');
    expect(Object.keys(QUEUEABLE_ACTIONS)).toContain('architect');
    expect(Object.keys(QUEUEABLE_ACTIONS)).toContain('dojo');
    expect(Object.keys(QUEUEABLE_ACTIONS)).toContain('friction');
    expect(Object.keys(QUEUEABLE_ACTIONS)).toContain('designer');
    expect(Object.keys(QUEUEABLE_ACTIONS)).toContain('feedback');
    expect(Object.keys(QUEUEABLE_ACTIONS)).toContain('provenance');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/queueableActions.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
// src/config/queueableActions.ts

/**
 * Allowlist of facade+action pairs that remote agents can queue.
 * Only write operations should be listed here.
 * Both httpServer.ts (queue detection) and agent_queue_sync (replay) use this.
 */
export const QUEUEABLE_ACTIONS: Record<string, string[]> = {
  sentinel:   ['create_issue', 'log_epic'],
  architect:  ['create_adr'],
  dojo:       ['add_wish', 'create_proposal'],
  friction:   ['log', 'bump'],
  designer:   ['record_design_decision'],
  feedback:   ['submit'],
  provenance: ['emit'],
};

/**
 * Check if a facade+action pair is queueable by remote agents.
 */
export function isQueueable(facade: string, action: string): boolean {
  const actions = QUEUEABLE_ACTIONS[facade];
  return !!actions && actions.includes(action);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/queueableActions.test.ts`
Expected: PASS — all 5 tests green

- [ ] **Step 5: Commit**

```bash
git add src/config/queueableActions.ts src/__tests__/queueableActions.test.ts
git commit -m "feat: add queueable actions allowlist for agent queue"
```

---

### Task 3: Agent Queue Sync Tool

**Files:**
- Create: `src/tools/agentic/agentQueue.ts`
- Modify: `src/tools/agentic/index.ts` (add to exports)
- Test: `src/__tests__/agentQueue.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/__tests__/agentQueue.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Supabase before importing
vi.mock('../lib/supabase.js', () => ({
  isSupabaseConfigured: vi.fn(() => true),
  getSupabaseServiceClient: vi.fn(() => mockSupabase),
}));

// Mock kernel for replay
vi.mock('../kernel.js', () => ({
  default: {
    dispatch: vi.fn(),
  },
}));

const mockSupabase = {
  from: vi.fn(),
};

import { agentQueueSync, agentQueueStatus } from '../tools/agentic/agentQueue.js';
import kernel from '../kernel.js';

describe('agentQueueSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns zero counts when no unsynced items', async () => {
    const selectChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    mockSupabase.from.mockReturnValue(selectChain);

    const result = await agentQueueSync({ projectId: 'test-project' });

    expect(result.synced).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.items).toEqual([]);
  });

  it('replays queued items through kernel dispatch', async () => {
    const queuedItem = {
      id: 'uuid-1',
      project_id: 'test-project',
      facade: 'sentinel',
      action: 'create_issue',
      arguments: { severity: 'high', title: 'Test issue', details: 'From agent' },
      created_by: 'agent:test',
      created_at: '2026-03-30T12:00:00Z',
    };

    // SELECT returns one queued item
    const selectChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [queuedItem], error: null }),
    };
    mockSupabase.from.mockReturnValueOnce(selectChain);

    // kernel.dispatch returns success
    (kernel.dispatch as any).mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ id: 'ISS-0042', status: 'open' }) }],
      isError: false,
    });

    // UPDATE after sync
    const updateChain = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: null }),
    };
    mockSupabase.from.mockReturnValueOnce(updateChain);

    const result = await agentQueueSync({ projectId: 'test-project' });

    expect(result.synced).toBe(1);
    expect(result.items[0].status).toBe('synced');
    expect(kernel.dispatch).toHaveBeenCalledWith(
      'sentinel',
      { action: 'create_issue', severity: 'high', title: 'Test issue', details: 'From agent' },
      undefined
    );
  });

  it('records errors without blocking other items', async () => {
    const items = [
      { id: 'uuid-1', project_id: 'tp', facade: 'sentinel', action: 'create_issue', arguments: { severity: 'high', title: 'Good' , details: 'ok' }, created_by: 'agent:test', created_at: '2026-03-30T12:00:00Z' },
      { id: 'uuid-2', project_id: 'tp', facade: 'sentinel', action: 'create_issue', arguments: { title: 'Bad' }, created_by: 'agent:test', created_at: '2026-03-30T12:01:00Z' },
    ];

    const selectChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: items, error: null }),
    };
    mockSupabase.from.mockReturnValueOnce(selectChain);

    // First succeeds, second fails
    (kernel.dispatch as any)
      .mockResolvedValueOnce({ content: [{ type: 'text', text: '{"id":"ISS-0042"}' }], isError: false })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: '{"error":"Missing severity"}' }], isError: true });

    // Two UPDATE calls
    const updateChain = { update: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ error: null }) };
    mockSupabase.from.mockReturnValue(updateChain);

    const result = await agentQueueSync({ projectId: 'tp' });

    expect(result.synced).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.items[0].status).toBe('synced');
    expect(result.items[1].status).toBe('error');
  });

  it('throws when Supabase is not configured', async () => {
    const { isSupabaseConfigured } = await import('../lib/supabase.js');
    (isSupabaseConfigured as any).mockReturnValueOnce(false);

    await expect(agentQueueSync({ projectId: 'test' }))
      .rejects.toThrow('Supabase is not configured');
  });
});

describe('agentQueueStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns pending status for unsynced item', async () => {
    const selectChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({
        data: [{ id: 'uuid-1', synced_at: null, created_at: '2026-03-30T12:00:00Z' }],
        error: null,
      }),
    };
    mockSupabase.from.mockReturnValue(selectChain);

    const result = await agentQueueStatus({ queueId: 'uuid-1' });
    expect(result.status).toBe('pending');
  });

  it('returns synced status with result', async () => {
    const selectChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({
        data: [{
          id: 'uuid-1',
          synced_at: '2026-03-30T12:05:00Z',
          sync_result: { id: 'ISS-0042' },
          sync_error: null,
          provenance_ref: 'PROV-20260330T120500-123',
        }],
        error: null,
      }),
    };
    mockSupabase.from.mockReturnValue(selectChain);

    const result = await agentQueueStatus({ queueId: 'uuid-1' });
    expect(result.status).toBe('synced');
    expect(result.sync_result).toEqual({ id: 'ISS-0042' });
    expect(result.provenance_ref).toBe('PROV-20260330T120500-123');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/agentQueue.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the agentQueue implementation**

```typescript
// src/tools/agentic/agentQueue.ts

import { isSupabaseConfigured, getSupabaseServiceClient } from '../../lib/supabase.js';
import { isQueueable } from '../../config/queueableActions.js';
import kernel from '../../kernel.js';
import { log } from '../../config.js';

// ============================================================================
// Types
// ============================================================================

export interface AgentQueueSyncInput {
  projectId?: string;
  limit?: number;
  facadeFilter?: string;
}

export interface AgentQueueSyncOutput {
  synced: number;
  failed: number;
  items: AgentQueueSyncItem[];
}

interface AgentQueueSyncItem {
  queue_id: string;
  facade: string;
  action: string;
  status: 'synced' | 'error';
  result?: unknown;
  error?: string;
  provenance_ref?: string;
}

export interface AgentQueueStatusInput {
  queueId: string;
}

export interface AgentQueueStatusOutput {
  status: 'pending' | 'synced' | 'error' | 'not_found';
  position?: number;
  created_at?: string;
  synced_at?: string;
  sync_result?: unknown;
  sync_error?: string;
  provenance_ref?: string;
}

interface QueueRow {
  id: string;
  project_id: string;
  facade: string;
  action: string;
  arguments: Record<string, unknown>;
  created_by: string;
  created_at: string;
  synced_at: string | null;
  sync_result: unknown;
  sync_error: string | null;
  provenance_ref: string | null;
}

// ============================================================================
// agent_queue_sync
// ============================================================================

export async function agentQueueSync(input: AgentQueueSyncInput): Promise<AgentQueueSyncOutput> {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_KEY.');
  }

  const supabase = getSupabaseServiceClient();
  const limit = input.limit || 50;

  // 1. Fetch unsynced items
  let query = supabase
    .from('agent_queue')
    .select('*')
    .eq('project_id', input.projectId)
    .is('synced_at', null)
    .order('created_at', { ascending: true })
    .limit(limit);

  if (input.facadeFilter) {
    query = query.eq('facade', input.facadeFilter);
  }

  const { data: rows, error: queryError } = await query;
  if (queryError) {
    throw new Error(`Failed to query agent_queue: ${queryError.message}`);
  }

  if (!rows || rows.length === 0) {
    return { synced: 0, failed: 0, items: [] };
  }

  // 2. Replay each item sequentially through kernel dispatch
  const items: AgentQueueSyncItem[] = [];

  for (const row of rows as QueueRow[]) {
    // Validate this is still a queueable action
    if (!isQueueable(row.facade, row.action)) {
      log(`[agent-queue] Skipping non-queueable action: ${row.facade}.${row.action}`);
      const item: AgentQueueSyncItem = {
        queue_id: row.id,
        facade: row.facade,
        action: row.action,
        status: 'error',
        error: `Action ${row.facade}.${row.action} is not in the queueable allowlist`,
      };
      items.push(item);
      await updateQueueRow(supabase, row.id, null, item.error, null);
      continue;
    }

    try {
      // Dispatch through kernel — same path as a local tool call
      const toolResult = await kernel.dispatch(
        row.facade,
        { action: row.action, ...row.arguments },
        undefined  // No dispatch context — this runs as local user
      );

      // Parse result
      const text = toolResult.content?.[0]?.text;
      let parsed: unknown;
      try {
        parsed = text ? JSON.parse(text) : { success: true };
      } catch {
        parsed = { message: text };
      }

      // Extract provenance_ref if present in result
      const provRef = extractProvenanceRef(text);

      if (toolResult.isError) {
        items.push({
          queue_id: row.id,
          facade: row.facade,
          action: row.action,
          status: 'error',
          error: text || 'Tool execution failed',
        });
        await updateQueueRow(supabase, row.id, parsed, text || 'Tool execution failed', null);
      } else {
        items.push({
          queue_id: row.id,
          facade: row.facade,
          action: row.action,
          status: 'synced',
          result: parsed,
          provenance_ref: provRef || undefined,
        });
        await updateQueueRow(supabase, row.id, parsed, null, provRef);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      items.push({
        queue_id: row.id,
        facade: row.facade,
        action: row.action,
        status: 'error',
        error: errMsg,
      });
      await updateQueueRow(supabase, row.id, null, errMsg, null);
    }
  }

  return {
    synced: items.filter(i => i.status === 'synced').length,
    failed: items.filter(i => i.status === 'error').length,
    items,
  };
}

// ============================================================================
// agent_queue_status
// ============================================================================

export async function agentQueueStatus(input: AgentQueueStatusInput): Promise<AgentQueueStatusOutput> {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_KEY.');
  }

  const supabase = getSupabaseServiceClient();

  const { data, error } = await supabase
    .from('agent_queue')
    .select('*')
    .eq('id', input.queueId);

  if (error) {
    throw new Error(`Failed to query agent_queue: ${error.message}`);
  }

  if (!data || data.length === 0) {
    return { status: 'not_found' };
  }

  const row = data[0] as QueueRow;

  if (!row.synced_at) {
    return {
      status: 'pending',
      created_at: row.created_at,
    };
  }

  if (row.sync_error) {
    return {
      status: 'error',
      synced_at: row.synced_at,
      sync_error: row.sync_error,
    };
  }

  return {
    status: 'synced',
    synced_at: row.synced_at,
    sync_result: row.sync_result,
    provenance_ref: row.provenance_ref || undefined,
  };
}

// ============================================================================
// Helpers
// ============================================================================

async function updateQueueRow(
  supabase: ReturnType<typeof getSupabaseServiceClient>,
  id: string,
  syncResult: unknown,
  syncError: string | null,
  provenanceRef: string | null,
): Promise<void> {
  const { error } = await supabase
    .from('agent_queue')
    .update({
      synced_at: new Date().toISOString(),
      sync_result: syncResult,
      sync_error: syncError,
      provenance_ref: provenanceRef,
    })
    .eq('id', id);

  if (error) {
    log(`[agent-queue] Warning: failed to update queue row ${id}: ${error.message}`);
  }
}

/**
 * Try to extract a PROV-* event ID from a tool result string.
 * Provenance is emitted inside tool handlers — the event ID sometimes
 * appears in the result JSON.
 */
function extractProvenanceRef(text: string | undefined): string | null {
  if (!text) return null;
  const match = text.match(/PROV-\d{8}T\d{6}-\d+/);
  return match ? match[0] : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/agentQueue.test.ts`
Expected: PASS — all tests green

- [ ] **Step 5: Commit**

```bash
git add src/tools/agentic/agentQueue.ts src/__tests__/agentQueue.test.ts
git commit -m "feat: add agent queue sync and status functions"
```

---

### Task 4: Register Queue Tools on Agentic Facade

**Files:**
- Modify: `src/tools/agentic/index.ts` (add tool specs + exports)
- Modify: `src/facades/definitions.ts` (add actions to agentic facade)

- [ ] **Step 1: Add ToolSpec wrappers to `src/tools/agentic/index.ts`**

Add these imports at the top of the file:

```typescript
import {
  agentQueueSync,
  agentQueueStatus,
  AgentQueueSyncInput,
  AgentQueueStatusInput,
} from './agentQueue.js';
```

Add these tool specs before the final export:

```typescript
// ============================================================================
// Agent Queue Sync Tool
// ============================================================================

export const agenticQueueSyncTool: ToolSpec = {
  definition: {
    name: 'agentic_queue_sync',
    description: 'Sync queued agent writes from Supabase to local .decibel/ files. Replays each queued tool call through the kernel, records results and provenance.',
    annotations: {
      title: 'Sync Agent Queue',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project identifier. Uses default project if not specified.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of queued items to sync (default: 50)',
        },
        facadeFilter: {
          type: 'string',
          description: 'Only sync items for this facade (e.g. "sentinel", "friction")',
        },
      },
      required: [],
    },
  },
  handler: async (args) => {
    try {
      const input = args as AgentQueueSyncInput;
      const result = await agentQueueSync(input);
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// Agent Queue Status Tool
// ============================================================================

export const agenticQueueStatusTool: ToolSpec = {
  definition: {
    name: 'agentic_queue_status',
    description: 'Check the status of a queued agent write. Returns pending, synced (with result), or error.',
    annotations: {
      title: 'Check Queue Status',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        queueId: {
          type: 'string',
          description: 'The UUID of the queued item (returned when the item was queued)',
        },
      },
      required: ['queueId'],
    },
  },
  handler: async (args) => {
    try {
      const input = args as AgentQueueStatusInput;
      if (!input.queueId) {
        return toolError('Missing required field: queueId');
      }
      const result = await agentQueueStatus(input);
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};
```

Update the final export array:

```typescript
export const agenticTools: ToolSpec[] = [
  agenticCompilePackTool,
  agenticRenderTool,
  agenticLintTool,
  agenticGoldenEvalTool,
  agenticQueueSyncTool,
  agenticQueueStatusTool,
];
```

- [ ] **Step 2: Add actions to agentic facade in `src/facades/definitions.ts`**

Find the agentic facade definition (around line 460) and add the two new actions:

```typescript
  {
    name: 'agentic',
    description: 'Agentic operations: render, lint, compile, evaluation, queue sync. render to produce human-readable output from structured data; lint for code quality checks; compile_pack to bundle context for another agent; golden_eval to test agent output against known-good examples; queue_sync to replay remote agent writes locally; queue_status to check queued write results. Actions: render, lint, compile_pack, golden_eval, queue_sync, queue_status',
    compactDescription: 'Render, lint, compile, evaluate, queue sync',
    microEligible: false,
    tier: 'pro',
    actions: {
      render: 'agentic_render',
      lint: 'agentic_lint',
      compile_pack: 'agentic_compile_pack',
      golden_eval: 'agentic_golden_eval',
      queue_sync: 'agentic_queue_sync',
      queue_status: 'agentic_queue_status',
    },
  },
```

- [ ] **Step 3: Build and verify**

Run: `npm run build`
Expected: Clean compilation, no errors

- [ ] **Step 4: Commit**

```bash
git add src/tools/agentic/index.ts src/facades/definitions.ts
git commit -m "feat: register queue_sync and queue_status on agentic facade"
```

---

### Task 5: HTTP Write Detection — Queue Instead of Execute

**Files:**
- Modify: `src/httpServer.ts` (intercept write calls from remote agents)
- Test: `src/__tests__/httpQueueDetection.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/__tests__/httpQueueDetection.test.ts
import { describe, it, expect } from 'vitest';
import { shouldQueueForAgent, parseToolCall } from '../httpQueueDetection.js';

describe('parseToolCall', () => {
  it('parses facade-style tool name', () => {
    const result = parseToolCall('sentinel', { action: 'create_issue', severity: 'high' });
    expect(result).toEqual({ facade: 'sentinel', action: 'create_issue' });
  });

  it('parses underscore-style tool name', () => {
    const result = parseToolCall('sentinel_create_issue', {});
    expect(result).toEqual({ facade: 'sentinel', action: 'create_issue' });
  });

  it('returns null for unparseable tool name', () => {
    const result = parseToolCall('unknown', {});
    expect(result).toBeNull();
  });
});

describe('shouldQueueForAgent', () => {
  it('returns true for queueable action from remote agent', () => {
    expect(shouldQueueForAgent('sentinel', { action: 'create_issue' }, 'agent:test')).toBe(true);
  });

  it('returns false when no agent ID', () => {
    expect(shouldQueueForAgent('sentinel', { action: 'create_issue' }, undefined)).toBe(false);
  });

  it('returns false for non-queueable action', () => {
    expect(shouldQueueForAgent('oracle', { action: 'next_actions' }, 'agent:test')).toBe(false);
  });

  it('returns false for read action on queueable facade', () => {
    expect(shouldQueueForAgent('sentinel', { action: 'list_issues' }, 'agent:test')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/httpQueueDetection.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the queue detection helper**

```typescript
// src/httpQueueDetection.ts

import { isQueueable, QUEUEABLE_ACTIONS } from './config/queueableActions.js';

/**
 * Parse a tool call into facade + action.
 * Handles both styles:
 *   - Facade call: tool="sentinel", args.action="create_issue"
 *   - Direct call: tool="sentinel_create_issue"
 */
export function parseToolCall(
  tool: string,
  args: Record<string, unknown>
): { facade: string; action: string } | null {
  // Style 1: facade call with action in args
  if (args.action && typeof args.action === 'string') {
    return { facade: tool, action: args.action };
  }

  // Style 2: underscore-separated tool name (e.g. sentinel_create_issue)
  // Find the longest matching facade prefix
  for (const facade of Object.keys(QUEUEABLE_ACTIONS)) {
    const prefix = `${facade}_`;
    if (tool.startsWith(prefix)) {
      const action = tool.slice(prefix.length);
      if (action) return { facade, action };
    }
  }

  return null;
}

/**
 * Should this tool call be queued instead of executed?
 * True when: remote agent + queueable action.
 */
export function shouldQueueForAgent(
  tool: string,
  args: Record<string, unknown>,
  agentId: string | undefined,
): boolean {
  if (!agentId) return false;

  const parsed = parseToolCall(tool, args);
  if (!parsed) return false;

  return isQueueable(parsed.facade, parsed.action);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/httpQueueDetection.test.ts`
Expected: PASS

- [ ] **Step 5: Integrate into httpServer.ts**

In `src/httpServer.ts`, find the `executeTool` function. Add the queue detection early in the function, after extracting agent context but before kernel dispatch.

Add import at top of file:

```typescript
import { shouldQueueForAgent, parseToolCall } from './httpQueueDetection.js';
import { isSupabaseConfigured, getSupabaseServiceClient } from './lib/supabase.js';
```

Inside `executeTool`, after `const headerAgentId = ...` and before the kernel dispatch call, add:

```typescript
    // Queue detection: if this is a write call from a remote agent, queue it
    const agentId = typeof headerAgentId === 'string' ? headerAgentId : undefined;
    if (agentId && shouldQueueForAgent(tool, args, agentId)) {
      const parsed = parseToolCall(tool, args)!;
      // Strip the action from args — it's stored separately in the queue
      const { action: _action, ...queueArgs } = args;
      return await queueForAgent(parsed.facade, parsed.action, queueArgs, agentId, args.projectId as string || 'default');
    }
```

Add the `queueForAgent` helper function in `httpServer.ts`:

```typescript
async function queueForAgent(
  facade: string,
  action: string,
  args: Record<string, unknown>,
  agentId: string,
  projectId: string,
): Promise<StatusEnvelope> {
  if (!isSupabaseConfigured()) {
    return wrapError('Agent queue requires Supabase configuration', 'QUEUE_UNAVAILABLE');
  }

  const supabase = getSupabaseServiceClient();

  const { data, error } = await supabase
    .from('agent_queue')
    .insert({
      project_id: projectId,
      facade,
      action,
      arguments: args,
      created_by: agentId,
    })
    .select('id')
    .single();

  if (error) {
    return wrapError(`Failed to queue: ${error.message}`, 'QUEUE_ERROR');
  }

  return {
    status: 'queued',
    queue_id: data.id,
    message: 'Queued for local sync. Use agentic queue_status to check result.',
  } as any;  // StatusEnvelope extension
}
```

- [ ] **Step 6: Build and verify**

Run: `npm run build`
Expected: Clean compilation

- [ ] **Step 7: Commit**

```bash
git add src/httpQueueDetection.ts src/__tests__/httpQueueDetection.test.ts src/httpServer.ts
git commit -m "feat: auto-queue remote agent writes via HTTP transport"
```

---

### Task 6: Update CLAUDE.md — Session Start Protocol

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add agent_queue_sync to session start protocol**

Find the Voice Inbox Protocol section in CLAUDE.md and add the agent queue sync alongside it:

```markdown
## Agent Queue Protocol

Remote agents queue writes via Supabase. Sync them at session start:

```
agentic queue_sync with project_id: "decibel-tools-mcp"
```

This replays any queued agent writes (issues, ADRs, friction logs, etc.) to local `.decibel/` files.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add agent queue sync to session start protocol"
```

---

### Task 7: Human-Readable Summary for Rich

**Files:**
- Create: `.decibel/specs/2026-03-30-agent-queue-summary.md`

- [ ] **Step 1: Write the summary document**

Write a clean, non-technical summary covering:
- What problem this solves (agents can't write to local project data)
- How it works (queue in Supabase, sync locally)
- What agents can do now (log issues, ADRs, friction, wishes, etc.)
- What's NOT included yet (reads, webhooks, full migration)
- How to use it (session start auto-syncs, or manual sync)

Keep it under 2 pages, written for a technical co-founder who doesn't need to see code.

- [ ] **Step 2: Commit**

```bash
git add .decibel/specs/2026-03-30-agent-queue-summary.md
git commit -m "docs: add agent queue summary for Rich review"
```

---

### Task 8: Integration Smoke Test

**Files:**
- No new files — manual verification

- [ ] **Step 1: Build the project**

Run: `npm run build`
Expected: Clean build

- [ ] **Step 2: Run all tests**

Run: `npx vitest run`
Expected: All existing + new tests pass

- [ ] **Step 3: Verify tool registration**

Start the server and check the agentic facade includes the new actions:

```bash
echo '{"jsonrpc":"2.0","method":"tools/list","id":1}' | node dist/server.js 2>/dev/null | head -5
```

Verify `agentic` facade description mentions `queue_sync` and `queue_status`.

- [ ] **Step 4: Final commit if any fixups needed**

```bash
git add -A
git commit -m "fix: integration fixups for agent queue"
```
