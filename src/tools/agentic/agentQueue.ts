/**
 * Agent Queue Sync and Status
 *
 * Syncs queued agent writes from Supabase to local files by replaying
 * each queued item through the kernel dispatch. Also provides status
 * lookup for individual queue entries.
 */

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

// ============================================================================
// Helpers
// ============================================================================

/**
 * Extract a PROV-* reference from a dispatch result text string.
 */
function extractProvenanceRef(text: string): string | undefined {
  const match = text.match(/PROV-\d{8}T\d{6}-\d+/);
  return match ? match[0] : undefined;
}

/**
 * Update an agent_queue row with sync outcome fields.
 */
async function updateQueueRow(
  id: string,
  fields: {
    synced_at: string;
    sync_result: unknown;
    sync_error: string | null;
    provenance_ref: string | null;
  }
): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase
    .from('agent_queue')
    .update(fields)
    .eq('id', id);

  if (error) {
    log(`agentQueue: Warning - failed to update row ${id}: ${error.message}`);
  }
}

// ============================================================================
// agentQueueSync
// ============================================================================

/**
 * Sync queued agent writes from Supabase to local files.
 * Queries the agent_queue table for unsynced rows, dispatches each one through
 * the kernel, and records the outcome back in Supabase.
 */
export async function agentQueueSync(input: AgentQueueSyncInput): Promise<AgentQueueSyncOutput> {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_KEY.');
  }

  if (!input.projectId) {
    throw new Error('projectId is required for agent queue sync.');
  }

  const supabase = getSupabaseServiceClient();
  const limit = input.limit ?? 50;

  // Build query for unsynced rows
  let query = supabase
    .from('agent_queue')
    .select('*')
    .eq('project_id', input.projectId)
    .is('synced_at', null)
    .order('created_at', { ascending: true });

  if (input.facadeFilter) {
    query = query.eq('facade', input.facadeFilter);
  }

  const { data: rows, error: queryError } = await query.limit(limit);

  if (queryError) {
    throw new Error(`Failed to query agent_queue: ${queryError.message}`);
  }

  if (!rows || rows.length === 0) {
    log(`agentQueue: No unsynced items for project "${input.projectId}"`);
    return { synced: 0, failed: 0, items: [] };
  }

  log(`agentQueue: Found ${rows.length} unsynced items for project "${input.projectId}"`);

  const items: AgentQueueSyncItem[] = [];

  for (const row of rows) {
    const { id, facade, action, arguments: rowArgs } = row as {
      id: string;
      facade: string;
      action: string;
      arguments: Record<string, unknown>;
    };

    // Validate against queueable allowlist
    if (!isQueueable(facade, action)) {
      const errorMsg = `Action "${facade}.${action}" is not queueable`;
      log(`agentQueue: Skipping ${id} — ${errorMsg}`);

      items.push({
        queue_id: id,
        facade,
        action,
        status: 'error',
        error: errorMsg,
      });

      await updateQueueRow(id, {
        synced_at: new Date().toISOString(),
        sync_result: null,
        sync_error: errorMsg,
        provenance_ref: null,
      });

      continue;
    }

    try {
      // Dispatch through kernel: merge action into args
      const dispatchArgs: Record<string, unknown> = {
        action,
        ...(rowArgs || {}),
      };

      const dispatchResult = await kernel.dispatch(facade, dispatchArgs, undefined);

      // If kernel returned an error result, treat as failure
      if (dispatchResult.isError) {
        const errText = dispatchResult.content
          .filter(c => c.type === 'text')
          .map(c => (c as { type: 'text'; text: string }).text)
          .join(' ');

        items.push({
          queue_id: id,
          facade,
          action,
          status: 'error',
          error: errText,
        });

        await updateQueueRow(id, {
          synced_at: new Date().toISOString(),
          sync_result: null,
          sync_error: errText,
          provenance_ref: null,
        });

        continue;
      }

      // Extract text content and try to parse JSON result
      const resultText = dispatchResult.content
        .filter(c => c.type === 'text')
        .map(c => (c as { type: 'text'; text: string }).text)
        .join('');

      let parsedResult: unknown = resultText;
      try {
        parsedResult = JSON.parse(resultText);
      } catch {
        // Keep raw text if not valid JSON
      }

      const provenanceRef = extractProvenanceRef(resultText);

      items.push({
        queue_id: id,
        facade,
        action,
        status: 'synced',
        result: parsedResult,
        provenance_ref: provenanceRef,
      });

      await updateQueueRow(id, {
        synced_at: new Date().toISOString(),
        sync_result: parsedResult,
        sync_error: null,
        provenance_ref: provenanceRef ?? null,
      });

      log(`agentQueue: Synced ${id} (${facade}.${action})`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      log(`agentQueue: Error syncing ${id}: ${errorMsg}`);

      items.push({
        queue_id: id,
        facade,
        action,
        status: 'error',
        error: errorMsg,
      });

      await updateQueueRow(id, {
        synced_at: new Date().toISOString(),
        sync_result: null,
        sync_error: errorMsg,
        provenance_ref: null,
      });
    }
  }

  const summary: AgentQueueSyncOutput = {
    synced: items.filter(i => i.status === 'synced').length,
    failed: items.filter(i => i.status === 'error').length,
    items,
  };

  log(`agentQueue: Sync complete — ${summary.synced} synced, ${summary.failed} failed`);

  return summary;
}

// ============================================================================
// agentQueueStatus
// ============================================================================

/**
 * Check the status of a single queued item by ID.
 */
export async function agentQueueStatus(input: AgentQueueStatusInput): Promise<AgentQueueStatusOutput> {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_KEY.');
  }

  const supabase = getSupabaseServiceClient();

  const { data: row, error } = await supabase
    .from('agent_queue')
    .select('*')
    .eq('id', input.queueId)
    .single();

  if (error || !row) {
    return { status: 'not_found' };
  }

  // Determine status
  const hasSyncedAt = !!row.synced_at;
  const hasError = !!row.sync_error;

  let status: AgentQueueStatusOutput['status'];
  if (!hasSyncedAt) {
    status = 'pending';
  } else if (hasError) {
    status = 'error';
  } else {
    status = 'synced';
  }

  return {
    status,
    created_at: row.created_at ?? undefined,
    ...(hasSyncedAt ? { synced_at: row.synced_at } : {}),
    ...(row.sync_result ? { sync_result: row.sync_result } : {}),
    ...(row.sync_error ? { sync_error: row.sync_error } : {}),
    ...(row.provenance_ref ? { provenance_ref: row.provenance_ref } : {}),
  };
}
