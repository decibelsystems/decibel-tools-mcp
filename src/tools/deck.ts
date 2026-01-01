/**
 * Deck Tools - MTG Buylist Price Database
 *
 * Tools for searching and browsing Magic: The Gathering card buylist prices
 * from multiple stores. Data stored in Render Postgres (deck-db).
 *
 * Env var: DECK_DATABASE_URL
 */

import pg from 'pg';
import { ToolSpec, ToolResult } from './types.js';

const { Pool } = pg;

// Lazy-init pool
let pool: pg.Pool | null = null;

function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = process.env.DECK_DATABASE_URL;
    if (!connectionString) {
      throw new Error('DECK_DATABASE_URL environment variable not set');
    }
    pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false }, // Render requires SSL
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
// Tool Specs
// =============================================================================

const deckBuylistSearch: ToolSpec = {
  definition: {
    name: 'deck_buylist_search',
    description: 'Search MTG card buylist prices by card name. Returns prices from multiple stores.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Card name to search for (partial match, case-insensitive)',
        },
        store: {
          type: 'string',
          description: 'Optional: filter by specific store name',
        },
      },
      required: ['name'],
    },
  },
  handler: async (args: { name: string; store?: string }): Promise<ToolResult> => {
    try {
      const db = getPool();
      const query = `
        SELECT card_name, set_code, set_name, is_foil, nm_price, lp_price, mp_price, hp_price,
               store, scryfall_id
        FROM buylist_prices
        WHERE card_name ILIKE '%' || $1 || '%'
          AND ($2::text IS NULL OR store = $2)
        ORDER BY nm_price DESC NULLS LAST
        LIMIT 50
      `;
      const result = await db.query(query, [args.name, args.store || null]);
      return jsonResult({
        success: true,
        cards: result.rows,
        count: result.rows.length,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return jsonResult({ success: false, error: msg }, true);
    }
  },
};

const deckBuylistList: ToolSpec = {
  definition: {
    name: 'deck_buylist_list',
    description: 'List top buylist prices for a specific store, ordered by NM price descending.',
    inputSchema: {
      type: 'object',
      properties: {
        store: {
          type: 'string',
          description: 'Store name to list cards for',
        },
        limit: {
          type: 'number',
          description: 'Max cards to return (default: 50)',
        },
      },
      required: ['store'],
    },
  },
  handler: async (args: { store: string; limit?: number }): Promise<ToolResult> => {
    try {
      const db = getPool();
      const limit = args.limit || 50;
      const query = `
        SELECT card_name, set_code, set_name, is_foil, nm_price, lp_price, store
        FROM buylist_prices
        WHERE store = $1
        ORDER BY nm_price DESC NULLS LAST
        LIMIT $2
      `;
      const result = await db.query(query, [args.store, limit]);
      return jsonResult({
        success: true,
        cards: result.rows,
        count: result.rows.length,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return jsonResult({ success: false, error: msg }, true);
    }
  },
};

const deckBuylistStores: ToolSpec = {
  definition: {
    name: 'deck_buylist_stores',
    description: 'List all stores in the buylist database with card counts and last update time.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  handler: async (): Promise<ToolResult> => {
    try {
      const db = getPool();
      const query = `
        SELECT store, COUNT(*) as card_count, MAX(updated_at) as last_updated
        FROM buylist_prices
        GROUP BY store
        ORDER BY card_count DESC
      `;
      const result = await db.query(query);
      return jsonResult({
        success: true,
        stores: result.rows.map(row => ({
          store: row.store,
          card_count: parseInt(row.card_count, 10),
          last_updated: row.last_updated?.toISOString() || null,
        })),
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

export const deckTools: ToolSpec[] = [
  deckBuylistSearch,
  deckBuylistList,
  deckBuylistStores,
];
