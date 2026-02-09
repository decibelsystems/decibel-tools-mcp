/**
 * Senken Trade Tools — Mother/Senken trade database
 *
 * Tools for querying trade performance, giveback analysis, trade review,
 * and parameter override management.
 *
 * Env var: SENKEN_DATABASE_URL
 */

import pg from 'pg';
import type { ToolSpec, ToolResult } from './types.js';

const { Pool } = pg;

// Lazy-init pool
let pool: pg.Pool | null = null;

function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = process.env.SENKEN_DATABASE_URL;
    if (!connectionString) {
      throw new Error('SENKEN_DATABASE_URL environment variable not set');
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
// Helper
// =============================================================================

function jsonResult(data: unknown, isError = false): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    isError,
  };
}

// =============================================================================
// Tool 1: senken_trade_summary
// =============================================================================

const senkenTradeSummary: ToolSpec = {
  definition: {
    name: 'senken_trade_summary',
    description:
      'Aggregate trade performance from the Mother system. Returns count, win rate, avg R-multiple, total PnL grouped by strategy.',
    annotations: {
      title: 'Trade Summary',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        days: {
          type: 'number',
          description: 'Look-back window in days (default: 30)',
        },
        strategy: {
          type: 'string',
          description: 'Filter by strategy name',
        },
        symbol: {
          type: 'string',
          description: 'Filter by symbol',
        },
      },
      required: [],
    },
  },
  handler: async (args: {
    days?: number;
    strategy?: string;
    symbol?: string;
  }): Promise<ToolResult> => {
    try {
      const db = getPool();
      const days = args.days ?? 30;
      const query = `
        SELECT
          strategy,
          COUNT(*)::int AS trade_count,
          ROUND((COUNT(*) FILTER (WHERE r_multiple > 0)::numeric
                 / NULLIF(COUNT(*), 0) * 100), 1) AS win_rate_pct,
          ROUND(AVG(r_multiple)::numeric, 2) AS avg_r,
          ROUND(SUM(pnl)::numeric, 2) AS total_pnl
        FROM mother_trades
        WHERE closed_at >= NOW() - ($1 || ' days')::interval
          AND ($2::text IS NULL OR strategy = $2)
          AND ($3::text IS NULL OR symbol = $3)
        GROUP BY strategy
        ORDER BY total_pnl DESC
      `;
      const result = await db.query(query, [
        days,
        args.strategy || null,
        args.symbol || null,
      ]);

      return jsonResult({
        success: true,
        days,
        strategies: result.rows,
        total_trades: result.rows.reduce(
          (s: number, r: any) => s + r.trade_count,
          0,
        ),
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return jsonResult({ success: false, error: msg }, true);
    }
  },
};

// =============================================================================
// Tool 2: senken_giveback_report (WISH-0001)
// =============================================================================

const senkenGivebackReport: ToolSpec = {
  definition: {
    name: 'senken_giveback_report',
    description:
      'Analyse giveback — how much MFE (max favourable excursion) was captured vs. left on the table. Groups by strategy, symbol, and exit reason.',
    annotations: {
      title: 'Giveback Report',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        days: {
          type: 'number',
          description: 'Look-back window in days (default: 30)',
        },
        strategy: {
          type: 'string',
          description: 'Filter by strategy name',
        },
        limit: {
          type: 'number',
          description: 'Max rows per section (default: 20)',
        },
      },
      required: [],
    },
  },
  handler: async (args: {
    days?: number;
    strategy?: string;
    limit?: number;
  }): Promise<ToolResult> => {
    try {
      const db = getPool();
      const days = args.days ?? 30;
      const limit = args.limit ?? 20;

      // Strategy-level giveback breakdown
      const strategyQuery = `
        SELECT
          t.strategy,
          COUNT(*)::int AS trades,
          ROUND(AVG(s.max_favorable_excursion)::numeric, 2) AS avg_mfe,
          ROUND(AVG(t.r_multiple)::numeric, 2) AS avg_realized_r,
          ROUND(AVG(s.max_favorable_excursion - t.r_multiple)::numeric, 2) AS avg_giveback_r,
          ROUND((AVG((s.max_favorable_excursion - t.r_multiple)
                 / NULLIF(s.max_favorable_excursion, 0)) * 100)::numeric, 1) AS avg_giveback_pct
        FROM mother_trades t
        JOIN signal_outcomes s ON s.trade_id = t.id
        WHERE t.closed_at >= NOW() - ($1 || ' days')::interval
          AND ($2::text IS NULL OR t.strategy = $2)
        GROUP BY t.strategy
        ORDER BY avg_giveback_pct DESC
        LIMIT $3
      `;

      // Worst individual givebacks
      const worstQuery = `
        SELECT
          t.id, t.strategy, t.symbol, t.direction,
          ROUND(t.r_multiple::numeric, 2) AS realized_r,
          ROUND(s.max_favorable_excursion::numeric, 2) AS mfe,
          ROUND((s.max_favorable_excursion - t.r_multiple)::numeric, 2) AS giveback_r,
          t.exit_reason, t.closed_at
        FROM mother_trades t
        JOIN signal_outcomes s ON s.trade_id = t.id
        WHERE t.closed_at >= NOW() - ($1 || ' days')::interval
          AND ($2::text IS NULL OR t.strategy = $2)
          AND s.max_favorable_excursion > 0
        ORDER BY (s.max_favorable_excursion - t.r_multiple) DESC
        LIMIT $3
      `;

      // Exit reason distribution
      const exitQuery = `
        SELECT
          t.exit_reason,
          COUNT(*)::int AS trades,
          ROUND(AVG(s.max_favorable_excursion - t.r_multiple)::numeric, 2) AS avg_giveback_r
        FROM mother_trades t
        JOIN signal_outcomes s ON s.trade_id = t.id
        WHERE t.closed_at >= NOW() - ($1 || ' days')::interval
          AND ($2::text IS NULL OR t.strategy = $2)
        GROUP BY t.exit_reason
        ORDER BY avg_giveback_r DESC
      `;

      const [strategyResult, worstResult, exitResult] = await Promise.all([
        db.query(strategyQuery, [days, args.strategy || null, limit]),
        db.query(worstQuery, [days, args.strategy || null, limit]),
        db.query(exitQuery, [days, args.strategy || null]),
      ]);

      return jsonResult({
        success: true,
        days,
        by_strategy: strategyResult.rows,
        worst_givebacks: worstResult.rows,
        by_exit_reason: exitResult.rows,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return jsonResult({ success: false, error: msg }, true);
    }
  },
};

// =============================================================================
// Tool 3: senken_trade_review (WISH-0004)
// =============================================================================

const senkenTradeReview: ToolSpec = {
  definition: {
    name: 'senken_trade_review',
    description:
      'Review individual trades with counterfactual analysis. Grades A–F based on MFE capture percentage and suggests lessons.',
    annotations: {
      title: 'Trade Review',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        trade_id: {
          type: 'string',
          description: 'Specific trade ID to review',
        },
        last: {
          type: 'number',
          description: 'Review the last N trades (default: 5)',
        },
      },
      required: [],
    },
  },
  handler: async (args: {
    trade_id?: string;
    last?: number;
  }): Promise<ToolResult> => {
    try {
      const db = getPool();

      let query: string;
      let params: unknown[];

      if (args.trade_id) {
        query = `
          SELECT
            t.*, s.max_favorable_excursion AS mfe,
            s.max_adverse_excursion AS mae,
            s.time_to_mfe_minutes,
            s.metadata AS signal_metadata
          FROM mother_trades t
          LEFT JOIN signal_outcomes s ON s.trade_id = t.id
          WHERE t.id = $1
        `;
        params = [args.trade_id];
      } else {
        const last = args.last ?? 5;
        query = `
          SELECT
            t.*, s.max_favorable_excursion AS mfe,
            s.max_adverse_excursion AS mae,
            s.time_to_mfe_minutes,
            s.metadata AS signal_metadata
          FROM mother_trades t
          LEFT JOIN signal_outcomes s ON s.trade_id = t.id
          ORDER BY t.closed_at DESC
          LIMIT $1
        `;
        params = [last];
      }

      const result = await db.query(query, params);

      const reviews = result.rows.map((row: any) => {
        const mfe = row.mfe ?? 0;
        const realized = row.r_multiple ?? 0;
        const capturePct = mfe > 0 ? (realized / mfe) * 100 : realized > 0 ? 100 : 0;

        // Grade based on capture percentage
        let grade: string;
        if (capturePct >= 80) grade = 'A';
        else if (capturePct >= 60) grade = 'B';
        else if (capturePct >= 40) grade = 'C';
        else if (capturePct >= 20) grade = 'D';
        else grade = 'F';

        // Counterfactual exits at different thresholds
        const thresholds = [0.25, 0.5, 0.75, 1.0];
        const counterfactuals = thresholds
          .filter((t) => mfe >= t)
          .map((t) => ({
            exit_at_r: t,
            would_have_captured: mfe >= t,
            r_vs_actual: Math.round((t - realized) * 100) / 100,
          }));

        // Lesson suggestion
        let lesson: string;
        if (capturePct < 20 && mfe > 1) {
          lesson = 'Large MFE with minimal capture — consider tighter trailing stop';
        } else if (capturePct < 40) {
          lesson = 'Below-average capture — review exit timing relative to MFE';
        } else if (realized < 0 && mfe > 0.5) {
          lesson = 'Winning trade turned loser — add break-even stop after MFE threshold';
        } else {
          lesson = 'Acceptable execution';
        }

        return {
          id: row.id,
          strategy: row.strategy,
          symbol: row.symbol,
          direction: row.direction,
          entry_price: row.entry_price,
          exit_price: row.exit_price,
          r_multiple: Math.round((realized) * 100) / 100,
          pnl: row.pnl,
          exit_reason: row.exit_reason,
          mfe: Math.round(mfe * 100) / 100,
          mae: Math.round((row.mae ?? 0) * 100) / 100,
          capture_pct: Math.round(capturePct * 10) / 10,
          grade,
          counterfactuals,
          lesson,
          closed_at: row.closed_at,
        };
      });

      return jsonResult({
        success: true,
        reviews,
        count: reviews.length,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return jsonResult({ success: false, error: msg }, true);
    }
  },
};

// =============================================================================
// Tool 4: senken_list_overrides (WISH-0003, read side)
// =============================================================================

const senkenListOverrides: ToolSpec = {
  definition: {
    name: 'senken_list_overrides',
    description:
      'List active parameter overrides for Mother strategies. Shows current value, previous value, who applied, and when.',
    annotations: {
      title: 'List Overrides',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        strategy: {
          type: 'string',
          description: 'Filter by strategy name',
        },
      },
      required: [],
    },
  },
  handler: async (args: { strategy?: string }): Promise<ToolResult> => {
    try {
      const db = getPool();
      const query = `
        SELECT
          id, strategy, parameter, value, previous_value,
          reason, applied_by, applied_at
        FROM mother_overrides
        WHERE rolled_back_at IS NULL
          AND ($1::text IS NULL OR strategy = $1)
        ORDER BY applied_at DESC
      `;
      const result = await db.query(query, [args.strategy || null]);

      return jsonResult({
        success: true,
        overrides: result.rows,
        count: result.rows.length,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return jsonResult({ success: false, error: msg }, true);
    }
  },
};

// =============================================================================
// Tool 5: senken_apply_override (WISH-0003, write side)
// =============================================================================

const senkenApplyOverride: ToolSpec = {
  definition: {
    name: 'senken_apply_override',
    description:
      'Apply a parameter override to a Mother strategy. Records the change with changelog (previous value, timestamp, reason). This action is routed through the approval gate.',
    annotations: {
      title: 'Apply Override',
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        strategy: {
          type: 'string',
          description: 'Strategy name to override',
        },
        parameter: {
          type: 'string',
          description: 'Parameter name to override',
        },
        value: {
          type: 'string',
          description: 'New parameter value',
        },
        reason: {
          type: 'string',
          description: 'Reason for the override',
        },
      },
      required: ['strategy', 'parameter', 'value', 'reason'],
    },
  },
  handler: async (args: {
    strategy: string;
    parameter: string;
    value: string;
    reason: string;
  }): Promise<ToolResult> => {
    try {
      const db = getPool();

      // Get current value if one exists
      const currentQuery = `
        SELECT value FROM mother_overrides
        WHERE strategy = $1 AND parameter = $2 AND rolled_back_at IS NULL
        LIMIT 1
      `;
      const currentResult = await db.query(currentQuery, [
        args.strategy,
        args.parameter,
      ]);
      const previousValue = currentResult.rows[0]?.value ?? null;

      // Roll back existing override for this strategy+parameter
      if (previousValue !== null) {
        await db.query(
          `UPDATE mother_overrides
           SET rolled_back_at = NOW()
           WHERE strategy = $1 AND parameter = $2 AND rolled_back_at IS NULL`,
          [args.strategy, args.parameter],
        );
      }

      // Insert new override
      const insertQuery = `
        INSERT INTO mother_overrides
          (strategy, parameter, value, previous_value, reason, applied_by)
        VALUES ($1, $2, $3, $4, $5, 'agent')
        RETURNING id, strategy, parameter, value, previous_value, reason, applied_by, applied_at
      `;
      const result = await db.query(insertQuery, [
        args.strategy,
        args.parameter,
        args.value,
        previousValue,
        args.reason,
      ]);

      return jsonResult({
        success: true,
        override: result.rows[0],
        replaced_previous: previousValue !== null,
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

export const senkenTools: ToolSpec[] = [
  senkenTradeSummary,
  senkenGivebackReport,
  senkenTradeReview,
  senkenListOverrides,
  senkenApplyOverride,
];
