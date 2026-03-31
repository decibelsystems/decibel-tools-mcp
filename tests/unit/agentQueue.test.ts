// tests/unit/agentQueue.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { agentQueueSync, agentQueueStatus } from '../../src/tools/agentic/agentQueue.js';
import kernel from '../../src/kernel.js';

// ============================================================================
// Mocks
// ============================================================================

// Mock Supabase
const mockSupabase = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  is: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  single: vi.fn().mockResolvedValue({ data: null, error: null }),
};

vi.mock('../../src/lib/supabase.js', () => ({
  isSupabaseConfigured: vi.fn(() => true),
  getSupabaseServiceClient: vi.fn(() => mockSupabase),
}));

// Mock kernel — factory cannot reference outer variables (hoisting), so we
// import the mock after factory registration and alias dispatch from there.
vi.mock('../../src/kernel.js', () => ({
  default: {
    dispatch: vi.fn(),
  },
}));

// ============================================================================
// Helpers
// ============================================================================

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'queue-001',
    project_id: 'test-project',
    facade: 'sentinel',
    action: 'create_issue',
    arguments: { title: 'Test issue', severity: 'med' },
    created_at: '2026-03-30T10:00:00Z',
    synced_at: null,
    sync_result: null,
    sync_error: null,
    provenance_ref: null,
    ...overrides,
  };
}

function makeDispatchResult(text: string, isError = false) {
  return {
    content: [{ type: 'text', text }],
    isError,
  };
}

// ============================================================================
// Tests: agentQueueSync
// ============================================================================

describe('agentQueueSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset the mock chain — each call builds a new chain
    mockSupabase.from.mockReturnValue(mockSupabase);
    mockSupabase.select.mockReturnValue(mockSupabase);
    mockSupabase.eq.mockReturnValue(mockSupabase);
    mockSupabase.is.mockReturnValue(mockSupabase);
    mockSupabase.order.mockReturnValue(mockSupabase);
    mockSupabase.limit.mockResolvedValue({ data: [], error: null });
    mockSupabase.update.mockReturnValue(mockSupabase);
    // single() is used by agentQueueStatus - keep as resolved
    mockSupabase.single.mockResolvedValue({ data: null, error: null });
  });

  it('returns zero counts when no unsynced items', async () => {
    mockSupabase.limit.mockResolvedValue({ data: [], error: null });

    const result = await agentQueueSync({ projectId: 'test-project' });

    expect(result.synced).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.items).toHaveLength(0);
  });

  it('replays queued items through kernel dispatch with correct args', async () => {
    const row = makeRow();
    mockSupabase.limit.mockResolvedValue({ data: [row], error: null });
    vi.mocked(kernel.dispatch).mockResolvedValue(makeDispatchResult('{"id":"ISS-001"}'));

    const result = await agentQueueSync({ projectId: 'test-project' });

    expect(vi.mocked(kernel.dispatch)).toHaveBeenCalledOnce();
    expect(vi.mocked(kernel.dispatch)).toHaveBeenCalledWith(
      'sentinel',
      { action: 'create_issue', title: 'Test issue', severity: 'med' },
      undefined
    );

    expect(result.synced).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.items[0].status).toBe('synced');
    expect(result.items[0].facade).toBe('sentinel');
    expect(result.items[0].action).toBe('create_issue');
  });

  it('records errors without blocking other items', async () => {
    const row1 = makeRow({ id: 'queue-001', action: 'create_issue' });
    const row2 = makeRow({ id: 'queue-002', action: 'log_epic' });
    mockSupabase.limit.mockResolvedValue({ data: [row1, row2], error: null });

    vi.mocked(kernel.dispatch)
      .mockRejectedValueOnce(new Error('Kernel exploded'))
      .mockResolvedValueOnce(makeDispatchResult('{"id":"EPIC-001"}'));

    const result = await agentQueueSync({ projectId: 'test-project' });

    expect(result.synced).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.items[0].status).toBe('error');
    expect(result.items[0].error).toContain('Kernel exploded');
    expect(result.items[1].status).toBe('synced');
  });

  it('throws when Supabase is not configured', async () => {
    const { isSupabaseConfigured } = await import('../../src/lib/supabase.js');
    vi.mocked(isSupabaseConfigured).mockReturnValueOnce(false);

    await expect(agentQueueSync({ projectId: 'test-project' })).rejects.toThrow(
      /supabase/i
    );
  });

  it('applies facadeFilter when provided', async () => {
    mockSupabase.limit.mockResolvedValue({ data: [], error: null });

    await agentQueueSync({ projectId: 'test-project', facadeFilter: 'friction' });

    // eq() should be called for both project_id and facade
    const eqCalls = mockSupabase.eq.mock.calls;
    expect(eqCalls.some(([col, val]) => col === 'facade' && val === 'friction')).toBe(true);
  });

  it('skips non-queueable actions and records error', async () => {
    const row = makeRow({ facade: 'oracle', action: 'next_actions' });
    mockSupabase.limit.mockResolvedValue({ data: [row], error: null });

    const result = await agentQueueSync({ projectId: 'test-project' });

    expect(vi.mocked(kernel.dispatch)).not.toHaveBeenCalled();
    expect(result.failed).toBe(1);
    expect(result.items[0].status).toBe('error');
    expect(result.items[0].error).toMatch(/not queueable/i);
  });

  it('extracts PROV reference from dispatch result text', async () => {
    const row = makeRow();
    mockSupabase.limit.mockResolvedValue({ data: [row], error: null });
    vi.mocked(kernel.dispatch).mockResolvedValue(
      makeDispatchResult('Issue created. Provenance: PROV-20260330T100000-42')
    );

    const result = await agentQueueSync({ projectId: 'test-project' });

    expect(result.items[0].provenance_ref).toBe('PROV-20260330T100000-42');
  });

  it('treats kernel isError result as failed', async () => {
    const row = makeRow();
    mockSupabase.limit.mockResolvedValue({ data: [row], error: null });
    vi.mocked(kernel.dispatch).mockResolvedValue(makeDispatchResult('Tool failed: bad input', true));

    const result = await agentQueueSync({ projectId: 'test-project' });

    expect(result.failed).toBe(1);
    expect(result.items[0].status).toBe('error');
  });
});

// ============================================================================
// Tests: agentQueueStatus
// ============================================================================

describe('agentQueueStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockSupabase.from.mockReturnValue(mockSupabase);
    mockSupabase.select.mockReturnValue(mockSupabase);
    mockSupabase.eq.mockReturnValue(mockSupabase);
    mockSupabase.single.mockResolvedValue({ data: null, error: null });
  });

  it('returns not_found when row does not exist', async () => {
    mockSupabase.single.mockResolvedValue({ data: null, error: null });

    const result = await agentQueueStatus({ queueId: 'missing-id' });

    expect(result.status).toBe('not_found');
  });

  it('returns pending for a row with null synced_at', async () => {
    mockSupabase.single.mockResolvedValue({
      data: {
        id: 'queue-001',
        project_id: 'proj',
        facade: 'sentinel',
        action: 'create_issue',
        created_at: '2026-03-30T10:00:00Z',
        synced_at: null,
        sync_result: null,
        sync_error: null,
        provenance_ref: null,
      },
      error: null,
    });

    const result = await agentQueueStatus({ queueId: 'queue-001' });

    expect(result.status).toBe('pending');
    expect(result.created_at).toBe('2026-03-30T10:00:00Z');
    expect(result.synced_at).toBeUndefined();
  });

  it('returns synced for a row with synced_at set and no error', async () => {
    mockSupabase.single.mockResolvedValue({
      data: {
        id: 'queue-001',
        project_id: 'proj',
        facade: 'sentinel',
        action: 'create_issue',
        created_at: '2026-03-30T10:00:00Z',
        synced_at: '2026-03-30T10:05:00Z',
        sync_result: { id: 'ISS-001' },
        sync_error: null,
        provenance_ref: 'PROV-20260330T100000-42',
      },
      error: null,
    });

    const result = await agentQueueStatus({ queueId: 'queue-001' });

    expect(result.status).toBe('synced');
    expect(result.synced_at).toBe('2026-03-30T10:05:00Z');
    expect(result.provenance_ref).toBe('PROV-20260330T100000-42');
  });

  it('returns error for a row with sync_error set', async () => {
    mockSupabase.single.mockResolvedValue({
      data: {
        id: 'queue-002',
        project_id: 'proj',
        facade: 'friction',
        action: 'log',
        created_at: '2026-03-30T10:00:00Z',
        synced_at: '2026-03-30T10:05:00Z',
        sync_result: null,
        sync_error: 'Dispatch failed',
        provenance_ref: null,
      },
      error: null,
    });

    const result = await agentQueueStatus({ queueId: 'queue-002' });

    expect(result.status).toBe('error');
    expect(result.sync_error).toBe('Dispatch failed');
  });
});
