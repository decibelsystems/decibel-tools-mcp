/**
 * Swarm Tools — Shared Agent Context Layer
 *
 * Multi-agent coordination via sessions, signals, artifacts, and snapshots.
 * Phase 1: Sessions + Signals. Backed by Supabase (Core project).
 *
 * Env var: DECK_SUPABASE_KEY (reuses deck's anon key — same Supabase project)
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { ToolSpec, ToolResult } from './types.js';

const CORE_SUPABASE_URL = 'https://dqftcixhsvcjtyxsxoao.supabase.co';
const CORE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRxZnRjaXhoc3ZjanR5eHN4b2FvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjcyMTgzMTYsImV4cCI6MjA4Mjc5NDMxNn0.erZq0zJMF-tATX7b0mofGsajFUvcqlZE5PQ4qcggmGc';

let client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (!client) {
    const key = process.env.DECK_SUPABASE_KEY || CORE_ANON_KEY;
    client = createClient(CORE_SUPABASE_URL, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

function jsonResult(data: unknown, isError = false): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    isError,
  };
}

// ============================================================================
// Session Tools
// ============================================================================

const swarmStartSession: ToolSpec = {
  definition: {
    name: 'swarm_start_session',
    description:
      'Create a new multi-agent session. Returns the session ID for participants to join.',
    annotations: {
      title: 'Start Session',
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        mission: {
          type: 'string',
          description: 'What this session aims to accomplish',
        },
        coordinator: {
          type: 'string',
          description: 'ID or name of the coordinating agent',
        },
      },
      required: ['mission'],
    },
  },
  handler: async (args: { mission: string; coordinator?: string }): Promise<ToolResult> => {
    try {
      const db = getClient();
      const { data, error } = await db
        .from('agent_sessions')
        .insert({
          mission: args.mission,
          coordinator: args.coordinator || null,
          status: 'active',
          participants: [],
        })
        .select('id, mission, status, created_at')
        .single();

      if (error) throw new Error(error.message);
      return jsonResult({ success: true, session: data });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return jsonResult({ success: false, error: msg }, true);
    }
  },
};

const swarmJoinSession: ToolSpec = {
  definition: {
    name: 'swarm_join_session',
    description:
      'Join an active session. Declares your role, capabilities, and topic subscriptions.',
    annotations: {
      title: 'Join Session',
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        session_id: {
          type: 'string',
          description: 'Session ID to join',
        },
        peer_id: {
          type: 'string',
          description: 'Your peer ID (from claude-peers)',
        },
        repo: {
          type: 'string',
          description: 'Repository name you are working in',
        },
        role: {
          type: 'string',
          description: 'Your role in this session (e.g. "Data layer — Supabase cards, prices")',
        },
        capabilities: {
          type: 'array',
          items: { type: 'string' },
          description: 'What you can do (e.g. ["query_supabase", "run_scryfall_sync"])',
        },
        subscriptions: {
          type: 'array',
          items: { type: 'string' },
          description: 'Topics you want signals for (e.g. ["card_data", "api_contracts"])',
        },
      },
      required: ['session_id', 'peer_id'],
    },
  },
  handler: async (args: {
    session_id: string;
    peer_id: string;
    repo?: string;
    role?: string;
    capabilities?: string[];
    subscriptions?: string[];
  }): Promise<ToolResult> => {
    try {
      const db = getClient();

      // Read current participants
      const { data: session, error: readErr } = await db
        .from('agent_sessions')
        .select('participants, status')
        .eq('id', args.session_id)
        .single();

      if (readErr) throw new Error(readErr.message);
      if (!session) throw new Error(`Session ${args.session_id} not found`);
      if (session.status !== 'active' && session.status !== 'paused') {
        throw new Error(`Session is ${session.status}, cannot join`);
      }

      const participants = (session.participants as Array<Record<string, unknown>>) || [];
      const existing = participants.findIndex(
        (p) => p.peer_id === args.peer_id
      );

      const participant = {
        peer_id: args.peer_id,
        repo: args.repo || null,
        role: args.role || null,
        capabilities: args.capabilities || [],
        subscriptions: args.subscriptions || ['*'],
        joined_at: new Date().toISOString(),
      };

      if (existing >= 0) {
        participants[existing] = participant;
      } else {
        participants.push(participant);
      }

      const { error: updateErr } = await db
        .from('agent_sessions')
        .update({
          participants,
          status: 'active', // resume if paused
          paused_at: null,
        })
        .eq('id', args.session_id);

      if (updateErr) throw new Error(updateErr.message);

      return jsonResult({
        success: true,
        joined: args.session_id,
        participant_count: participants.length,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return jsonResult({ success: false, error: msg }, true);
    }
  },
};

const swarmSessionStatus: ToolSpec = {
  definition: {
    name: 'swarm_session_status',
    description:
      'Read current session state: mission, participants, signal count, status.',
    annotations: {
      title: 'Session Status',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        session_id: {
          type: 'string',
          description: 'Session ID (omit to list active sessions)',
        },
      },
      required: [],
    },
  },
  handler: async (args: { session_id?: string }): Promise<ToolResult> => {
    try {
      const db = getClient();

      if (!args.session_id) {
        // List active/paused sessions
        const { data, error } = await db
          .from('agent_sessions')
          .select('id, mission, coordinator, status, participants, created_at')
          .in('status', ['active', 'paused'])
          .order('created_at', { ascending: false })
          .limit(20);

        if (error) throw new Error(error.message);
        return jsonResult({ success: true, sessions: data, count: data?.length || 0 });
      }

      // Get specific session with signal count
      const { data: session, error: sessErr } = await db
        .from('agent_sessions')
        .select('*')
        .eq('id', args.session_id)
        .single();

      if (sessErr) throw new Error(sessErr.message);

      const { count, error: countErr } = await db
        .from('agent_signals')
        .select('*', { count: 'exact', head: true })
        .eq('session_id', args.session_id);

      if (countErr) throw new Error(countErr.message);

      return jsonResult({
        success: true,
        session,
        signal_count: count || 0,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return jsonResult({ success: false, error: msg }, true);
    }
  },
};

const swarmPauseSession: ToolSpec = {
  definition: {
    name: 'swarm_pause_session',
    description: 'Pause a session for later continuation. Does not trigger learnings extraction.',
    annotations: {
      title: 'Pause Session',
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Session ID to pause' },
      },
      required: ['session_id'],
    },
  },
  handler: async (args: { session_id: string }): Promise<ToolResult> => {
    try {
      const db = getClient();
      const { error } = await db
        .from('agent_sessions')
        .update({ status: 'paused', paused_at: new Date().toISOString() })
        .eq('id', args.session_id);

      if (error) throw new Error(error.message);
      return jsonResult({ success: true, paused: args.session_id });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return jsonResult({ success: false, error: msg }, true);
    }
  },
};

const swarmCloseSession: ToolSpec = {
  definition: {
    name: 'swarm_close_session',
    description:
      'Close a session. Returns a summary of signals and artifacts for learnings extraction.',
    annotations: {
      title: 'Close Session',
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Session ID to close' },
      },
      required: ['session_id'],
    },
  },
  handler: async (args: { session_id: string }): Promise<ToolResult> => {
    try {
      const db = getClient();

      // Close the session
      const { error: closeErr } = await db
        .from('agent_sessions')
        .update({ status: 'completed', closed_at: new Date().toISOString() })
        .eq('id', args.session_id);

      if (closeErr) throw new Error(closeErr.message);

      // Gather summary for learnings extraction
      const { data: signals } = await db
        .from('agent_signals')
        .select('type, topic, summary, resolved, resolution')
        .eq('session_id', args.session_id)
        .order('created_at', { ascending: true });

      const { data: session } = await db
        .from('agent_sessions')
        .select('mission, participants, created_at, closed_at')
        .eq('id', args.session_id)
        .single();

      const decisions = signals?.filter((s) => s.type === 'decision') || [];
      const unresolved = signals?.filter((s) => s.type === 'request' && !s.resolved) || [];
      const bugFixPairs = signals?.filter(
        (s) => s.type === 'bug_found' || s.type === 'fix_applied'
      ) || [];

      return jsonResult({
        success: true,
        closed: args.session_id,
        summary: {
          mission: session?.mission,
          participants: session?.participants,
          duration_minutes: session?.created_at && session?.closed_at
            ? Math.round(
                (new Date(session.closed_at).getTime() -
                  new Date(session.created_at).getTime()) /
                  60000
              )
            : null,
          total_signals: signals?.length || 0,
          decisions,
          unresolved_requests: unresolved,
          bug_fix_pairs: bugFixPairs,
        },
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return jsonResult({ success: false, error: msg }, true);
    }
  },
};

// ============================================================================
// Signal Tools
// ============================================================================

const SIGNAL_TYPES = [
  'bug_found', 'fix_applied', 'blocker', 'decision', 'finding', 'request',
  'api_changed', 'breaking_change', 'schema_changed', 'new_capability',
  'gate', 'intent',
] as const;

const swarmEmitSignal: ToolSpec = {
  definition: {
    name: 'swarm_emit_signal',
    description:
      'Publish a signal to the session. Types: bug_found, fix_applied, blocker, decision, finding, request, api_changed, breaking_change, schema_changed, new_capability, gate, intent.',
    annotations: {
      title: 'Emit Signal',
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Session ID' },
        type: {
          type: 'string',
          enum: [...SIGNAL_TYPES],
          description: 'Signal type',
        },
        topic: { type: 'string', description: 'Domain tag for routing (e.g. "deck_search", "card_data")' },
        emitter_id: { type: 'string', description: 'Your peer ID' },
        emitter_role: { type: 'string', description: 'Your role in the session' },
        severity: {
          type: 'string',
          enum: ['high', 'medium', 'low'],
          description: 'Signal severity (default: medium)',
        },
        summary: { type: 'string', description: 'One-line summary of what happened' },
        payload: {
          type: 'object',
          description: 'Structured data (typed JSONB — include relevant details)',
        },
        needs: { type: 'string', description: 'What is needed from other participants' },
        requires_ack: {
          type: 'boolean',
          description: 'If true, surfaces prominently until acknowledged (use for breaking changes)',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Ad-hoc tags for filtering beyond topic',
        },
      },
      required: ['session_id', 'type', 'topic', 'emitter_id', 'summary'],
    },
  },
  handler: async (args: {
    session_id: string;
    type: string;
    topic: string;
    emitter_id: string;
    emitter_role?: string;
    severity?: string;
    summary: string;
    payload?: Record<string, unknown>;
    needs?: string;
    requires_ack?: boolean;
    tags?: string[];
  }): Promise<ToolResult> => {
    try {
      const db = getClient();

      // Check for intent conflicts
      let conflict_warning: string | null = null;
      if (args.type === 'intent') {
        const target = (args.payload as Record<string, unknown>)?.target as string;
        if (target) {
          const { data: existing } = await db
            .from('agent_signals')
            .select('emitter_id, summary, created_at')
            .eq('session_id', args.session_id)
            .eq('type', 'intent')
            .eq('resolved', false)
            .contains('payload', { target });

          if (existing && existing.length > 0) {
            conflict_warning = `Conflict: ${existing[0].emitter_id} has active intent on "${target}" — coordinate before proceeding`;
          }
        }
      }

      const { data, error } = await db
        .from('agent_signals')
        .insert({
          session_id: args.session_id,
          type: args.type,
          topic: args.topic,
          emitter_id: args.emitter_id,
          emitter_role: args.emitter_role || null,
          severity: args.severity || 'medium',
          summary: args.summary,
          payload: args.payload || {},
          needs: args.needs || null,
          requires_ack: args.requires_ack || false,
          tags: args.tags || [],
        })
        .select('id, type, topic, summary, created_at')
        .single();

      if (error) throw new Error(error.message);

      const result: Record<string, unknown> = { success: true, signal: data };
      if (conflict_warning) result.conflict_warning = conflict_warning;

      return jsonResult(result);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return jsonResult({ success: false, error: msg }, true);
    }
  },
};

const swarmReadSignals: ToolSpec = {
  definition: {
    name: 'swarm_read_signals',
    description:
      'Read signals from a session. Filter by type, topic, resolved status, or timestamp.',
    annotations: {
      title: 'Read Signals',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Session ID' },
        type: { type: 'string', description: 'Filter by signal type' },
        topic: { type: 'string', description: 'Filter by topic' },
        resolved: { type: 'boolean', description: 'Filter by resolved status' },
        since: { type: 'string', description: 'ISO timestamp — only signals after this time' },
        requires_ack: { type: 'boolean', description: 'Filter to signals needing acknowledgment' },
        limit: { type: 'number', description: 'Max signals to return (default: 50)' },
      },
      required: ['session_id'],
    },
  },
  handler: async (args: {
    session_id: string;
    type?: string;
    topic?: string;
    resolved?: boolean;
    since?: string;
    requires_ack?: boolean;
    limit?: number;
  }): Promise<ToolResult> => {
    try {
      const db = getClient();
      let query = db
        .from('agent_signals')
        .select('*')
        .eq('session_id', args.session_id)
        .order('created_at', { ascending: true })
        .limit(args.limit || 50);

      if (args.type) query = query.eq('type', args.type);
      if (args.topic) query = query.eq('topic', args.topic);
      if (args.resolved !== undefined) query = query.eq('resolved', args.resolved);
      if (args.since) query = query.gt('created_at', args.since);
      if (args.requires_ack) query = query.eq('requires_ack', true);

      const { data, error } = await query;
      if (error) throw new Error(error.message);

      return jsonResult({
        success: true,
        signals: data,
        count: data?.length || 0,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return jsonResult({ success: false, error: msg }, true);
    }
  },
};

const swarmAckSignal: ToolSpec = {
  definition: {
    name: 'swarm_ack_signal',
    description:
      'Acknowledge a signal: seen, will_act, or not_relevant. Lightweight — no full response needed.',
    annotations: {
      title: 'Ack Signal',
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        signal_id: { type: 'string', description: 'Signal ID to acknowledge' },
        peer_id: { type: 'string', description: 'Your peer ID' },
        status: {
          type: 'string',
          enum: ['seen', 'will_act', 'not_relevant'],
          description: 'Acknowledgment status',
        },
      },
      required: ['signal_id', 'peer_id', 'status'],
    },
  },
  handler: async (args: {
    signal_id: string;
    peer_id: string;
    status: string;
  }): Promise<ToolResult> => {
    try {
      const db = getClient();

      const { data: signal, error: readErr } = await db
        .from('agent_signals')
        .select('acks')
        .eq('id', args.signal_id)
        .single();

      if (readErr) throw new Error(readErr.message);

      const acks = (signal?.acks as Array<Record<string, unknown>>) || [];
      const existing = acks.findIndex((a) => a.peer_id === args.peer_id);
      const ack = {
        peer_id: args.peer_id,
        status: args.status,
        at: new Date().toISOString(),
      };

      if (existing >= 0) {
        acks[existing] = ack;
      } else {
        acks.push(ack);
      }

      const { error: updateErr } = await db
        .from('agent_signals')
        .update({ acks })
        .eq('id', args.signal_id);

      if (updateErr) throw new Error(updateErr.message);

      return jsonResult({ success: true, acked: args.signal_id, status: args.status });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return jsonResult({ success: false, error: msg }, true);
    }
  },
};

const swarmClaimSignal: ToolSpec = {
  definition: {
    name: 'swarm_claim_signal',
    description:
      'Claim a request signal ("I\'m on it"). First-claim-wins. Use release to unclaim.',
    annotations: {
      title: 'Claim Signal',
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        signal_id: { type: 'string', description: 'Signal ID to claim' },
        peer_id: { type: 'string', description: 'Your peer ID' },
      },
      required: ['signal_id', 'peer_id'],
    },
  },
  handler: async (args: { signal_id: string; peer_id: string }): Promise<ToolResult> => {
    try {
      const db = getClient();

      const { data: signal, error: readErr } = await db
        .from('agent_signals')
        .select('claimed_by, type')
        .eq('id', args.signal_id)
        .single();

      if (readErr) throw new Error(readErr.message);
      if (signal?.claimed_by) {
        return jsonResult({
          success: false,
          error: `Already claimed by ${signal.claimed_by}`,
        }, true);
      }

      const { error: updateErr } = await db
        .from('agent_signals')
        .update({ claimed_by: args.peer_id })
        .eq('id', args.signal_id)
        .is('claimed_by', null); // Optimistic concurrency

      if (updateErr) throw new Error(updateErr.message);

      return jsonResult({ success: true, claimed: args.signal_id, by: args.peer_id });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return jsonResult({ success: false, error: msg }, true);
    }
  },
};

const swarmReleaseSignal: ToolSpec = {
  definition: {
    name: 'swarm_release_signal',
    description: 'Release a claimed signal back to the pool.',
    annotations: {
      title: 'Release Signal',
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        signal_id: { type: 'string', description: 'Signal ID to release' },
        peer_id: { type: 'string', description: 'Your peer ID (must be the claimant)' },
      },
      required: ['signal_id', 'peer_id'],
    },
  },
  handler: async (args: { signal_id: string; peer_id: string }): Promise<ToolResult> => {
    try {
      const db = getClient();
      const { error } = await db
        .from('agent_signals')
        .update({ claimed_by: null })
        .eq('id', args.signal_id)
        .eq('claimed_by', args.peer_id);

      if (error) throw new Error(error.message);
      return jsonResult({ success: true, released: args.signal_id });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return jsonResult({ success: false, error: msg }, true);
    }
  },
};

const swarmResolveSignal: ToolSpec = {
  definition: {
    name: 'swarm_resolve_signal',
    description: 'Mark a signal as resolved with a resolution note.',
    annotations: {
      title: 'Resolve Signal',
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        signal_id: { type: 'string', description: 'Signal ID to resolve' },
        resolution: { type: 'string', description: 'How it was resolved' },
      },
      required: ['signal_id', 'resolution'],
    },
  },
  handler: async (args: { signal_id: string; resolution: string }): Promise<ToolResult> => {
    try {
      const db = getClient();
      const { error } = await db
        .from('agent_signals')
        .update({ resolved: true, resolution: args.resolution })
        .eq('id', args.signal_id);

      if (error) throw new Error(error.message);
      return jsonResult({ success: true, resolved: args.signal_id });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return jsonResult({ success: false, error: msg }, true);
    }
  },
};

// ============================================================================
// Export
// ============================================================================

export const swarmTools: ToolSpec[] = [
  swarmStartSession,
  swarmJoinSession,
  swarmSessionStatus,
  swarmPauseSession,
  swarmCloseSession,
  swarmEmitSignal,
  swarmReadSignals,
  swarmAckSignal,
  swarmClaimSignal,
  swarmReleaseSignal,
  swarmResolveSignal,
];
