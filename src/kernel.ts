// ============================================================================
// Tool Kernel — single source of truth for tool dispatch
// ============================================================================
// The kernel owns: tool registry, facade registry, dispatch, agent context
// threading, and logging hooks. Both stdio and HTTP transports import the kernel.
//
// Phase 1c: Extract from server.ts and httpServer.ts
// Phase 1d: Facade layer — ~22 public tools dispatching to ~170 internal handlers
// Phase 4:  Dispatch hooks, batch, facade filtering, agent messaging
// ============================================================================

import { EventEmitter } from 'events';
import { getAllTools } from './tools/index.js';
import { trackToolUse } from './tools/shared/index.js';
import { log } from './config.js';
import type { ToolSpec, ToolResult } from './tools/types.js';
import type { FacadeSpec, DetailTier, McpToolDefinition } from './facades/types.js';
import { coreFacades, proFacades, appFacades } from './facades/definitions.js';
import { buildMcpDefinitions, validateFacades } from './facades/index.js';

// ============================================================================
// Dispatch Context — agent-readiness plumbing
// ============================================================================

/**
 * Optional context threaded through every dispatch call.
 * This is plumbing, not policy — the kernel passes it to handlers
 * but doesn't enforce it. decibel-agent passes agentId, runId, and
 * scope so coordinator logs, vector events, and provenance know
 * WHO did WHAT.
 */
export interface DispatchContext {
  /** Who is calling (e.g. "cymoril-code", "claude-code", "anonymous") */
  agentId?: string;
  /** Vector run ID for tracing */
  runId?: string;
  /** If this call was delegated from another agent's call */
  parentCallId?: string;
  /** Project ID or "portfolio" */
  scope?: string;
  /** Restrict dispatch to these facades only (undefined = all allowed) */
  allowedFacades?: string[];
  /** License tier — when set, pro facades are rejected for 'core' tier */
  tier?: 'core' | 'pro' | 'apps';
  /** Engagement mode: 'suggest' | 'curate' | 'compose' */
  engagementMode?: string;
  /** Identity of the calling user */
  userKey?: string;
  /** Request correlation ID (crypto.randomUUID) — set by client, threaded through events */
  requestId?: string;
}

// Tier gating (same logic as tools/index.ts)
const PRO_ENABLED = process.env.DECIBEL_PRO === '1' || process.env.NODE_ENV !== 'production';
const APPS_ENABLED = process.env.DECIBEL_APPS === '1' || process.env.NODE_ENV !== 'production';

// ============================================================================
// Tool Kernel
// ============================================================================

// ============================================================================
// Dispatch Events — observability seam for agent awareness
// ============================================================================

export interface DispatchEvent {
  type: 'dispatch' | 'result' | 'error';
  facade?: string;
  action?: string;
  tool?: string;
  agentId: string;
  runId?: string;
  requestId?: string;
  timestamp: string;
  duration_ms?: number;
  success?: boolean;
  error?: string;
}

/** Single call in a batch request */
export interface BatchCall {
  facade: string;
  action: string;
  params?: Record<string, unknown>;
}

/** Result of a single call within a batch */
export interface BatchResult {
  facade: string;
  action: string;
  result?: ToolResult;
  error?: string;
  duration_ms: number;
}

export interface ToolKernel {
  /** All internal tool definitions (full registry, ~170 tools) */
  tools: ToolSpec[];
  /** Fast lookup by internal tool name */
  toolMap: Map<string, ToolSpec>;
  /** Active facade definitions (filtered by pro tier) */
  facades: FacadeSpec[];
  /** Fast lookup by facade name */
  facadeMap: Map<string, FacadeSpec>;

  /**
   * Dispatch a tool call. Handles both:
   * - Facade calls: name="sentinel", args={ action: "create_issue", title: "...", ... }
   * - Direct calls: name="sentinel_create_issue", args={...}  (backward compat)
   * - Legacy nested: name="sentinel", args={ action: "create_issue", params: {...} }
   */
  dispatch(name: string, args: Record<string, unknown>, context?: DispatchContext): Promise<ToolResult>;

  /**
   * Dispatch multiple independent calls in parallel. Returns results in same order.
   * Errors are per-call — one failure doesn't abort others.
   */
  batch(calls: BatchCall[], context?: DispatchContext): Promise<BatchResult[]>;

  /**
   * Get MCP tool definitions for the tools/list response.
   * Returns facade definitions filtered by detail tier.
   */
  getMcpToolDefinitions(tier?: DetailTier): McpToolDefinition[];

  /** Subscribe to dispatch events (dispatch, result, error) */
  on(event: string, listener: (evt: DispatchEvent) => void): void;

  /** Total internal tool count */
  toolCount: number;
  /** Total facade count */
  facadeCount: number;
}

/**
 * Create the tool kernel. Call once at startup — both transports share it.
 */
export async function createKernel(): Promise<ToolKernel> {
  const tools = await getAllTools();
  const toolMap = new Map(tools.map(t => [t.definition.name, t]));

  // Build facade registry (core + pro if enabled + apps if enabled)
  const facades = [
    ...coreFacades,
    ...(PRO_ENABLED ? proFacades : []),
    ...(APPS_ENABLED ? appFacades : []),
  ];
  const facadeMap = new Map(facades.map(f => [f.name, f]));

  // Validate all facade actions point to real tools
  const missing = validateFacades(facades, toolMap);
  if (missing.length > 0) {
    log(`Kernel WARNING: ${missing.length} facade action(s) reference missing tools:`);
    for (const m of missing) {
      log(`  - ${m}`);
    }
  }

  log(`Kernel: loaded ${tools.length} internal tools, ${facades.length} facades`);

  // Dispatch event emitter — subscribers get notified of every dispatch
  // NOTE: EventEmitter throws on .emit('error') if no listener is registered.
  // Register a no-op default so unsubscribed errors don't crash the process.
  const emitter = new EventEmitter();
  emitter.on('error', () => {});

  // Pre-build MCP definitions for each tier (cached)
  const mcpDefCache = new Map<DetailTier, McpToolDefinition[]>();

  function getMcpToolDefinitions(tier: DetailTier = 'full'): McpToolDefinition[] {
    let cached = mcpDefCache.get(tier);
    if (!cached) {
      cached = buildMcpDefinitions(facades, tier, toolMap);
      mcpDefCache.set(tier, cached);
    }
    return cached;
  }

  async function dispatch(
    name: string,
    args: Record<string, unknown>,
    context?: DispatchContext
  ): Promise<ToolResult> {
    const agentId = context?.agentId || 'anonymous';
    const runId = context?.runId;
    const requestId = context?.requestId;
    const allowed = context?.allowedFacades;

    // Facade filtering: reject if caller is scoped and facade not in allowlist
    if (allowed) {
      // For facade calls, check the facade name directly
      // For direct calls, extract the facade prefix (e.g. "sentinel_create_issue" → "sentinel")
      const facadeKey = facadeMap.has(name) ? name : name.split('_')[0];
      if (!allowed.includes(facadeKey)) {
        return {
          content: [{ type: 'text', text: JSON.stringify({
            error: `Facade "${facadeKey}" not in allowed scope`,
            allowed_facades: allowed,
          }) }],
          isError: true,
        };
      }
    }

    // Tier enforcement: reject pro/apps facade calls from core-tier callers
    if (context?.tier === 'core') {
      const targetFacade = facadeMap.get(name);
      if (targetFacade && (targetFacade.tier === 'pro' || targetFacade.tier === 'apps')) {
        return {
          content: [{ type: 'text', text: JSON.stringify({
            error: `Facade "${name}" requires a pro license`,
            facade_tier: targetFacade.tier,
            caller_tier: 'core',
            hint: 'Provide a valid DCBL license key to access pro features',
          }) }],
          isError: true,
        };
      }
      // Also check direct tool calls that map to pro facades
      if (!targetFacade) {
        const facadePrefix = name.split('_')[0];
        const parentFacade = facadeMap.get(facadePrefix);
        if (parentFacade && (parentFacade.tier === 'pro' || parentFacade.tier === 'apps')) {
          return {
            content: [{ type: 'text', text: JSON.stringify({
              error: `Tool "${name}" belongs to pro facade "${facadePrefix}"`,
              facade_tier: parentFacade.tier,
              caller_tier: 'core',
              hint: 'Provide a valid DCBL license key to access pro features',
            }) }],
            isError: true,
          };
        }
      }
    }

    // Check if this is a facade call
    const facade = facadeMap.get(name);
    if (facade) {
      const action = args.action as string;
      if (!action) {
        return {
          content: [{ type: 'text', text: JSON.stringify({
            error: `Missing "action" parameter for ${name}`,
            available_actions: Object.keys(facade.actions),
          }) }],
          isError: true,
        };
      }

      const internalName = facade.actions[action];
      if (!internalName) {
        return {
          content: [{ type: 'text', text: JSON.stringify({
            error: `Unknown action "${action}" for ${name}`,
            available_actions: Object.keys(facade.actions),
          }) }],
          isError: true,
        };
      }

      const tool = toolMap.get(internalName);
      if (!tool) {
        return {
          content: [{ type: 'text', text: JSON.stringify({
            error: `Internal tool "${internalName}" not found (facade: ${name}, action: ${action})`,
          }) }],
          isError: true,
        };
      }

      // Flat params: action-specific fields are at root level.
      // Backward compat: also merge args.params if present (batch API, legacy callers).
      const { action: _action, params: legacyParams, ...flatParams } = args;
      const params = { ...(legacyParams as Record<string, unknown> || {}), ...flatParams };

      log(`Kernel: facade ${name}.${action} → ${internalName} (agent=${agentId}${runId ? ` run=${runId}` : ''})`);
      trackToolUse(internalName);

      const startTime = Date.now();
      emitter.emit('dispatch', {
        type: 'dispatch', facade: name, action, tool: internalName,
        agentId, runId, requestId, timestamp: new Date().toISOString(),
      } satisfies DispatchEvent);

      try {
        const result = await tool.handler(params);
        emitter.emit('result', {
          type: 'result', facade: name, action, tool: internalName,
          agentId, runId, requestId, timestamp: new Date().toISOString(),
          duration_ms: Date.now() - startTime, success: !result.isError,
        } satisfies DispatchEvent);
        return result;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        emitter.emit('error', {
          type: 'error', facade: name, action, tool: internalName,
          agentId, runId, requestId, timestamp: new Date().toISOString(),
          duration_ms: Date.now() - startTime,
          error: errMsg,
        } satisfies DispatchEvent);
        return {
          content: [{ type: 'text', text: JSON.stringify({
            error: errMsg,
            facade: name,
            action,
            tool: internalName,
          }) }],
          isError: true,
        };
      }
    }

    // Direct tool dispatch (backward compatibility)
    const tool = toolMap.get(name);
    if (!tool) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: `Unknown tool: ${name}` }) }],
        isError: true,
      };
    }

    log(`Kernel: dispatch ${name} (agent=${agentId}${runId ? ` run=${runId}` : ''})`);
    trackToolUse(name);

    const startTime = Date.now();
    emitter.emit('dispatch', {
      type: 'dispatch', tool: name,
      agentId, runId, requestId, timestamp: new Date().toISOString(),
    } satisfies DispatchEvent);

    try {
      const result = await tool.handler(args);
      emitter.emit('result', {
        type: 'result', tool: name,
        agentId, runId, requestId, timestamp: new Date().toISOString(),
        duration_ms: Date.now() - startTime, success: !result.isError,
      } satisfies DispatchEvent);
      return result;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      emitter.emit('error', {
        type: 'error', tool: name,
        agentId, runId, requestId, timestamp: new Date().toISOString(),
        duration_ms: Date.now() - startTime,
        error: errMsg,
      } satisfies DispatchEvent);
      return {
        content: [{ type: 'text', text: JSON.stringify({
          error: errMsg,
          tool: name,
        }) }],
        isError: true,
      };
    }
  }

  async function batch(calls: BatchCall[], context?: DispatchContext): Promise<BatchResult[]> {
    log(`Kernel: batch dispatch — ${calls.length} calls (agent=${context?.agentId || 'anonymous'})`);

    const promises = calls.map(async (call): Promise<BatchResult> => {
      const start = Date.now();
      try {
        const result = await dispatch(
          call.facade,
          { action: call.action, ...(call.params || {}) },
          context
        );
        return {
          facade: call.facade,
          action: call.action,
          result,
          duration_ms: Date.now() - start,
        };
      } catch (err) {
        return {
          facade: call.facade,
          action: call.action,
          error: err instanceof Error ? err.message : String(err),
          duration_ms: Date.now() - start,
        };
      }
    });

    return Promise.all(promises);
  }

  return {
    tools,
    toolMap,
    facades,
    facadeMap,
    dispatch,
    batch,
    on: (event: string, listener: (evt: DispatchEvent) => void) => emitter.on(event, listener),
    getMcpToolDefinitions,
    toolCount: tools.length,
    facadeCount: facades.length,
  };
}
