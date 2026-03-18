/**
 * Terminal Markets Tools — DX Terminal Pro vault management
 *
 * REST API reads (market data, portfolios, strategies, competitors)
 * and on-chain writes (strategy updates, settings, deposits/withdrawals)
 * for the 21-day AI agent tournament on Base.
 *
 * Env vars:
 *   DX_WALLET_ACCOUNT — cast keystore account name (preferred, e.g. "dx-tournament")
 *   DX_WALLET_PASSWORD_FILE — path to keystore password file (required with DX_WALLET_ACCOUNT)
 *   DX_WALLET_PRIVATE_KEY — raw private key fallback (less secure, use keystore instead)
 *   DX_TERMINAL_VAULT — vault contract address (auto-resolved from wallet if missing)
 *   DX_TERMINAL_RPC — Base RPC URL (default: https://mainnet.base.org)
 */

import { execSync } from 'node:child_process';
import type { ToolSpec, ToolResult } from './types.js';

const API_BASE = 'https://api.terminal.markets/api/v1';
const DEFAULT_RPC = 'https://mainnet.base.org';

// ============================================================================
// Helpers
// ============================================================================

function jsonResult(data: unknown, isError = false): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    isError,
  };
}

function getRpc(): string {
  return process.env.DX_TERMINAL_RPC || DEFAULT_RPC;
}

/** Returns cast CLI flags for wallet authentication (keystore preferred, raw key fallback) */
function getWalletFlags(): string {
  const account = process.env.DX_WALLET_ACCOUNT;
  if (account) {
    const passwordFile = process.env.DX_WALLET_PASSWORD_FILE;
    if (!passwordFile) throw new Error('DX_WALLET_PASSWORD_FILE required when using DX_WALLET_ACCOUNT');
    return `--account "${account}" --password-file "${passwordFile}"`;
  }

  const key = process.env.DX_WALLET_PRIVATE_KEY;
  if (key) return `--private-key "${key}"`;

  throw new Error(
    'Wallet not configured. Set DX_WALLET_ACCOUNT + DX_WALLET_PASSWORD_FILE (recommended) or DX_WALLET_PRIVATE_KEY (fallback)',
  );
}

/** Cached vault address — resolved once per process */
let cachedVaultAddress: string | null = null;

async function getVaultAddress(): Promise<string> {
  if (cachedVaultAddress) return cachedVaultAddress;

  const explicit = process.env.DX_TERMINAL_VAULT;
  if (explicit) {
    cachedVaultAddress = explicit;
    return explicit;
  }

  // Derive owner address from wallet, then look up vault
  let ownerAddress: string;
  try {
    const account = process.env.DX_WALLET_ACCOUNT;
    if (account) {
      const passwordFile = process.env.DX_WALLET_PASSWORD_FILE;
      if (!passwordFile) throw new Error('DX_WALLET_PASSWORD_FILE required when using DX_WALLET_ACCOUNT');
      ownerAddress = execSync(
        `cast wallet address --account "${account}" --password-file "${passwordFile}"`,
        { encoding: 'utf8', timeout: 10000 },
      ).trim();
    } else {
      const key = process.env.DX_WALLET_PRIVATE_KEY;
      if (!key) throw new Error('Wallet not configured. Set DX_WALLET_ACCOUNT or DX_WALLET_PRIVATE_KEY');
      ownerAddress = execSync(
        `cast wallet address --private-key "${key}"`,
        { encoding: 'utf8', timeout: 10000 },
      ).trim();
    }
  } catch (err: any) {
    if (err.message?.includes('Wallet not configured') || err.message?.includes('PASSWORD_FILE')) throw err;
    const stderr = (err.stderr || '').toString().replace(/--private-key\s+"[^"]*"/, '--private-key "***"');
    throw new Error(`cast wallet address failed: ${stderr || 'unknown error'}`);
  }

  const res = await fetch(`${API_BASE}/vault?ownerAddress=${ownerAddress}`);
  if (!res.ok) throw new Error(`Vault lookup failed: ${res.status} ${res.statusText}`);
  const data = await res.json();
  const addr = data.vaultAddress;
  if (!addr) throw new Error(`No vault found for owner ${ownerAddress}`);

  cachedVaultAddress = addr;
  return addr;
}

/** Convert wei string to ETH (human-readable) */
function weiToEth(wei: string | number): string {
  const n = BigInt(wei);
  const whole = n / BigInt(1e18);
  const frac = n % BigInt(1e18);
  const fracStr = frac.toString().padStart(18, '0').slice(0, 6);
  return `${whole}.${fracStr}`;
}

async function apiFetch(path: string, params?: Record<string, string>): Promise<unknown> {
  const url = new URL(`${API_BASE}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
    }
  }
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`API ${path}: ${res.status} ${res.statusText}`);
  return res.json();
}

function castSend(contractAddress: string, sig: string, args: string[], value?: string): string {
  const walletFlags = getWalletFlags();
  const rpc = getRpc();
  const valueFlag = value ? ` --value "${value}"` : '';
  const argsStr = args.map(a => `"${a}"`).join(' ');
  const cmd = `cast send "${contractAddress}" "${sig}" ${argsStr}${valueFlag} ${walletFlags} --rpc-url "${rpc}" --json`;
  try {
    const result = execSync(cmd, { encoding: 'utf8', timeout: 60000 });
    return JSON.parse(result);
  } catch (err: any) {
    // Never leak wallet flags (may contain --private-key) in error messages
    const stderr = (err.stderr || '').toString().replace(/--private-key\s+"[^"]*"/, '--private-key "***"');
    throw new Error(`cast send failed: ${stderr || 'unknown error'}`);
  }
}

// ============================================================================
// READ TOOLS (REST API)
// ============================================================================

// Tool 1: terminal_get_tokens
const terminalGetTokens: ToolSpec = {
  definition: {
    name: 'terminal_get_tokens',
    description:
      'Get all tokens in DX Terminal Pro with market data (market cap, price, volume). Use to identify leaders, laggards, and elimination candidates.',
    annotations: {
      title: 'Get Tokens',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        includeMarketData: {
          type: 'boolean',
          description: 'Include price, market cap, volume data (default: true)',
        },
      },
      required: [],
    },
  },
  handler: async (args: { includeMarketData?: boolean }): Promise<ToolResult> => {
    try {
      const data = await apiFetch('/tokens', {
        includeMarketData: String(args.includeMarketData ?? true),
      }) as any[];

      // Sort by holder count descending as a proxy for popularity
      const sorted = data.sort((a: any, b: any) => {
        const hA = a.marketData?.holderCount || 0;
        const hB = b.marketData?.holderCount || 0;
        return hB - hA;
      });

      const summary = sorted.map((t: any, i: number) => ({
        rank: i + 1,
        symbol: t.symbol,
        name: t.name,
        address: t.tokenAddress,
        type: t.type,
        reaped: t.reaped,
        priceEth: t.marketData?.priceEth,
        priceUsd: t.marketData?.priceUsd,
        holderCount: t.marketData?.holderCount,
        volume24hEth: t.marketData?.['1d']?.volumeEth,
        volume24hUsd: t.marketData?.['1d']?.volumeUsd,
        priceChange24h: t.marketData?.['1d']?.priceChangePercent,
        buyCount24h: t.marketData?.['1d']?.buyCount,
        sellCount24h: t.marketData?.['1d']?.sellCount,
      }));

      return jsonResult({ success: true, tokenCount: summary.length, tokens: summary });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return jsonResult({ success: false, error: msg }, true);
    }
  },
};

// Tool 2: terminal_get_portfolio
const terminalGetPortfolio: ToolSpec = {
  definition: {
    name: 'terminal_get_portfolio',
    description:
      'Get your vault portfolio — ETH balance, token positions, overall PnL. Essential for understanding current exposure.',
    annotations: {
      title: 'Get Portfolio',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        vaultAddress: {
          type: 'string',
          description: 'Vault address (default: your vault)',
        },
      },
      required: [],
    },
  },
  handler: async (args: { vaultAddress?: string }): Promise<ToolResult> => {
    try {
      const vault = args.vaultAddress || await getVaultAddress();
      const data = await apiFetch(`/positions/${vault}`) as any;

      return jsonResult({
        success: true,
        vault,
        ethBalance: weiToEth(data.ethBalance || '0'),
        overallValueEth: weiToEth(data.overallValueEth || '0'),
        overallValueUsd: data.overallValueUsd,
        overallPnlEth: weiToEth(data.overallPnlEth || '0'),
        overallPnlUsd: data.overallPnlUsd,
        overallPnlPercent: data.overallPnlPercent,
        positions: (data.positions || []).map((p: any) => ({
          ...p,
          balanceFormatted: p.balance ? weiToEth(p.balance) : undefined,
        })),
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return jsonResult({ success: false, error: msg }, true);
    }
  },
};

// Tool 3: terminal_get_strategies
const terminalGetStrategies: ToolSpec = {
  definition: {
    name: 'terminal_get_strategies',
    description:
      'Read active strategies for ANY vault (all strategies are public on-chain). Use to scout competitors or review your own.',
    annotations: {
      title: 'Get Strategies',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        vaultAddress: {
          type: 'string',
          description: 'Vault to read (default: your vault)',
        },
        activeOnly: {
          type: 'boolean',
          description: 'Only return active strategies (default: true)',
        },
      },
      required: [],
    },
  },
  handler: async (args: { vaultAddress?: string; activeOnly?: boolean }): Promise<ToolResult> => {
    try {
      const vault = args.vaultAddress || await getVaultAddress();
      const data = await apiFetch(`/strategies/${vault}`, {
        activeOnly: String(args.activeOnly ?? true),
      }) as any[];

      return jsonResult({
        success: true,
        vault,
        strategyCount: data.length,
        strategies: data.map((s: any) => ({
          id: s.strategyId,
          content: s.content,
          priority: s.strategyPriority,
          expiry: s.expiry,
          expiryDate: s.expiry ? new Date(Number(s.expiry) * 1000).toISOString() : null,
          enabled: s.enabled,
        })),
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return jsonResult({ success: false, error: msg }, true);
    }
  },
};

// Tool 4: terminal_get_leaderboard
const terminalGetLeaderboard: ToolSpec = {
  definition: {
    name: 'terminal_get_leaderboard',
    description:
      'Get vault rankings across all competitors. Use to identify top performers and read their strategies.',
    annotations: {
      title: 'Get Leaderboard',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Number of vaults to return (default: 50)',
        },
        sortBy: {
          type: 'string',
          description: 'Sort field (default: total_pnl_usd)',
        },
        cursor: {
          type: 'string',
          description: 'Pagination cursor',
        },
      },
      required: [],
    },
  },
  handler: async (args: {
    limit?: number;
    sortBy?: string;
    cursor?: string;
  }): Promise<ToolResult> => {
    try {
      const data = await apiFetch('/leaderboard', {
        limit: String(args.limit ?? 50),
        sortBy: args.sortBy || 'total_pnl_usd',
        ...(args.cursor ? { cursor: args.cursor } : {}),
      });

      return jsonResult({ success: true, leaderboard: data });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return jsonResult({ success: false, error: msg }, true);
    }
  },
};

// Tool 5: terminal_get_swaps
const terminalGetSwaps: ToolSpec = {
  definition: {
    name: 'terminal_get_swaps',
    description:
      'Get trade history for a vault — includes amounts, tokens, and agent reasoning for each swap.',
    annotations: {
      title: 'Get Swaps',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        vaultAddress: {
          type: 'string',
          description: 'Vault address (default: your vault)',
        },
        limit: {
          type: 'number',
          description: 'Number of swaps (default: 50)',
        },
        order: {
          type: 'string',
          description: '"asc" or "desc" (default: desc)',
        },
        cursor: {
          type: 'string',
          description: 'Pagination cursor',
        },
      },
      required: [],
    },
  },
  handler: async (args: {
    vaultAddress?: string;
    limit?: number;
    order?: string;
    cursor?: string;
  }): Promise<ToolResult> => {
    try {
      const vault = args.vaultAddress || await getVaultAddress();
      const data = await apiFetch('/swaps', {
        vaultAddress: vault,
        limit: String(args.limit ?? 50),
        order: args.order || 'desc',
        ...(args.cursor ? { cursor: args.cursor } : {}),
      });

      return jsonResult({ success: true, vault, swaps: data });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return jsonResult({ success: false, error: msg }, true);
    }
  },
};

// Tool 6: terminal_get_inference_logs
const terminalGetInferenceLogs: ToolSpec = {
  definition: {
    name: 'terminal_get_inference_logs',
    description:
      'Read Qwen3 decision reasoning for any vault. Shows how the AI interpreted strategies and decided on trades.',
    annotations: {
      title: 'Get Inference Logs',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        vaultAddress: {
          type: 'string',
          description: 'Vault address (default: your vault)',
        },
        limit: {
          type: 'number',
          description: 'Number of logs (default: 20)',
        },
        order: {
          type: 'string',
          description: '"asc" or "desc" (default: desc)',
        },
        cursor: {
          type: 'string',
          description: 'Pagination cursor',
        },
      },
      required: [],
    },
  },
  handler: async (args: {
    vaultAddress?: string;
    limit?: number;
    order?: string;
    cursor?: string;
  }): Promise<ToolResult> => {
    try {
      const vault = args.vaultAddress || await getVaultAddress();
      const data = await apiFetch(`/logs/${vault}`, {
        limit: String(args.limit ?? 20),
        order: args.order || 'desc',
        ...(args.cursor ? { cursor: args.cursor } : {}),
      });

      return jsonResult({ success: true, vault, logs: data });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return jsonResult({ success: false, error: msg }, true);
    }
  },
};

// Tool 7: terminal_get_holders
const terminalGetHolders: ToolSpec = {
  definition: {
    name: 'terminal_get_holders',
    description:
      'Get holder distribution for a token. Use to detect whale concentration — tokens with broad distribution are safer bets.',
    annotations: {
      title: 'Get Token Holders',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        tokenAddress: {
          type: 'string',
          description: 'Token contract address (required)',
        },
        limit: {
          type: 'number',
          description: 'Number of holders (default: 50)',
        },
        offset: {
          type: 'number',
          description: 'Pagination offset (default: 0)',
        },
        order: {
          type: 'string',
          description: '"asc" or "desc" by balance (default: desc)',
        },
      },
      required: ['tokenAddress'],
    },
  },
  handler: async (args: {
    tokenAddress: string;
    limit?: number;
    offset?: number;
    order?: string;
  }): Promise<ToolResult> => {
    try {
      const data = await apiFetch(`/holders/${args.tokenAddress}`, {
        limit: String(args.limit ?? 50),
        offset: String(args.offset ?? 0),
        order: args.order || 'desc',
      }) as any[];

      const holders = data.map((h: any) => ({
        ...h,
        balanceFormatted: h.balance ? weiToEth(h.balance) : undefined,
      }));

      return jsonResult({ success: true, token: args.tokenAddress, holderCount: holders.length, holders });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return jsonResult({ success: false, error: msg }, true);
    }
  },
};

// Tool 8: terminal_get_candles
const terminalGetCandles: ToolSpec = {
  definition: {
    name: 'terminal_get_candles',
    description:
      'Get OHLCV candlestick data for a token. Use for momentum analysis and trend detection.',
    annotations: {
      title: 'Get Candles',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        tokenAddress: {
          type: 'string',
          description: 'Token contract address (required)',
        },
        timeframe: {
          type: 'string',
          description: 'Candle timeframe: 1m, 5m, 15m, 1h, 4h, 1d (default: 1h)',
        },
        countback: {
          type: 'number',
          description: 'Number of candles to return (default: 50)',
        },
        to: {
          type: 'number',
          description: 'End timestamp (unix seconds, default: now)',
        },
      },
      required: ['tokenAddress'],
    },
  },
  handler: async (args: {
    tokenAddress: string;
    timeframe?: string;
    countback?: number;
    to?: number;
  }): Promise<ToolResult> => {
    try {
      const data = await apiFetch(`/candles/${args.tokenAddress}`, {
        timeframe: args.timeframe || '1h',
        countback: String(args.countback ?? 50),
        to: String(args.to ?? Math.floor(Date.now() / 1000)),
      });

      return jsonResult({ success: true, token: args.tokenAddress, candles: data });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return jsonResult({ success: false, error: msg }, true);
    }
  },
};

// Tool 9: terminal_get_pnl_history
const terminalGetPnlHistory: ToolSpec = {
  definition: {
    name: 'terminal_get_pnl_history',
    description:
      'Get PnL time series for a vault. Use to evaluate strategy performance over time.',
    annotations: {
      title: 'Get PnL History',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        vaultAddress: {
          type: 'string',
          description: 'Vault address (default: your vault)',
        },
      },
      required: [],
    },
  },
  handler: async (args: { vaultAddress?: string }): Promise<ToolResult> => {
    try {
      const vault = args.vaultAddress || await getVaultAddress();
      const data = await apiFetch(`/pnl-history/${vault}`);

      return jsonResult({ success: true, vault, pnlHistory: data });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return jsonResult({ success: false, error: msg }, true);
    }
  },
};

// Tool 10: terminal_get_vault_settings
const terminalGetVaultSettings: ToolSpec = {
  definition: {
    name: 'terminal_get_vault_settings',
    description:
      'Get vault configuration — behavioral sliders, max trade size, slippage settings.',
    annotations: {
      title: 'Get Vault Settings',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        vaultAddress: {
          type: 'string',
          description: 'Vault address (default: your vault)',
        },
      },
      required: [],
    },
  },
  handler: async (args: { vaultAddress?: string }): Promise<ToolResult> => {
    try {
      const vault = args.vaultAddress || await getVaultAddress();
      const data = await apiFetch('/vault', { vaultAddress: vault }) as any;

      return jsonResult({
        success: true,
        vault,
        settings: {
          maxTradeAmount: data.maxTradeAmount,
          slippageBps: data.slippageBps,
          tradingActivity: data.tradingActivity,
          assetRiskPreference: data.assetRiskPreference,
          tradeSize: data.tradeSize,
          holdingStyle: data.holdingStyle,
          diversification: data.diversification,
        },
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return jsonResult({ success: false, error: msg }, true);
    }
  },
};

// Tool 11: terminal_get_deposits_withdrawals
const terminalGetDepositsWithdrawals: ToolSpec = {
  definition: {
    name: 'terminal_get_deposits_withdrawals',
    description:
      'Get deposit and withdrawal history for a vault.',
    annotations: {
      title: 'Get Deposits/Withdrawals',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        vaultAddress: {
          type: 'string',
          description: 'Vault address (default: your vault)',
        },
        limit: {
          type: 'number',
          description: 'Number of records (default: 50)',
        },
        order: {
          type: 'string',
          description: '"asc" or "desc" (default: desc)',
        },
      },
      required: [],
    },
  },
  handler: async (args: {
    vaultAddress?: string;
    limit?: number;
    order?: string;
  }): Promise<ToolResult> => {
    try {
      const vault = args.vaultAddress || await getVaultAddress();
      const data = await apiFetch(`/deposits-withdrawals/${vault}`, {
        limit: String(args.limit ?? 50),
        order: args.order || 'desc',
      });

      return jsonResult({ success: true, vault, transactions: data });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return jsonResult({ success: false, error: msg }, true);
    }
  },
};

// ============================================================================
// WRITE TOOLS (On-chain via cast)
// ============================================================================

// Tool 12: terminal_add_strategy
const terminalAddStrategy: ToolSpec = {
  definition: {
    name: 'terminal_add_strategy',
    description:
      'Push a natural language strategy on-chain for Qwen3 to interpret. Max 8 active, 1024 chars each. Strategies must be specific and actionable.',
    annotations: {
      title: 'Add Strategy',
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        strategy: {
          type: 'string',
          description: 'Natural language strategy text (max 1024 chars)',
        },
        priority: {
          type: 'number',
          description: '0=Low, 1=Med, 2=High (default: 2)',
        },
        expiryMinutes: {
          type: 'number',
          description: 'Minutes until expiry (default: 35 for auto-refresh cycles)',
        },
        expiryTimestamp: {
          type: 'number',
          description: 'Explicit unix timestamp for expiry (overrides expiryMinutes)',
        },
      },
      required: ['strategy'],
    },
  },
  handler: async (args: {
    strategy: string;
    priority?: number;
    expiryMinutes?: number;
    expiryTimestamp?: number;
  }): Promise<ToolResult> => {
    try {
      // Validate
      if (args.strategy.length > 1024) {
        return jsonResult({ success: false, error: `Strategy too long: ${args.strategy.length}/1024 chars` }, true);
      }
      if (args.strategy.length === 0) {
        return jsonResult({ success: false, error: 'Strategy text cannot be empty' }, true);
      }

      const vault = await getVaultAddress();
      const priority = args.priority ?? 2;
      const expiry = args.expiryTimestamp ?? Math.floor(Date.now() / 1000) + (args.expiryMinutes ?? 35) * 60;

      if (priority < 0 || priority > 2) {
        return jsonResult({ success: false, error: 'Priority must be 0 (Low), 1 (Med), or 2 (High)' }, true);
      }

      const result = castSend(vault, 'addStrategy(string,uint64,uint8)', [
        args.strategy,
        String(expiry),
        String(priority),
      ]);

      return jsonResult({
        success: true,
        vault,
        strategy: args.strategy,
        priority: ['Low', 'Med', 'High'][priority],
        expiry,
        expiryDate: new Date(expiry * 1000).toISOString(),
        txHash: (result as any)?.transactionHash,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return jsonResult({ success: false, error: msg }, true);
    }
  },
};

// Tool 13: terminal_disable_strategy
const terminalDisableStrategy: ToolSpec = {
  definition: {
    name: 'terminal_disable_strategy',
    description:
      'Disable a strategy by ID. Use to remove stale or expired strategies before adding new ones.',
    annotations: {
      title: 'Disable Strategy',
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        strategyId: {
          type: 'string',
          description: 'Strategy ID to disable (from get_strategies)',
        },
      },
      required: ['strategyId'],
    },
  },
  handler: async (args: { strategyId: string }): Promise<ToolResult> => {
    try {
      const vault = await getVaultAddress();
      const result = castSend(vault, 'disableStrategy(uint256)', [args.strategyId]);

      return jsonResult({
        success: true,
        vault,
        disabledStrategyId: args.strategyId,
        txHash: (result as any)?.transactionHash,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return jsonResult({ success: false, error: msg }, true);
    }
  },
};

// Tool 14: terminal_update_settings
const terminalUpdateSettings: ToolSpec = {
  definition: {
    name: 'terminal_update_settings',
    description:
      'Update vault behavioral sliders and trade limits. All 7 parameters must be provided.',
    annotations: {
      title: 'Update Settings',
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        maxTradeAmount: {
          type: 'number',
          description: 'Max trade size in BPS (500-10000, e.g. 5000 = 50%)',
        },
        slippageBps: {
          type: 'number',
          description: 'Max slippage in BPS (10-5000, e.g. 250 = 2.5%)',
        },
        tradingActivity: {
          type: 'number',
          description: '1=rare to 5=frequent',
        },
        assetRiskPreference: {
          type: 'number',
          description: '1=safer to 5=riskier',
        },
        tradeSize: {
          type: 'number',
          description: '1=cautious to 5=aggressive',
        },
        holdingStyle: {
          type: 'number',
          description: '1=short-term to 5=patient',
        },
        diversification: {
          type: 'number',
          description: '1=concentrated to 5=spread',
        },
      },
      required: [
        'maxTradeAmount', 'slippageBps', 'tradingActivity',
        'assetRiskPreference', 'tradeSize', 'holdingStyle', 'diversification',
      ],
    },
  },
  handler: async (args: {
    maxTradeAmount: number;
    slippageBps: number;
    tradingActivity: number;
    assetRiskPreference: number;
    tradeSize: number;
    holdingStyle: number;
    diversification: number;
  }): Promise<ToolResult> => {
    try {
      // Validate ranges
      const sliders = ['tradingActivity', 'assetRiskPreference', 'tradeSize', 'holdingStyle', 'diversification'] as const;
      for (const s of sliders) {
        if (args[s] < 1 || args[s] > 5) {
          return jsonResult({ success: false, error: `${s} must be 1-5, got ${args[s]}` }, true);
        }
      }
      if (args.maxTradeAmount < 500 || args.maxTradeAmount > 10000) {
        return jsonResult({ success: false, error: `maxTradeAmount must be 500-10000 BPS, got ${args.maxTradeAmount}` }, true);
      }
      if (args.slippageBps < 10 || args.slippageBps > 5000) {
        return jsonResult({ success: false, error: `slippageBps must be 10-5000, got ${args.slippageBps}` }, true);
      }

      const vault = await getVaultAddress();
      const tuple = `(${args.maxTradeAmount},${args.slippageBps},${args.tradingActivity},${args.assetRiskPreference},${args.tradeSize},${args.holdingStyle},${args.diversification})`;
      const result = castSend(
        vault,
        'updateSettings((uint256,uint256,uint8,uint8,uint8,uint8,uint8))',
        [tuple],
      );

      return jsonResult({
        success: true,
        vault,
        settings: {
          maxTradeAmount: args.maxTradeAmount,
          slippageBps: args.slippageBps,
          tradingActivity: args.tradingActivity,
          assetRiskPreference: args.assetRiskPreference,
          tradeSize: args.tradeSize,
          holdingStyle: args.holdingStyle,
          diversification: args.diversification,
        },
        txHash: (result as any)?.transactionHash,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return jsonResult({ success: false, error: msg }, true);
    }
  },
};

// Tool 15: terminal_deposit_eth
const terminalDepositEth: ToolSpec = {
  definition: {
    name: 'terminal_deposit_eth',
    description:
      'Deposit ETH into the vault. Amount in ether (e.g. 0.05).',
    annotations: {
      title: 'Deposit ETH',
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        amount: {
          type: 'string',
          description: 'ETH amount to deposit (e.g. "0.05")',
        },
      },
      required: ['amount'],
    },
  },
  handler: async (args: { amount: string }): Promise<ToolResult> => {
    try {
      const amountNum = parseFloat(args.amount);
      if (isNaN(amountNum) || amountNum <= 0) {
        return jsonResult({ success: false, error: 'Amount must be a positive number' }, true);
      }

      const vault = await getVaultAddress();
      const result = castSend(vault, 'depositETH()', [], `${args.amount}ether`);

      return jsonResult({
        success: true,
        vault,
        depositedEth: args.amount,
        txHash: (result as any)?.transactionHash,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return jsonResult({ success: false, error: msg }, true);
    }
  },
};

// Tool 16: terminal_withdraw_eth
const terminalWithdrawEth: ToolSpec = {
  definition: {
    name: 'terminal_withdraw_eth',
    description:
      'Withdraw unallocated ETH from the vault. Amount in ether (e.g. 0.05). Only unallocated ETH can be withdrawn.',
    annotations: {
      title: 'Withdraw ETH',
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        amount: {
          type: 'string',
          description: 'ETH amount to withdraw (e.g. "0.05")',
        },
      },
      required: ['amount'],
    },
  },
  handler: async (args: { amount: string }): Promise<ToolResult> => {
    try {
      const amountNum = parseFloat(args.amount);
      if (isNaN(amountNum) || amountNum <= 0) {
        return jsonResult({ success: false, error: 'Amount must be a positive number' }, true);
      }

      // Convert ether to wei
      const wei = BigInt(Math.floor(amountNum * 1e18)).toString();

      const vault = await getVaultAddress();
      const result = castSend(vault, 'withdrawETH(uint256)', [wei]);

      return jsonResult({
        success: true,
        vault,
        withdrawnEth: args.amount,
        withdrawnWei: wei,
        txHash: (result as any)?.transactionHash,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return jsonResult({ success: false, error: msg }, true);
    }
  },
};

// ============================================================================
// Export
// ============================================================================

export const terminalTools: ToolSpec[] = [
  // Reads
  terminalGetTokens,
  terminalGetPortfolio,
  terminalGetStrategies,
  terminalGetLeaderboard,
  terminalGetSwaps,
  terminalGetInferenceLogs,
  terminalGetHolders,
  terminalGetCandles,
  terminalGetPnlHistory,
  terminalGetVaultSettings,
  terminalGetDepositsWithdrawals,
  // Writes
  terminalAddStrategy,
  terminalDisableStrategy,
  terminalUpdateSettings,
  terminalDepositEth,
  terminalWithdrawEth,
];
