/**
 * Mother Tools — daemon advice, policy patches, and incident management.
 *
 * Tools for writing advice snapshots, proposing policy patches,
 * publishing incidents, and querying the Mother daemon's Postgres tables.
 *
 * Env var: MOTHER_DATABASE_URL
 */

import pg from 'pg';
import type { ToolSpec, ToolResult } from './types.js';

const { Pool } = pg;

// Lazy-init pool
let pool: pg.Pool | null = null;

function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = process.env.MOTHER_DATABASE_URL;
    if (!connectionString) {
      throw new Error('MOTHER_DATABASE_URL environment variable not set');
    }
    pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 30000,
    });
  }
  return pool;
}

// =============================================================================
// Helpers
// =============================================================================

function jsonResult(data: unknown, isError = false): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    isError,
  };
}

const VALID_VERDICTS = ['ALLOW', 'REDUCE', 'SKIP'] as const;

const VALID_REASON_CODES = [
  'stop_streak',
  'thesis_invalidation',
  'win_rate_collapse',
  'regime_mismatch',
  'vol_spike',
  'drawdown_limit',
  'correlation_risk',
  'liquidity_concern',
  'time_of_day',
  'overexposure',
  'mean_reversion_expected',
  'momentum_exhaustion',
  'institutional_flow_shift',
  'giveback_pattern',
  'consecutive_losses',
] as const;

interface SnapshotValidation {
  valid: boolean;
  errors: string[];
}

function validateSnapshot(args: {
  verdict: string;
  confidence_mult: number;
  size_mult: number;
  exit_aggressiveness_mult: number;
  reason_codes?: string[];
}): SnapshotValidation {
  const errors: string[] = [];

  if (!VALID_VERDICTS.includes(args.verdict as any)) {
    errors.push(`Invalid verdict "${args.verdict}". Must be one of: ${VALID_VERDICTS.join(', ')}`);
  }

  if (args.confidence_mult < 0.0 || args.confidence_mult > 1.2) {
    errors.push(`confidence_mult ${args.confidence_mult} out of range [0.0, 1.2]`);
  }

  if (args.size_mult < 0.0 || args.size_mult > 1.0) {
    errors.push(`size_mult ${args.size_mult} out of range [0.0, 1.0]`);
  }

  if (args.exit_aggressiveness_mult < 0.7 || args.exit_aggressiveness_mult > 1.3) {
    errors.push(`exit_aggressiveness_mult ${args.exit_aggressiveness_mult} out of range [0.7, 1.3]`);
  }

  if (args.verdict === 'SKIP') {
    const codes = args.reason_codes ?? [];
    if (codes.length < 2) {
      errors.push(`SKIP verdict requires >= 2 reason_codes (got ${codes.length})`);
    }
  }

  if (args.reason_codes) {
    for (const code of args.reason_codes) {
      if (!VALID_REASON_CODES.includes(code as any)) {
        errors.push(`Invalid reason_code "${code}". Valid: ${VALID_REASON_CODES.join(', ')}`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// =============================================================================
// Tool 1: mother_write_advice_snapshot (WRITE)
// =============================================================================

const motherWriteAdviceSnapshot: ToolSpec = {
  definition: {
    name: 'mother_write_advice_snapshot',
    description:
      'Write an advice snapshot for a symbol×strategy pair. Validates verdict, multiplier bounds, and reason codes before inserting. SKIP verdict requires >= 2 reason_codes.',
    annotations: {
      title: 'Write Advice Snapshot',
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Trading symbol (e.g. BTCUSDT)' },
        strategy: { type: 'string', description: 'Strategy name' },
        verdict: {
          type: 'string',
          description: 'ALLOW | REDUCE | SKIP',
        },
        confidence_mult: {
          type: 'number',
          description: 'Confidence multiplier [0.0–1.2] (default: 1.0)',
        },
        size_mult: {
          type: 'number',
          description: 'Position size multiplier [0.0–1.0] (default: 1.0)',
        },
        exit_aggressiveness_mult: {
          type: 'number',
          description: 'Exit aggressiveness multiplier [0.7–1.3] (default: 1.0)',
        },
        risk_notes: {
          type: 'array',
          items: { type: 'string' },
          description: 'Free-form risk notes',
        },
        evidence_refs: {
          type: 'array',
          items: { type: 'string' },
          description: 'References to evidence (metric IDs, URLs, etc.)',
        },
        reason_codes: {
          type: 'array',
          items: { type: 'string' },
          description: 'Reason codes from the Mother enum (e.g. stop_streak, vol_spike)',
        },
        ttl_seconds: {
          type: 'number',
          description: 'Time-to-live in seconds (default: 3600)',
        },
        account: { type: 'string', description: 'Account name (default: "default")' },
        exchange: { type: 'string', description: 'Exchange name (default: "binance")' },
        run_id: { type: 'string', description: 'Agent run ID for traceability' },
      },
      required: ['symbol', 'strategy', 'verdict'],
    },
  },
  handler: async (args: {
    symbol: string;
    strategy: string;
    verdict: string;
    confidence_mult?: number;
    size_mult?: number;
    exit_aggressiveness_mult?: number;
    risk_notes?: string[];
    evidence_refs?: string[];
    reason_codes?: string[];
    ttl_seconds?: number;
    account?: string;
    exchange?: string;
    run_id?: string;
  }): Promise<ToolResult> => {
    try {
      const confidence_mult = args.confidence_mult ?? 1.0;
      const size_mult = args.size_mult ?? 1.0;
      const exit_aggressiveness_mult = args.exit_aggressiveness_mult ?? 1.0;

      const validation = validateSnapshot({
        verdict: args.verdict,
        confidence_mult,
        size_mult,
        exit_aggressiveness_mult,
        reason_codes: args.reason_codes,
      });

      if (!validation.valid) {
        return jsonResult({ success: false, errors: validation.errors }, true);
      }

      const db = getPool();
      const query = `
        INSERT INTO mother_advice_snapshots
          (symbol, strategy, verdict, confidence_mult, size_mult,
           exit_aggressiveness_mult, risk_notes, evidence_refs,
           reason_codes, ttl_seconds, account, exchange, run_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        RETURNING id, symbol, strategy, verdict, confidence_mult, size_mult,
                  exit_aggressiveness_mult, reason_codes, ttl_seconds,
                  expires_at, created_at
      `;
      const result = await db.query(query, [
        args.symbol,
        args.strategy,
        args.verdict,
        confidence_mult,
        size_mult,
        exit_aggressiveness_mult,
        args.risk_notes ?? [],
        args.evidence_refs ?? [],
        args.reason_codes ?? [],
        args.ttl_seconds ?? 3600,
        args.account ?? 'default',
        args.exchange ?? 'binance',
        args.run_id ?? null,
      ]);

      return jsonResult({
        success: true,
        snapshot: result.rows[0],
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return jsonResult({ success: false, error: msg }, true);
    }
  },
};

// =============================================================================
// Tool 2: mother_propose_policy_patch (WRITE)
// =============================================================================

const motherProposePolicyPatch: ToolSpec = {
  definition: {
    name: 'mother_propose_policy_patch',
    description:
      'Propose a bounded policy change with TTL and blast radius scoring. Auto-computes revert_at from ttl_seconds. Status starts as "proposed".',
    annotations: {
      title: 'Propose Policy Patch',
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        scope_symbol: { type: 'string', description: 'Symbol scope (optional — omit for global)' },
        scope_strategy: { type: 'string', description: 'Strategy scope (optional)' },
        scope_account: { type: 'string', description: 'Account scope (optional)' },
        changes: {
          type: 'object',
          description: 'Key-value map of policy changes',
        },
        ttl_seconds: {
          type: 'number',
          description: 'Time-to-live before auto-revert (default: 3600)',
        },
        reason_codes: {
          type: 'array',
          items: { type: 'string' },
          description: 'Reason codes justifying the patch',
        },
        blast_radius_score: {
          type: 'number',
          description: 'Estimated blast radius [0.0–1.0] (default: 0.0)',
        },
        proposed_by: {
          type: 'string',
          description: 'Who proposed (default: "agent")',
        },
      },
      required: ['changes', 'ttl_seconds', 'reason_codes'],
    },
  },
  handler: async (args: {
    scope_symbol?: string;
    scope_strategy?: string;
    scope_account?: string;
    changes: Record<string, unknown>;
    ttl_seconds: number;
    reason_codes: string[];
    blast_radius_score?: number;
    proposed_by?: string;
  }): Promise<ToolResult> => {
    try {
      // Validate reason codes
      for (const code of args.reason_codes) {
        if (!VALID_REASON_CODES.includes(code as any)) {
          return jsonResult({
            success: false,
            error: `Invalid reason_code "${code}". Valid: ${VALID_REASON_CODES.join(', ')}`,
          }, true);
        }
      }

      const db = getPool();
      const query = `
        INSERT INTO mother_policy_patches
          (scope_symbol, scope_strategy, scope_account, changes,
           ttl_seconds, revert_at, reason_codes, blast_radius_score,
           status, proposed_by)
        VALUES ($1, $2, $3, $4, $5, NOW() + ($5 * interval '1 second'),
                $6, $7, 'proposed', $8)
        RETURNING id, scope_symbol, scope_strategy, scope_account,
                  changes, ttl_seconds, revert_at, reason_codes,
                  blast_radius_score, status, proposed_by, created_at
      `;
      const result = await db.query(query, [
        args.scope_symbol ?? null,
        args.scope_strategy ?? null,
        args.scope_account ?? null,
        JSON.stringify(args.changes),
        args.ttl_seconds,
        args.reason_codes,
        args.blast_radius_score ?? 0.0,
        args.proposed_by ?? 'agent',
      ]);

      return jsonResult({
        success: true,
        patch: result.rows[0],
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return jsonResult({ success: false, error: msg }, true);
    }
  },
};

// =============================================================================
// Tool 3: mother_publish_incident (WRITE)
// =============================================================================

const motherPublishIncident: ToolSpec = {
  definition: {
    name: 'mother_publish_incident',
    description:
      'Publish a structured incident with tags, reason codes, and features. Used for postmortems and cross-project learning.',
    annotations: {
      title: 'Publish Incident',
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        incident_type: {
          type: 'string',
          description: 'Type of incident (e.g. "drawdown_breach", "regime_shift", "stop_cascade")',
        },
        symbol: { type: 'string', description: 'Affected symbol (optional)' },
        strategy: { type: 'string', description: 'Affected strategy (optional)' },
        features: {
          type: 'object',
          description: 'Structured evidence — metrics, thresholds, observations',
        },
        action_taken: {
          type: 'string',
          description: 'What action was taken in response',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Free-form tags for categorization',
        },
        reason_codes: {
          type: 'array',
          items: { type: 'string' },
          description: 'Reason codes from the Mother enum',
        },
        run_id: { type: 'string', description: 'Agent run ID for traceability' },
      },
      required: ['incident_type', 'action_taken', 'reason_codes'],
    },
  },
  handler: async (args: {
    incident_type: string;
    symbol?: string;
    strategy?: string;
    features?: Record<string, unknown>;
    action_taken: string;
    tags?: string[];
    reason_codes: string[];
    run_id?: string;
  }): Promise<ToolResult> => {
    try {
      // Validate reason codes
      for (const code of args.reason_codes) {
        if (!VALID_REASON_CODES.includes(code as any)) {
          return jsonResult({
            success: false,
            error: `Invalid reason_code "${code}". Valid: ${VALID_REASON_CODES.join(', ')}`,
          }, true);
        }
      }

      const db = getPool();
      const query = `
        INSERT INTO mother_incidents
          (incident_type, symbol, strategy, features, action_taken,
           tags, reason_codes, run_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id, incident_type, symbol, strategy, action_taken,
                  tags, reason_codes, run_id, created_at
      `;
      const result = await db.query(query, [
        args.incident_type,
        args.symbol ?? null,
        args.strategy ?? null,
        JSON.stringify(args.features ?? {}),
        args.action_taken,
        args.tags ?? [],
        args.reason_codes,
        args.run_id ?? null,
      ]);

      return jsonResult({
        success: true,
        incident: result.rows[0],
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return jsonResult({ success: false, error: msg }, true);
    }
  },
};

// =============================================================================
// Tool 4: mother_get_advice_snapshot (READ)
// =============================================================================

const motherGetAdviceSnapshot: ToolSpec = {
  definition: {
    name: 'mother_get_advice_snapshot',
    description:
      'Get the latest non-expired advice snapshot for a symbol×strategy pair. Returns null if no active snapshot exists.',
    annotations: {
      title: 'Get Advice Snapshot',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Trading symbol (e.g. BTCUSDT)' },
        strategy: { type: 'string', description: 'Strategy name' },
      },
      required: ['symbol', 'strategy'],
    },
  },
  handler: async (args: {
    symbol: string;
    strategy: string;
  }): Promise<ToolResult> => {
    try {
      const db = getPool();
      const query = `
        SELECT
          id, account, exchange, symbol, strategy, as_of,
          verdict, confidence_mult, size_mult, exit_aggressiveness_mult,
          risk_notes, evidence_refs, reason_codes, run_id,
          ttl_seconds, expires_at, created_at
        FROM mother_advice_snapshots
        WHERE symbol = $1
          AND strategy = $2
          AND (expires_at IS NULL OR expires_at > NOW())
        ORDER BY as_of DESC
        LIMIT 1
      `;
      const result = await db.query(query, [args.symbol, args.strategy]);

      return jsonResult({
        success: true,
        snapshot: result.rows[0] ?? null,
        active: result.rows.length > 0,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return jsonResult({ success: false, error: msg }, true);
    }
  },
};

// =============================================================================
// Tool 5: mother_list_incidents (READ)
// =============================================================================

const motherListIncidents: ToolSpec = {
  definition: {
    name: 'mother_list_incidents',
    description:
      'List incidents filtered by symbol, strategy, type, and/or date range. Returns most recent first.',
    annotations: {
      title: 'List Incidents',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Filter by symbol' },
        strategy: { type: 'string', description: 'Filter by strategy' },
        incident_type: { type: 'string', description: 'Filter by incident type' },
        since: {
          type: 'string',
          description: 'ISO date — only incidents after this time',
        },
        until: {
          type: 'string',
          description: 'ISO date — only incidents before this time',
        },
        limit: {
          type: 'number',
          description: 'Max results (default: 50)',
        },
      },
      required: [],
    },
  },
  handler: async (args: {
    symbol?: string;
    strategy?: string;
    incident_type?: string;
    since?: string;
    until?: string;
    limit?: number;
  }): Promise<ToolResult> => {
    try {
      const db = getPool();
      const limit = args.limit ?? 50;
      const query = `
        SELECT
          id, incident_type, symbol, strategy, features,
          action_taken, outcome, tags, reason_codes, run_id, created_at
        FROM mother_incidents
        WHERE ($1::text IS NULL OR symbol = $1)
          AND ($2::text IS NULL OR strategy = $2)
          AND ($3::text IS NULL OR incident_type = $3)
          AND ($4::timestamptz IS NULL OR created_at >= $4)
          AND ($5::timestamptz IS NULL OR created_at <= $5)
        ORDER BY created_at DESC
        LIMIT $6
      `;
      const result = await db.query(query, [
        args.symbol ?? null,
        args.strategy ?? null,
        args.incident_type ?? null,
        args.since ?? null,
        args.until ?? null,
        limit,
      ]);

      return jsonResult({
        success: true,
        incidents: result.rows,
        count: result.rows.length,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return jsonResult({ success: false, error: msg }, true);
    }
  },
};

// =============================================================================
// Export
// =============================================================================

export const motherTools: ToolSpec[] = [
  motherWriteAdviceSnapshot,
  motherProposePolicyPatch,
  motherPublishIncident,
  motherGetAdviceSnapshot,
  motherListIncidents,
];

// ============================================================================
// Extension manifest (EPIC-0038 Phase 7)
// ============================================================================
// This module is excluded from the published build (tsconfig.build.json) and
// is loaded only when its absolute path appears in `extensions.allow` in
// ~/.decibel/config.yaml. The facade spec lives here rather than in
// facades/definitions.ts so the public package does not carry a description of
// a private tool it can never call.

import type { DecibelExtension } from '../runtime/extensions.js';
import { RUNTIME_PROTOCOL_VERSION } from '../runtime/protocol.js';

export const extension: DecibelExtension = {
  manifest: {
    name: 'mother',
    version: '1.0.0',
    protocolVersion: RUNTIME_PROTOCOL_VERSION,
    tier: 'apps',
  },
  facades: [
    {
      name: 'mother',
      description: 'Mother daemon: advice snapshots, policy patches, and incidents. Reads from Postgres (requires MOTHER_DATABASE_URL). write_advice_snapshot validates verdict + multiplier bounds before inserting. propose_policy_patch auto-computes revert_at from TTL. publish_incident for structured postmortems. get_advice_snapshot reads latest non-expired for symbol×strategy. list_incidents queries by symbol/strategy/type/date range. Actions: write_advice_snapshot, propose_policy_patch, publish_incident, get_advice_snapshot, list_incidents',
      compactDescription: 'Mother daemon advice and incidents (Postgres)',
      microEligible: false,
      tier: 'apps',
      actions: {
        write_advice_snapshot: 'mother_write_advice_snapshot',
        propose_policy_patch: 'mother_propose_policy_patch',
        publish_incident: 'mother_publish_incident',
        get_advice_snapshot: 'mother_get_advice_snapshot',
        list_incidents: 'mother_list_incidents',
      },
    },
  ],
  tools: motherTools,
};
