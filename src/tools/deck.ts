/**
 * Deck Tools - MTG Card Database (Supabase)
 *
 * Card catalog, price history, and market movers for Magic: The Gathering.
 * Data lives in the Core Supabase project (dqftcixhsvcjtyxsxoao).
 *
 * Env var: DECK_SUPABASE_KEY (service role or anon key — tables have public SELECT policies)
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { ToolSpec, ToolResult } from './types.js';

const CORE_SUPABASE_URL = 'https://dqftcixhsvcjtyxsxoao.supabase.co';
// Anon key for public read access (all deck tables have public SELECT RLS policies)
const CORE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRxZnRjaXhoc3ZjanR5eHN4b2FvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjcyMTgzMTYsImV4cCI6MjA4Mjc5NDMxNn0.erZq0zJMF-tATX7b0mofGsajFUvcqlZE5PQ4qcggmGc';

// Lazy-init client
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

// =============================================================================
// Helpers
// =============================================================================

function jsonResult(data: unknown, isError = false): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    isError,
  };
}

/**
 * Fallback to Scryfall API when a card isn't found in the local database.
 * Returns results shaped like the Supabase cards table for consistency.
 */
async function scryfallSearch(
  name: string,
  setCode?: string
): Promise<Array<Record<string, unknown>>> {
  let query = `name:${name}`;
  if (setCode) query += ` set:${setCode}`;
  const url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&order=usd&dir=desc`;

  const res = await fetch(url);
  if (!res.ok) return [];

  const json = (await res.json()) as {
    data?: Array<Record<string, unknown>>;
  };
  if (!json.data?.length) return [];

  return json.data.slice(0, 50).map((card: Record<string, unknown>) => ({
    name: card.name,
    set_code: card.set,
    set_name: card.set_name,
    rarity: card.rarity,
    price_usd: (card.prices as Record<string, unknown>)?.usd ?? null,
    price_usd_foil: (card.prices as Record<string, unknown>)?.usd_foil ?? null,
    legalities: card.legalities,
    scryfall_id: card.id,
    image_uri:
      (card.image_uris as Record<string, unknown>)?.normal ??
      (card.image_uris as Record<string, unknown>)?.large ??
      null,
    type_line: card.type_line,
    mana_cost: card.mana_cost,
    source: 'scryfall',
  }));
}

// =============================================================================
// Validation Helpers
// =============================================================================

const VALID_FORMATS = [
  'standard', 'modern', 'pioneer', 'commander', 'legacy', 'vintage',
  'pauper', 'historic', 'explorer', 'brawl', 'alchemy', 'penny', 'oathbreaker',
] as const;

const VALID_RARITIES = ['common', 'uncommon', 'rare', 'mythic'] as const;

function validateFormat(format: string): string {
  const f = format.toLowerCase();
  if (!(VALID_FORMATS as readonly string[]).includes(f)) {
    throw new Error(`Invalid format "${format}". Valid: ${VALID_FORMATS.join(', ')}`);
  }
  return f;
}

function validateRarity(rarity: string): string {
  const r = rarity.toLowerCase();
  if (!(VALID_RARITIES as readonly string[]).includes(r)) {
    throw new Error(`Invalid rarity "${rarity}". Valid: ${VALID_RARITIES.join(', ')}`);
  }
  return r;
}

/** Grade price stability from coefficient of variation */
function gradeStability(cv: number): { grade: string; label: string } {
  if (cv < 5) return { grade: 'A', label: 'Very Stable' };
  if (cv < 10) return { grade: 'B', label: 'Stable' };
  if (cv < 20) return { grade: 'C', label: 'Moderate' };
  if (cv < 35) return { grade: 'D', label: 'Volatile' };
  return { grade: 'F', label: 'Highly Volatile' };
}

// =============================================================================
// Tool Specs
// =============================================================================

const deckSearch: ToolSpec = {
  definition: {
    name: 'deck_search',
    description:
      'Search MTG cards by name. Returns card details with current prices.',
    annotations: {
      title: 'Search Cards',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description:
            'Card name to search for (partial match, case-insensitive)',
        },
        set_code: {
          type: 'string',
          description: 'Optional: filter by set code (e.g. "MH3", "LCI")',
        },
      },
      required: ['name'],
    },
  },
  handler: async (args: {
    name: string;
    set_code?: string;
  }): Promise<ToolResult> => {
    try {
      const db = getClient();
      let query = db
        .from('cards')
        .select(
          'name, set_code, set_name, rarity, price_usd, price_usd_foil, legalities, scryfall_id, image_uri, type_line, mana_cost'
        )
        .ilike('name', `%${args.name}%`)
        .order('price_usd', { ascending: false, nullsFirst: false })
        .limit(50);

      if (args.set_code) {
        query = query.eq('set_code', args.set_code.toLowerCase());
      }

      const { data, error } = await query;
      if (error) throw new Error(error.message);

      // Fallback to Scryfall API when local DB returns no results
      if (!data || data.length === 0) {
        const fallback = await scryfallSearch(args.name, args.set_code);
        return jsonResult({
          success: true,
          cards: fallback,
          count: fallback.length,
          source: fallback.length > 0 ? 'scryfall_fallback' : 'none',
        });
      }

      return jsonResult({
        success: true,
        cards: data,
        count: data.length,
        source: 'database',
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return jsonResult({ success: false, error: msg }, true);
    }
  },
};

const deckList: ToolSpec = {
  definition: {
    name: 'deck_list',
    description:
      'List top price movers for a given period. Returns cards with the biggest price changes (gainers and losers).',
    annotations: {
      title: 'Top Movers',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        period: {
          type: 'string',
          description:
            'Time period for price changes (default: "7d"). E.g. "1d", "7d", "30d"',
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
    period?: string;
    limit?: number;
  }): Promise<ToolResult> => {
    try {
      const db = getClient();
      const period = args.period || '7d';
      const limit = args.limit || 50;

      // Fetch movers — grab extra to cover abs() sorting
      const { data: movers, error: moversErr } = await db
        .from('price_movers')
        .select(
          'scryfall_id, period, price_from, price_to, change_pct, computed_at'
        )
        .eq('period', period)
        .order('change_pct', { ascending: false })
        .limit(limit * 2);

      if (moversErr) throw new Error(moversErr.message);
      if (!movers || movers.length === 0) {
        return jsonResult({ success: true, movers: [], count: 0, period });
      }

      // Sort by abs(change_pct), take top N
      movers.sort(
        (a: Record<string, unknown>, b: Record<string, unknown>) =>
          Math.abs(b.change_pct as number) - Math.abs(a.change_pct as number)
      );
      const topMovers = movers.slice(0, limit);

      // Batch-lookup card names
      const ids = topMovers.map(
        (m: Record<string, unknown>) => m.scryfall_id as string
      );
      const { data: cards, error: cardsErr } = await db
        .from('cards')
        .select('scryfall_id, name, set_code')
        .in('scryfall_id', ids);

      if (cardsErr) throw new Error(cardsErr.message);

      const cardMap = new Map(
        (cards || []).map((c: Record<string, unknown>) => [
          c.scryfall_id as string,
          c,
        ])
      );

      const results = topMovers.map((m: Record<string, unknown>) => {
        const card = cardMap.get(m.scryfall_id as string) as
          | Record<string, unknown>
          | undefined;
        return {
          name: (card?.name as string) || 'Unknown',
          set_code: (card?.set_code as string) || '',
          price_from: m.price_from,
          price_to: m.price_to,
          change_pct: m.change_pct,
          computed_at: m.computed_at,
        };
      });

      return jsonResult({
        success: true,
        movers: results,
        count: results.length,
        period,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return jsonResult({ success: false, error: msg }, true);
    }
  },
};

const deckSummary: ToolSpec = {
  definition: {
    name: 'deck_summary',
    description:
      'Get a summary of the card database: card count, price sources, last update time, available mover periods.',
    annotations: {
      title: 'Data Summary',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  handler: async (): Promise<ToolResult> => {
    try {
      const db = getClient();

      const [cardCount, sources, latestUpdate, periods] = await Promise.all([
        db.from('cards').select('*', { count: 'exact', head: true }),
        db.from('price_history').select('source').limit(1000),
        db
          .from('cards')
          .select('price_updated_at')
          .order('price_updated_at', { ascending: false })
          .limit(1),
        db.from('price_movers').select('period').limit(1000),
      ]);

      const distinctSources = [
        ...new Set(
          (sources.data || []).map(
            (r: Record<string, unknown>) => r.source as string
          )
        ),
      ];
      const distinctPeriods = [
        ...new Set(
          (periods.data || []).map(
            (r: Record<string, unknown>) => r.period as string
          )
        ),
      ];

      return jsonResult({
        success: true,
        summary: {
          card_count: cardCount.count || 0,
          price_sources: distinctSources,
          latest_price_update:
            (
              latestUpdate.data?.[0] as Record<string, unknown> | undefined
            )?.price_updated_at || null,
          available_periods: distinctPeriods,
        },
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return jsonResult({ success: false, error: msg }, true);
    }
  },
};

const deckHistory: ToolSpec = {
  definition: {
    name: 'deck_history',
    description:
      'Get price history for a specific card. Accepts scryfall_id or card name. Returns up to 90 days of price data.',
    annotations: {
      title: 'Price History',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        scryfall_id: {
          type: 'string',
          description: 'Scryfall UUID of the card',
        },
        name: {
          type: 'string',
          description:
            'Card name (exact match preferred; used if scryfall_id not provided)',
        },
        limit: {
          type: 'number',
          description: 'Max rows (default: 90 — ~3 months)',
        },
      },
      required: [],
    },
  },
  handler: async (args: {
    scryfall_id?: string;
    name?: string;
    limit?: number;
  }): Promise<ToolResult> => {
    try {
      if (!args.scryfall_id && !args.name) {
        return jsonResult(
          { success: false, error: 'Provide either scryfall_id or name' },
          true
        );
      }

      const db = getClient();
      const limit = args.limit || 90;
      let scryfallId = args.scryfall_id;

      // Resolve name → scryfall_id if needed
      if (!scryfallId && args.name) {
        const { data: cards, error: cardErr } = await db
          .from('cards')
          .select('scryfall_id, name')
          .ilike('name', args.name)
          .limit(1);

        if (cardErr) throw new Error(cardErr.message);
        if (!cards || cards.length === 0) {
          return jsonResult(
            { success: false, error: `Card not found: ${args.name}` },
            true
          );
        }
        scryfallId = (cards[0] as Record<string, unknown>)
          .scryfall_id as string;
      }

      const { data, error } = await db
        .from('price_history')
        .select('date, price_usd, price_usd_foil, source')
        .eq('scryfall_id', scryfallId!)
        .order('date', { ascending: false })
        .limit(limit);

      if (error) throw new Error(error.message);

      return jsonResult({
        success: true,
        scryfall_id: scryfallId,
        history: data,
        count: data?.length || 0,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return jsonResult({ success: false, error: msg }, true);
    }
  },
};

// =============================================================================
// Tool 5: Format Deals
// =============================================================================

const deckFormatDeals: ToolSpec = {
  definition: {
    name: 'deck_format_deals',
    description:
      'Find underpriced cards legal in a specific format. Great for budget deck building.',
    annotations: {
      title: 'Format Deals',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        format: {
          type: 'string',
          description: `Format to check legality (${VALID_FORMATS.join(', ')})`,
        },
        max_price: {
          type: 'number',
          description: 'Maximum price in USD (default: no limit)',
        },
        min_price: {
          type: 'number',
          description: 'Minimum price in USD (default: 0.01 to skip bulk)',
        },
        rarity: {
          type: 'string',
          description: 'Filter by rarity (common, uncommon, rare, mythic)',
        },
        sort_by: {
          type: 'string',
          description: 'Sort order: price_asc (default) or price_desc',
        },
        limit: {
          type: 'number',
          description: 'Max results (default: 50, max: 200)',
        },
      },
      required: ['format'],
    },
  },
  handler: async (args: {
    format: string;
    max_price?: number;
    min_price?: number;
    rarity?: string;
    sort_by?: string;
    limit?: number;
  }): Promise<ToolResult> => {
    try {
      const format = validateFormat(args.format);
      const minPrice = args.min_price ?? 0.01;
      const limit = Math.min(args.limit || 50, 200);
      const ascending = (args.sort_by || 'price_asc') === 'price_asc';

      const db = getClient();
      let query = db
        .from('cards')
        .select('name, set_code, set_name, rarity, price_usd, type_line, mana_cost, scryfall_id')
        .filter(`legalities->>${format}`, 'eq', 'legal')
        .gte('price_usd', minPrice)
        .order('price_usd', { ascending, nullsFirst: false })
        .limit(limit);

      if (args.max_price != null) {
        query = query.lte('price_usd', args.max_price);
      }
      if (args.rarity) {
        query = query.eq('rarity', validateRarity(args.rarity));
      }

      const { data, error } = await query;
      if (error) throw new Error(error.message);

      return jsonResult({
        success: true,
        format,
        cards: data,
        count: data?.length || 0,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return jsonResult({ success: false, error: msg }, true);
    }
  },
};

// =============================================================================
// Tool 6: Type Search
// =============================================================================

const deckTypeSearch: ToolSpec = {
  definition: {
    name: 'deck_type_search',
    description:
      'Search cards by type line for tribal/archetype building (e.g. Elf, Planeswalker, Equipment).',
    annotations: {
      title: 'Type Search',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: 'Type to search for (e.g. "Elf", "Planeswalker", "Equipment")',
        },
        format: {
          type: 'string',
          description: 'Filter by format legality',
        },
        max_price: {
          type: 'number',
          description: 'Maximum price in USD',
        },
        min_price: {
          type: 'number',
          description: 'Minimum price in USD',
        },
        set_code: {
          type: 'string',
          description: 'Filter by set code (e.g. "MH3")',
        },
        limit: {
          type: 'number',
          description: 'Max results (default: 50, max: 200)',
        },
      },
      required: ['type'],
    },
  },
  handler: async (args: {
    type: string;
    format?: string;
    max_price?: number;
    min_price?: number;
    set_code?: string;
    limit?: number;
  }): Promise<ToolResult> => {
    try {
      const limit = Math.min(args.limit || 50, 200);
      const db = getClient();

      let query = db
        .from('cards')
        .select('name, set_code, set_name, rarity, price_usd, type_line, mana_cost, scryfall_id')
        .ilike('type_line', `%${args.type}%`)
        .order('price_usd', { ascending: false, nullsFirst: false })
        .limit(limit);

      if (args.format) {
        const format = validateFormat(args.format);
        query = query.filter(`legalities->>${format}`, 'eq', 'legal');
      }
      if (args.max_price != null) {
        query = query.lte('price_usd', args.max_price);
      }
      if (args.min_price != null) {
        query = query.gte('price_usd', args.min_price);
      }
      if (args.set_code) {
        query = query.eq('set_code', args.set_code.toLowerCase());
      }

      const { data, error } = await query;
      if (error) throw new Error(error.message);

      return jsonResult({
        success: true,
        type: args.type,
        cards: data,
        count: data?.length || 0,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return jsonResult({ success: false, error: msg }, true);
    }
  },
};

// =============================================================================
// Tool 7: Price Bracket
// =============================================================================

const deckPriceBracket: ToolSpec = {
  definition: {
    name: 'deck_price_bracket',
    description:
      'Multi-filter power search: combine price range, rarity, format, set, and type filters.',
    annotations: {
      title: 'Price Bracket',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        min_price: { type: 'number', description: 'Minimum price in USD' },
        max_price: { type: 'number', description: 'Maximum price in USD' },
        rarity: { type: 'string', description: 'Card rarity filter' },
        format: { type: 'string', description: 'Format legality filter' },
        set_code: { type: 'string', description: 'Set code filter' },
        type_line: { type: 'string', description: 'Type line filter (partial match)' },
        sort_by: {
          type: 'string',
          description: 'Sort: price_desc (default), price_asc, name',
        },
        limit: { type: 'number', description: 'Max results (default: 50, max: 200)' },
      },
      required: [],
    },
  },
  handler: async (args: {
    min_price?: number;
    max_price?: number;
    rarity?: string;
    format?: string;
    set_code?: string;
    type_line?: string;
    sort_by?: string;
    limit?: number;
  }): Promise<ToolResult> => {
    try {
      const hasFilter =
        args.min_price != null ||
        args.max_price != null ||
        args.rarity ||
        args.format ||
        args.set_code ||
        args.type_line;
      if (!hasFilter) {
        return jsonResult(
          { success: false, error: 'Provide at least one filter (min_price, max_price, rarity, format, set_code, type_line)' },
          true
        );
      }

      const limit = Math.min(args.limit || 50, 200);
      const db = getClient();
      const filtersApplied: string[] = [];

      let query = db
        .from('cards')
        .select('name, set_code, set_name, rarity, price_usd, type_line, mana_cost, scryfall_id')
        .limit(limit);

      if (args.min_price != null) {
        query = query.gte('price_usd', args.min_price);
        filtersApplied.push(`min_price=${args.min_price}`);
      }
      if (args.max_price != null) {
        query = query.lte('price_usd', args.max_price);
        filtersApplied.push(`max_price=${args.max_price}`);
      }
      if (args.rarity) {
        query = query.eq('rarity', validateRarity(args.rarity));
        filtersApplied.push(`rarity=${args.rarity}`);
      }
      if (args.format) {
        const format = validateFormat(args.format);
        query = query.filter(`legalities->>${format}`, 'eq', 'legal');
        filtersApplied.push(`format=${format}`);
      }
      if (args.set_code) {
        query = query.eq('set_code', args.set_code.toLowerCase());
        filtersApplied.push(`set_code=${args.set_code}`);
      }
      if (args.type_line) {
        query = query.ilike('type_line', `%${args.type_line}%`);
        filtersApplied.push(`type_line~${args.type_line}`);
      }

      // Sort
      const sortBy = args.sort_by || 'price_desc';
      if (sortBy === 'price_asc') {
        query = query.order('price_usd', { ascending: true, nullsFirst: false });
      } else if (sortBy === 'name') {
        query = query.order('name', { ascending: true });
      } else {
        query = query.order('price_usd', { ascending: false, nullsFirst: false });
      }

      const { data, error } = await query;
      if (error) throw new Error(error.message);

      return jsonResult({
        success: true,
        filters_applied: filtersApplied,
        cards: data,
        count: data?.length || 0,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return jsonResult({ success: false, error: msg }, true);
    }
  },
};

// =============================================================================
// Tool 8: Set Analysis
// =============================================================================

const deckSetAnalysis: ToolSpec = {
  definition: {
    name: 'deck_set_analysis',
    description:
      'Aggregate price stats for a set: EV breakdown by rarity, top cards, cheapest mythics.',
    annotations: {
      title: 'Set Analysis',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        set_code: {
          type: 'string',
          description: 'Set code (e.g. "MH3", "LCI", "ONE")',
        },
      },
      required: ['set_code'],
    },
  },
  handler: async (args: { set_code: string }): Promise<ToolResult> => {
    try {
      const db = getClient();
      const setCode = args.set_code.toLowerCase();

      // Use the deck_set_stats SQL function for efficient server-side aggregation
      const { data: stats, error: statsErr } = await db.rpc('deck_set_stats', {
        p_set_code: setCode,
      });

      if (statsErr) throw new Error(statsErr.message);

      if (!stats || (stats as unknown[]).length === 0) {
        return jsonResult(
          { success: false, error: `No cards found for set "${args.set_code}"` },
          true
        );
      }

      const row = (stats as Record<string, unknown>[])[0];

      // Also fetch top 10 most expensive for detail
      const { data: topCards, error: topErr } = await db
        .from('cards')
        .select('name, rarity, price_usd')
        .eq('set_code', setCode)
        .not('price_usd', 'is', null)
        .gt('price_usd', 0)
        .order('price_usd', { ascending: false, nullsFirst: false })
        .limit(10);

      if (topErr) throw new Error(topErr.message);

      return jsonResult({
        success: true,
        set_code: row.set_code,
        set_name: row.set_name,
        total_cards: row.total_cards,
        cards_with_price: row.cards_with_price,
        total_value: row.total_value,
        avg_price: row.avg_price,
        median_price: row.median_price,
        max_price: row.max_price,
        max_price_card: row.max_price_card,
        rarity_averages: {
          mythic: row.mythic_avg,
          rare: row.rare_avg,
          uncommon: row.uncommon_avg,
          common: row.common_avg,
        },
        cheapest_mythic: row.cheapest_mythic_name
          ? { name: row.cheapest_mythic_name, price: row.cheapest_mythic_price }
          : null,
        top_10_expensive: topCards || [],
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return jsonResult({ success: false, error: msg }, true);
    }
  },
};

// =============================================================================
// Tool 9: Volatility
// =============================================================================

const deckVolatility: ToolSpec = {
  definition: {
    name: 'deck_volatility',
    description:
      'Price volatility scoring. Broad scan (no name) finds most volatile cards. Single card mode (with name/scryfall_id) gives detailed stability analysis with A-F grade.',
    annotations: {
      title: 'Volatility',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Card name for single-card analysis (omit for broad scan)',
        },
        scryfall_id: {
          type: 'string',
          description: 'Scryfall UUID for single-card analysis',
        },
        min_price: {
          type: 'number',
          description: 'Minimum price filter for broad scan (default: 1.00)',
        },
        days: {
          type: 'number',
          description: 'History window for single-card mode (default: 90)',
        },
        limit: {
          type: 'number',
          description: 'Max results for broad scan (default: 25, max: 100)',
        },
      },
      required: [],
    },
  },
  handler: async (args: {
    name?: string;
    scryfall_id?: string;
    min_price?: number;
    days?: number;
    limit?: number;
  }): Promise<ToolResult> => {
    try {
      const db = getClient();

      // ── Single card mode ──
      if (args.name || args.scryfall_id) {
        let scryfallId = args.scryfall_id;

        // Resolve name → scryfall_id
        if (!scryfallId && args.name) {
          const { data: cards, error: cardErr } = await db
            .from('cards')
            .select('scryfall_id, name, price_usd')
            .ilike('name', args.name)
            .limit(1);
          if (cardErr) throw new Error(cardErr.message);
          if (!cards || cards.length === 0) {
            return jsonResult(
              { success: false, error: `Card not found: ${args.name}` },
              true
            );
          }
          scryfallId = (cards[0] as Record<string, unknown>).scryfall_id as string;
        }

        const days = args.days || 90;

        // Fetch price history and movers in parallel
        const [historyRes, moversRes] = await Promise.all([
          db
            .from('price_history')
            .select('date, price_usd')
            .eq('scryfall_id', scryfallId!)
            .order('date', { ascending: false })
            .limit(days),
          db
            .from('price_movers')
            .select('period, price_from, price_to, change_pct')
            .eq('scryfall_id', scryfallId!),
        ]);

        if (historyRes.error) throw new Error(historyRes.error.message);

        const prices = ((historyRes.data || []) as Record<string, unknown>[])
          .map((r) => r.price_usd as number | null)
          .filter((p): p is number => p != null && p > 0);

        if (prices.length < 2) {
          return jsonResult({
            success: true,
            mode: 'single',
            scryfall_id: scryfallId,
            message: 'Not enough price history for volatility analysis',
            data_points: prices.length,
          });
        }

        const mean = prices.reduce((s, p) => s + p, 0) / prices.length;
        const variance =
          prices.reduce((s, p) => s + (p - mean) ** 2, 0) / prices.length;
        const stddev = Math.sqrt(variance);
        const cv = (stddev / mean) * 100; // coefficient of variation as %
        const stability = gradeStability(cv);

        const trend =
          prices.length >= 2
            ? prices[0] > prices[prices.length - 1]
              ? 'rising'
              : prices[0] < prices[prices.length - 1]
                ? 'falling'
                : 'flat'
            : 'unknown';

        return jsonResult({
          success: true,
          mode: 'single',
          scryfall_id: scryfallId,
          data_points: prices.length,
          stats: {
            mean: Math.round(mean * 100) / 100,
            stddev: Math.round(stddev * 100) / 100,
            coefficient_of_variation: Math.round(cv * 100) / 100,
            min: Math.min(...prices),
            max: Math.max(...prices),
            range: Math.round((Math.max(...prices) - Math.min(...prices)) * 100) / 100,
            trend,
          },
          stability_grade: stability.grade,
          stability_label: stability.label,
          recent_movers: moversRes.data || [],
        });
      }

      // ── Broad scan mode — use SQL function for real CV-based volatility ──
      const minPrice = args.min_price ?? 1.0;
      const limit = Math.min(args.limit || 25, 100);
      const days = args.days || 30;

      const { data: volData, error: volErr } = await db.rpc(
        'deck_volatility_scores',
        { p_days: days, p_min_price: minPrice, p_limit: limit }
      );

      if (volErr) throw new Error(volErr.message);

      const results = ((volData || []) as Record<string, unknown>[]).map((r) => ({
        name: r.name,
        set_code: r.set_code,
        rarity: r.rarity,
        scryfall_id: r.scryfall_id,
        current_price: r.current_price,
        avg_price: r.avg_price,
        stddev: r.stddev_price,
        price_range: { min: r.min_price, max: r.max_price },
        cv_pct: r.cv_pct,
        stability: gradeStability(Number(r.cv_pct) || 0),
        data_points: r.data_points,
      }));

      return jsonResult({
        success: true,
        mode: 'broad',
        days,
        min_price_filter: minPrice,
        cards: results,
        count: results.length,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return jsonResult({ success: false, error: msg }, true);
    }
  },
};

// =============================================================================
// Tool 10: Reprints
// =============================================================================

const deckReprints: ToolSpec = {
  definition: {
    name: 'deck_reprints',
    description:
      'Cross-printing price comparison and arbitrage finder. Shows all printings of a card sorted by price.',
    annotations: {
      title: 'Reprints',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Card name (exact match, case-insensitive)',
        },
      },
      required: ['name'],
    },
  },
  handler: async (args: { name: string }): Promise<ToolResult> => {
    try {
      const db = getClient();

      // Exact match (case-insensitive, no wildcards)
      const { data, error } = await db
        .from('cards')
        .select(
          'name, set_code, set_name, rarity, price_usd, price_usd_foil, scryfall_id, image_uri'
        )
        .ilike('name', args.name)
        .order('price_usd', { ascending: true, nullsFirst: false })
        .limit(100);

      if (error) throw new Error(error.message);

      // No exact match — try partial for suggestions
      if (!data || data.length === 0) {
        const { data: suggestions, error: sugErr } = await db
          .from('cards')
          .select('name')
          .ilike('name', `%${args.name}%`)
          .limit(20);

        if (sugErr) throw new Error(sugErr.message);

        const uniqueNames = [...new Set(
          (suggestions || []).map((s: Record<string, unknown>) => s.name as string)
        )].slice(0, 5);

        return jsonResult({
          success: false,
          error: `No exact match for "${args.name}"`,
          suggestions: uniqueNames.length > 0 ? uniqueNames : undefined,
        }, true);
      }

      type CardRow = Record<string, unknown>;
      const printings = data as CardRow[];

      // Compute summary stats
      const priced = printings.filter(
        (c) => (c.price_usd as number | null) != null && (c.price_usd as number) > 0
      );
      const prices = priced.map((c) => c.price_usd as number);

      const summary =
        prices.length > 0
          ? {
              total_printings: printings.length,
              priced_printings: prices.length,
              cheapest: Math.min(...prices),
              most_expensive: Math.max(...prices),
              price_spread: Math.round((Math.max(...prices) - Math.min(...prices)) * 100) / 100,
              average_price: Math.round((prices.reduce((s, p) => s + p, 0) / prices.length) * 100) / 100,
            }
          : {
              total_printings: printings.length,
              priced_printings: 0,
              cheapest: null,
              most_expensive: null,
              price_spread: null,
              average_price: null,
            };

      return jsonResult({
        success: true,
        name: (printings[0] as CardRow).name,
        summary,
        printings: printings.map((c) => ({
          set_code: c.set_code,
          set_name: c.set_name,
          rarity: c.rarity,
          price_usd: c.price_usd,
          price_usd_foil: c.price_usd_foil,
          scryfall_id: c.scryfall_id,
        })),
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return jsonResult({ success: false, error: msg }, true);
    }
  },
};

// =============================================================================
// Tool 11: Match History
// =============================================================================

const deckMatchHistory: ToolSpec = {
  definition: {
    name: 'deck_match_history',
    description:
      'Recent MTG Arena match history. Returns opponent, format, result, deck, duration.',
    annotations: {
      title: 'Match History',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Max results (default: 20, max: 100)',
        },
        format: {
          type: 'string',
          description: 'Optional: filter by format (e.g. "Standard", "Historic")',
        },
      },
      required: [],
    },
  },
  handler: async (args: {
    limit?: number;
    format?: string;
  }): Promise<ToolResult> => {
    try {
      const db = getClient();
      const limit = Math.min(args.limit || 20, 100);

      let query = db
        .from('match_summary')
        .select('match_id, opponent, format, result, deck_name, duration_seconds, started_at')
        .order('started_at_ms', { ascending: false })
        .limit(limit);

      if (args.format) {
        query = query.ilike('format', args.format);
      }

      const { data, error } = await query;
      if (error) throw new Error(error.message);

      return jsonResult({
        success: true,
        matches: data || [],
        count: (data || []).length,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return jsonResult({ success: false, error: msg }, true);
    }
  },
};

// =============================================================================
// Tool 12: Win Rate
// =============================================================================

const deckWinRate: ToolSpec = {
  definition: {
    name: 'deck_win_rate',
    description:
      'Win rate statistics grouped by format. Includes overall stats and current streak.',
    annotations: {
      title: 'Win Rate',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        format: {
          type: 'string',
          description: 'Optional: filter to a specific format',
        },
      },
      required: [],
    },
  },
  handler: async (args: {
    format?: string;
  }): Promise<ToolResult> => {
    try {
      const db = getClient();

      let query = db
        .from('match_summary')
        .select('format, result, started_at_ms')
        .order('started_at_ms', { ascending: false });

      if (args.format) {
        query = query.ilike('format', args.format);
      }

      const { data, error } = await query;
      if (error) throw new Error(error.message);

      const matches = (data || []) as Record<string, unknown>[];

      // Group by format
      const byFormat = new Map<string, { wins: number; losses: number; draws: number; results: string[] }>();
      for (const m of matches) {
        const fmt = (m.format as string) || 'Unknown';
        if (!byFormat.has(fmt)) byFormat.set(fmt, { wins: 0, losses: 0, draws: 0, results: [] });
        const bucket = byFormat.get(fmt)!;
        const result = (m.result as string) || '';
        if (result === 'win') bucket.wins++;
        else if (result === 'loss' || result === 'concede') bucket.losses++;
        else bucket.draws++;
        bucket.results.push(result);
      }

      // Compute current streak from all matches (chronological, most recent first)
      const allResults = matches.map((m) => m.result as string);
      let streak = 0;
      const streakType = allResults[0] === 'win' ? 'W' : allResults[0] === 'loss' || allResults[0] === 'concede' ? 'L' : 'D';
      for (const r of allResults) {
        const rType = r === 'win' ? 'W' : r === 'loss' || r === 'concede' ? 'L' : 'D';
        if (rType === streakType) streak++;
        else break;
      }

      const formatStats = Array.from(byFormat.entries()).map(([fmt, b]) => {
        const total = b.wins + b.losses + b.draws;
        return {
          format: fmt,
          total,
          wins: b.wins,
          losses: b.losses,
          draws: b.draws,
          win_rate: total > 0 ? Math.round((b.wins / total) * 10000) / 100 : 0,
        };
      });

      // Overall
      const totalWins = formatStats.reduce((s, f) => s + f.wins, 0);
      const totalLosses = formatStats.reduce((s, f) => s + f.losses, 0);
      const totalDraws = formatStats.reduce((s, f) => s + f.draws, 0);
      const totalAll = totalWins + totalLosses + totalDraws;

      return jsonResult({
        success: true,
        overall: {
          total: totalAll,
          wins: totalWins,
          losses: totalLosses,
          draws: totalDraws,
          win_rate: totalAll > 0 ? Math.round((totalWins / totalAll) * 10000) / 100 : 0,
          current_streak: `${streak}${streakType}`,
        },
        by_format: formatStats,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return jsonResult({ success: false, error: msg }, true);
    }
  },
};

// =============================================================================
// Tool 13: Card Performance
// =============================================================================

const deckCardPerformance: ToolSpec = {
  definition: {
    name: 'deck_card_performance',
    description:
      'Best and worst cards by win rate. Requires minimum match threshold to filter noise.',
    annotations: {
      title: 'Card Performance',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        format: {
          type: 'string',
          description: 'Optional: filter by format',
        },
        min_matches: {
          type: 'number',
          description: 'Minimum matches to include (default: 3)',
        },
        sort: {
          type: 'string',
          description: 'Sort order: "win_rate desc" (default), "win_rate asc", "matches desc"',
        },
        limit: {
          type: 'number',
          description: 'Max results (default: 20, max: 100)',
        },
      },
      required: [],
    },
  },
  handler: async (args: {
    format?: string;
    min_matches?: number;
    sort?: string;
    limit?: number;
  }): Promise<ToolResult> => {
    try {
      const db = getClient();
      const minMatches = args.min_matches || 3;
      const limit = Math.min(args.limit || 20, 100);

      let query = db
        .from('card_win_rates')
        .select('name, format, matches, wins, losses, win_rate, set_code')
        .gte('matches', minMatches);

      if (args.format) {
        query = query.ilike('format', args.format);
      }

      // Sort
      const sort = (args.sort || 'win_rate desc').toLowerCase();
      if (sort === 'win_rate asc') {
        query = query.order('win_rate', { ascending: true }).order('matches', { ascending: false });
      } else if (sort === 'matches desc') {
        query = query.order('matches', { ascending: false });
      } else {
        query = query.order('win_rate', { ascending: false }).order('matches', { ascending: false });
      }

      query = query.limit(limit);

      const { data, error } = await query;
      if (error) throw new Error(error.message);

      return jsonResult({
        success: true,
        cards: data || [],
        count: (data || []).length,
        min_matches_filter: minMatches,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return jsonResult({ success: false, error: msg }, true);
    }
  },
};

// =============================================================================
// Tool 14: Deck Record
// =============================================================================

const deckRecord: ToolSpec = {
  definition: {
    name: 'deck_record',
    description:
      'Deck-level win/loss records from deck_stats. Search by name or list all.',
    annotations: {
      title: 'Deck Record',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        deck_name: {
          type: 'string',
          description: 'Optional: search by deck name (partial match)',
        },
        limit: {
          type: 'number',
          description: 'Max results (default: 20)',
        },
      },
      required: [],
    },
  },
  handler: async (args: {
    deck_name?: string;
    limit?: number;
  }): Promise<ToolResult> => {
    try {
      const db = getClient();
      const limit = Math.min(args.limit || 20, 100);

      let query = db
        .from('deck_stats')
        .select('deck_name, total_matches, wins, losses, last_played_ms')
        .order('total_matches', { ascending: false })
        .limit(limit);

      if (args.deck_name) {
        query = query.ilike('deck_name', `%${args.deck_name}%`);
      }

      const { data, error } = await query;
      if (error) throw new Error(error.message);

      const decks = ((data || []) as Record<string, unknown>[]).map((d) => {
        const total = (d.total_matches as number) || 0;
        const wins = (d.wins as number) || 0;
        const losses = (d.losses as number) || 0;
        return {
          deck_name: d.deck_name,
          total_matches: total,
          wins,
          losses,
          win_rate: total > 0 ? Math.round((wins / total) * 10000) / 100 : 0,
          last_played: d.last_played_ms
            ? new Date(Number(d.last_played_ms)).toISOString()
            : null,
        };
      });

      return jsonResult({
        success: true,
        decks,
        count: decks.length,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return jsonResult({ success: false, error: msg }, true);
    }
  },
};

// =============================================================================
// Tool 15: Player Summary
// =============================================================================

const deckPlayerSummary: ToolSpec = {
  definition: {
    name: 'deck_player_summary',
    description:
      'Combined gameplay dashboard: total matches, overall win rate, best format, best deck, longest streak, recent form (last 10).',
    annotations: {
      title: 'Player Summary',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  handler: async (): Promise<ToolResult> => {
    try {
      const db = getClient();

      // Fetch matches and deck stats in parallel
      const [matchRes, deckRes] = await Promise.all([
        db
          .from('match_summary')
          .select('format, result, deck_name, started_at_ms')
          .order('started_at_ms', { ascending: false }),
        db
          .from('deck_stats')
          .select('deck_name, total_matches, wins, losses')
          .order('total_matches', { ascending: false }),
      ]);

      if (matchRes.error) throw new Error(matchRes.error.message);
      if (deckRes.error) throw new Error(deckRes.error.message);

      const matches = (matchRes.data || []) as Record<string, unknown>[];
      const decks = (deckRes.data || []) as Record<string, unknown>[];

      // Overall stats
      const totalMatches = matches.length;
      const wins = matches.filter((m) => m.result === 'win').length;
      const losses = matches.filter((m) => m.result === 'loss' || m.result === 'concede').length;
      const overallWinRate = totalMatches > 0 ? Math.round((wins / totalMatches) * 10000) / 100 : 0;

      // Best format (by win rate, min 5 matches)
      const fmtMap = new Map<string, { w: number; t: number }>();
      for (const m of matches) {
        const fmt = (m.format as string) || 'Unknown';
        if (!fmtMap.has(fmt)) fmtMap.set(fmt, { w: 0, t: 0 });
        const b = fmtMap.get(fmt)!;
        b.t++;
        if (m.result === 'win') b.w++;
      }
      let bestFormat: { format: string; win_rate: number; matches: number } | null = null;
      for (const [fmt, b] of fmtMap) {
        if (b.t >= 5) {
          const wr = b.w / b.t;
          if (!bestFormat || wr > bestFormat.win_rate) {
            bestFormat = { format: fmt, win_rate: Math.round(wr * 10000) / 100, matches: b.t };
          }
        }
      }

      // Best deck (from deck_stats, min 3 matches)
      let bestDeck: { deck_name: string; win_rate: number; matches: number } | null = null;
      for (const d of decks) {
        const total = (d.total_matches as number) || 0;
        const w = (d.wins as number) || 0;
        if (total >= 3) {
          const wr = w / total;
          if (!bestDeck || wr > bestDeck.win_rate) {
            bestDeck = {
              deck_name: d.deck_name as string,
              win_rate: Math.round(wr * 10000) / 100,
              matches: total,
            };
          }
        }
      }

      // Longest streak (all-time)
      let longestStreak = 0;
      let longestStreakType = '';
      let currentRun = 0;
      let currentType = '';
      for (const m of matches) {
        const r = (m.result as string) === 'win' ? 'W' : 'L';
        if (r === currentType) {
          currentRun++;
        } else {
          currentType = r;
          currentRun = 1;
        }
        if (currentRun > longestStreak) {
          longestStreak = currentRun;
          longestStreakType = currentType;
        }
      }

      // Recent form (last 10)
      const recentForm = matches.slice(0, 10).map((m) => {
        const r = m.result as string;
        return r === 'win' ? 'W' : r === 'loss' || r === 'concede' ? 'L' : 'D';
      });

      return jsonResult({
        success: true,
        total_matches: totalMatches,
        overall_win_rate: overallWinRate,
        wins,
        losses,
        best_format: bestFormat,
        best_deck: bestDeck,
        longest_streak: `${longestStreak}${longestStreakType}`,
        recent_form: recentForm.join(''),
        total_decks: decks.length,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return jsonResult({ success: false, error: msg }, true);
    }
  },
};

// =============================================================================
// Tool 16: Draft Stats
// =============================================================================

const deckDraftStats: ToolSpec = {
  definition: {
    name: 'deck_draft_stats',
    description:
      'Draft history and performance from MTG Arena. Returns event, set, record, trophy status per draft.',
    annotations: {
      title: 'Draft Stats',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        set_code: {
          type: 'string',
          description: 'Optional: filter by set code (e.g. "OTJ", "MKM")',
        },
        limit: {
          type: 'number',
          description: 'Max results (default: 20, max: 100)',
        },
      },
      required: [],
    },
  },
  handler: async (args: {
    set_code?: string;
    limit?: number;
  }): Promise<ToolResult> => {
    try {
      const db = getClient();
      const limit = Math.min(args.limit || 20, 100);

      let query = db
        .from('draft_summary')
        .select('event_name, set_code, completed_at, total_picks, wins, losses')
        .order('completed_at', { ascending: false })
        .limit(limit);

      if (args.set_code) {
        query = query.ilike('set_code', args.set_code);
      }

      const { data, error } = await query;
      if (error) throw new Error(error.message);

      const drafts = (data || []).map((d: Record<string, unknown>) => {
        const wins = (d.wins as number) || 0;
        const losses = (d.losses as number) || 0;
        return {
          event_name: d.event_name,
          set_code: d.set_code,
          completed_at: d.completed_at,
          total_picks: d.total_picks,
          wins,
          losses,
          record: `${wins}-${losses}`,
          trophy: wins >= 7,
        };
      });

      return jsonResult({
        success: true,
        drafts,
        count: drafts.length,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return jsonResult({ success: false, error: msg }, true);
    }
  },
};

// =============================================================================
// Intel Reports
// =============================================================================

const INTEL_TYPES = [
  'price_spike', 'price_crash', 'format_shakeup', 'sleeper_pick',
  'deck_tech', 'meta_shift', 'budget_alert', 'spec_target',
  'correlation', 'event_impact',
] as const;

const INTEL_URGENCIES = ['breaking', 'daily', 'weekly', 'background'] as const;

const deckIntelWrite: ToolSpec = {
  definition: {
    name: 'deck_intel_write',
    description:
      'Write an intel report to the intel_reports table. Used by the deckscry-intel agent to publish analysis results.',
    annotations: {
      title: 'Write Intel Report',
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: [...INTEL_TYPES],
          description: 'Intel report type',
        },
        format: {
          type: 'string',
          description: 'MTG format (standard, pioneer, modern, etc.) or null for cross-format',
        },
        urgency: {
          type: 'string',
          enum: [...INTEL_URGENCIES],
          description: 'Report urgency (default: daily)',
        },
        title: {
          type: 'string',
          description: 'Report title — e.g. "Sheoldred spikes 40% after Pioneer RCQ results"',
        },
        summary: {
          type: 'string',
          description: '2-3 sentence analysis with evidence and reasoning',
        },
        cards: {
          type: 'array',
          items: { type: 'string' },
          description: 'Scryfall UUIDs of cards involved',
        },
        data: {
          type: 'object',
          description: 'Structured payload — analyzer name, confidence, evidence, involved_cards details',
        },
        social_hook: {
          type: 'string',
          description: 'Pre-written social media hook with specific numbers, timeframe, and why. Under 200 chars.',
        },
      },
      required: ['type', 'title', 'summary'],
    },
  },
  handler: async (args: {
    type: string;
    format?: string;
    urgency?: string;
    title: string;
    summary: string;
    cards?: string[];
    data?: Record<string, unknown>;
    social_hook?: string;
  }): Promise<ToolResult> => {
    try {
      const db = getClient();
      const { data, error } = await db
        .from('intel_reports')
        .insert({
          type: args.type,
          format: args.format || null,
          urgency: args.urgency || 'daily',
          title: args.title,
          summary: args.summary,
          cards: args.cards || [],
          data: args.data || {},
          social_hook: args.social_hook || null,
        })
        .select('id, type, format, urgency, title, created_at')
        .single();

      if (error) throw new Error(error.message);
      return jsonResult({ success: true, report: data });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return jsonResult({ success: false, error: msg }, true);
    }
  },
};

const deckIntelReports: ToolSpec = {
  definition: {
    name: 'deck_intel_reports',
    description:
      'Read intel reports. Filter by type, format, urgency, or unpublished status. Used by marketer and other consumers.',
    annotations: {
      title: 'Read Intel Reports',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Filter by intel type' },
        format: { type: 'string', description: 'Filter by MTG format' },
        urgency: { type: 'string', description: 'Filter by urgency level' },
        unpublished: { type: 'boolean', description: 'If true, only return reports not yet consumed by marketer' },
        limit: { type: 'number', description: 'Max reports to return (default: 20)' },
      },
      required: [],
    },
  },
  handler: async (args: {
    type?: string;
    format?: string;
    urgency?: string;
    unpublished?: boolean;
    limit?: number;
  }): Promise<ToolResult> => {
    try {
      const db = getClient();
      let query = db
        .from('intel_reports')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(args.limit || 20);

      if (args.type) query = query.eq('type', args.type);
      if (args.format) query = query.eq('format', args.format);
      if (args.urgency) query = query.eq('urgency', args.urgency);
      if (args.unpublished) query = query.eq('published', false);

      const { data, error } = await query;
      if (error) throw new Error(error.message);

      return jsonResult({
        success: true,
        reports: data,
        count: data?.length || 0,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return jsonResult({ success: false, error: msg }, true);
    }
  },
};

const deckIntelPublish: ToolSpec = {
  definition: {
    name: 'deck_intel_publish',
    description:
      'Mark intel reports as published (consumed by marketer). Accepts one or more report IDs.',
    annotations: {
      title: 'Mark Intel Published',
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        report_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'UUIDs of reports to mark as published',
        },
      },
      required: ['report_ids'],
    },
  },
  handler: async (args: { report_ids: string[] }): Promise<ToolResult> => {
    try {
      const db = getClient();
      const { error } = await db
        .from('intel_reports')
        .update({ published: true })
        .in('id', args.report_ids);

      if (error) throw new Error(error.message);
      return jsonResult({ success: true, published: args.report_ids.length });
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
  deckSearch,
  deckList,
  deckSummary,
  deckHistory,
  deckFormatDeals,
  deckTypeSearch,
  deckPriceBracket,
  deckSetAnalysis,
  deckVolatility,
  deckReprints,
  deckMatchHistory,
  deckWinRate,
  deckCardPerformance,
  deckRecord,
  deckPlayerSummary,
  deckDraftStats,
  deckIntelWrite,
  deckIntelReports,
  deckIntelPublish,
];
