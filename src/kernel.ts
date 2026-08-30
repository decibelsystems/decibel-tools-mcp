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
import { getEnabledFacades } from './toolConfig.js';
import { CircuitBreakerRegistry, type CircuitSnapshot } from './runtime/circuitBreaker.js';

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
  /** Identity of the calling user (Supabase access token / JWT, via X-User-Key) */
  userKey?: string;
  /** Tenant org id (hq.orgs.id) for the multi-tenant store, via X-Org-Key */
  orgId?: string;
  /** Request correlation ID (crypto.randomUUID) — set by client, threaded through events */
  requestId?: string;
}

// Tier gating (same logic as tools/index.ts).
//
// Fails CLOSED: opt in explicitly. The previous form OR'd in
// `NODE_ENV !== 'production'`, which is true whenever NODE_ENV is simply unset —
// the default for a plain `npx @decibelsystems/tools` install and for any client
// that spawns the server without a curated env (Claude Desktop, Cursor). That
// silently exposed every pro and apps facade, including `terminal` (reads
// DX_WALLET_PRIVATE_KEY) and the Postgres trading facades, to ordinary users.
const PRO_ENABLED = process.env.DECIBEL_PRO === '1';
const APPS_ENABLED = process.env.DECIBEL_APPS === '1';

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

  /** Unsubscribe from dispatch events (for SSE cleanup) */
  off(event: string, listener: (evt: DispatchEvent) => void): void;

  /**
   * Circuits that are open or accumulating faults, keyed by facade.
   * Empty object means every facade is healthy. Surfaced on /health so a
   * degraded dependency is visible without reading the dispatch log.
   */
  circuitSnapshot(): Record<string, CircuitSnapshot>;

  /** Force a circuit closed (operator escape hatch, and test hygiene). */
  resetCircuit(key?: string): void;

  /** Total internal tool count */
  toolCount: number;
  /** Total facade count */
  facadeCount: number;
}

/**
 * Coerce params that arrived as JSON strings but whose target tool's schema
 * declares them as object or array. Facade MCP definitions expose only
 * `{action}` with additionalProperties, so callers get no type info for
 * nested params and often serialize them (ISS-0112, ISS-0116). A parse
 * failure or type mismatch leaves the value untouched — the tool's own
 * validation stays the source of truth for errors.
 */
export function coerceStringifiedParams(
  params: Record<string, unknown>,
  schema: ToolSpec['definition']['inputSchema']
): Record<string, unknown> {
  const props = schema?.properties;
  if (!props) return params;

  let out: Record<string, unknown> | undefined;
  for (const [key, value] of Object.entries(params)) {
    if (typeof value !== 'string') continue;

    const prop = props[key] as { type?: string | string[] } | undefined;
    if (!prop) continue;
    const types = Array.isArray(prop.type) ? prop.type : [prop.type];
    const wantsObject = types.includes('object');
    const wantsArray = types.includes('array');
    if (!wantsObject && !wantsArray) continue;
    // String is also acceptable per the schema — don't second-guess the caller
    if (types.includes('string')) continue;

    const trimmed = value.trim();
    const looksObject = trimmed.startsWith('{') && trimmed.endsWith('}');
    const looksArray = trimmed.startsWith('[') && trimmed.endsWith(']');
    if (!(wantsObject && looksObject) && !(wantsArray && looksArray)) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const isPlainObject = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
    if ((wantsObject && isPlainObject) || (wantsArray && Array.isArray(parsed))) {
      out ??= { ...params };
      out[key] = parsed;
    }
  }
  return out ?? params;
}

/** Best-effort one-line reason from an `isError` result, for circuit reporting. */
function resultErrorText(result: ToolResult): string | undefined {
  const text = result.content?.find((c) => c.type === 'text')?.text;
  if (!text) return undefined;
  try {
    const parsed = JSON.parse(text) as { error?: unknown };
    if (typeof parsed.error === 'string') return parsed.error;
  } catch {
    // Not JSON — fall through to the raw text.
  }
  return text.slice(0, 200);
}

/**
 * Create the tool kernel. Call once at startup — both transports share it.
 */
export async function createKernel(): Promise<ToolKernel> {
  const tools = await getAllTools();
  const toolMap = new Map(tools.map(t => [t.definition.name, t]));

  // Build facade registry (core + pro if enabled + apps if enabled)
  // App facades are registered only when their tools actually loaded. The
  // modules are excluded from the published build, so on a public install the
  // flag can be set and the facades still will not appear — you cannot call
  // what was never registered. Fail closed by absence rather than by check.
  const appFacadesPresent = appFacades.filter((f) =>
    Object.values(f.actions).some((toolName) => toolMap.has(toolName as string))
  );

  let facades = [
    ...coreFacades,
    ...(PRO_ENABLED ? proFacades : []),
    ...(APPS_ENABLED ? appFacadesPresent : []),
  ];

  // DECIBEL_FACADES env var or config: restrict to only these facades
  // Always include 'registry' so config tools remain accessible
  const enabledFacades = getEnabledFacades();
  if (enabledFacades) {
    const allowSet = new Set([...enabledFacades, 'registry']);
    const before = facades.length;
    facades = facades.filter(f => allowSet.has(f.name));
    if (facades.length < before) {
      log(`Kernel: DECIBEL_FACADES filter applied — ${facades.length}/${before} facades enabled`);
    }
  }

  const facadeMap = new Map(facades.map(f => [f.name, f]));

  // Reverse map: internal tool name → owning facade (name + tier). Built from each
  // facade's declared `actions` (action → internal tool), so tier enforcement on a
  // DIRECT tool call is exact. The previous guard inferred the facade from
  // `toolName.split('_')[0]`, which silently failed for pro tools whose names don't
  // start with their facade name (e.g. `kling_generate_video` under the `studio`
  // facade → prefix `kling` ≠ any facade → guard skipped → pro tool ran for a
  // core-tier caller). (Sec review 2026-06-04.)
  const toolToFacade = new Map<string, { name: string; tier: FacadeSpec['tier'] }>();
  for (const f of facades) {
    for (const toolName of Object.values(f.actions)) {
      toolToFacade.set(toolName, { name: f.name, tier: f.tier });
    }
  }

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

  // Per-facade circuit breaker. See src/runtime/circuitBreaker.ts for what
  // counts as a fault and why `isError` alone is neither necessary nor
  // sufficient.
  const circuits = new CircuitBreakerRegistry();

  /**
   * Emit without letting a subscriber take the call down with it. Listeners
   * run synchronously on the dispatch path — an SSE writer whose socket died
   * mid-write, or a logging hook with a bad assumption, would otherwise throw
   * straight out of a tool call that had already succeeded.
   */
  function safeEmit(event: string, payload: DispatchEvent): void {
    try {
      emitter.emit(event, payload);
    } catch (err) {
      log(`Kernel: dispatch listener for "${event}" threw — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** The circuit a call belongs to: its facade, or the facade that owns the tool. */
  function circuitKey(name: string): string {
    if (facadeMap.has(name)) return name;
    return toolToFacade.get(name)?.name ?? name;
  }

  function circuitOpenResult(
    key: string,
    decision: { retryAfterMs: number; lastError?: string; openedAt?: string }
  ): ToolResult {
    return {
      content: [{ type: 'text', text: JSON.stringify({
        error: `Facade "${key}" is temporarily unavailable — circuit open after repeated failures`,
        circuit_open: true,
        facade: key,
        retry_after_ms: decision.retryAfterMs,
        opened_at: decision.openedAt,
        last_error: decision.lastError,
        hint: 'The facade\'s dependency (database, network service, or mount) is failing. Other facades are unaffected.',
      }) }],
      isError: true,
    };
  }

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

  async function dispatchInner(
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
      // Also check direct INTERNAL tool calls that belong to pro/apps facades.
      // Exact reverse-map lookup (NOT a name-prefix guess) so pro tools whose names
      // don't start with their facade name can't slip the guard.
      if (!targetFacade) {
        const owner = toolToFacade.get(name);
        if (owner && (owner.tier === 'pro' || owner.tier === 'apps')) {
          return {
            content: [{ type: 'text', text: JSON.stringify({
              error: `Tool "${name}" belongs to ${owner.tier} facade "${owner.name}"`,
              facade_tier: owner.tier,
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

      let internalName = facade.actions[action];
      if (!internalName && facade.aliases?.[action]) {
        internalName = facade.actions[facade.aliases[action]];
      }
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
      // Alias project_id → projectId (snake_case callers like hooks/agents).
      // Both keys are kept: many internal tools read input.project_id directly,
      // and dropping it silently strips project scope over MCP dispatch.
      const { action: _action, params: legacyParams, ...flatParams } = args;
      const merged = { ...(legacyParams as Record<string, unknown> || {}), ...flatParams };
      if (merged.project_id !== undefined && merged.projectId === undefined) {
        merged.projectId = merged.project_id;
      }
      const params = coerceStringifiedParams(merged, tool.definition.inputSchema);

      log(`Kernel: facade ${name}.${action} → ${internalName} (agent=${agentId}${runId ? ` run=${runId}` : ''})`);
      trackToolUse(internalName);

      const breaker = circuits.beforeCall(name);
      if (!breaker.allowed) {
        safeEmit('error', {
          type: 'error', facade: name, action, tool: internalName,
          agentId, runId, requestId, timestamp: new Date().toISOString(),
          duration_ms: 0,
          error: `circuit open for facade "${name}"`,
        } satisfies DispatchEvent);
        return circuitOpenResult(name, breaker);
      }

      const startTime = Date.now();
      safeEmit('dispatch', {
        type: 'dispatch', facade: name, action, tool: internalName,
        agentId, runId, requestId, timestamp: new Date().toISOString(),
      } satisfies DispatchEvent);

      try {
        const result = await tool.handler(params);
        const duration = Date.now() - startTime;
        circuits.afterCall(name, {
          threw: false,
          isError: !!result.isError,
          durationMs: duration,
          error: result.isError ? resultErrorText(result) : undefined,
        });
        safeEmit('result', {
          type: 'result', facade: name, action, tool: internalName,
          agentId, runId, requestId, timestamp: new Date().toISOString(),
          duration_ms: duration, success: !result.isError,
        } satisfies DispatchEvent);
        return result;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const duration = Date.now() - startTime;
        circuits.afterCall(name, { threw: true, isError: true, durationMs: duration, error: errMsg });
        safeEmit('error', {
          type: 'error', facade: name, action, tool: internalName,
          agentId, runId, requestId, timestamp: new Date().toISOString(),
          duration_ms: duration,
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

    const directParams = coerceStringifiedParams(args, tool.definition.inputSchema);

    // Direct tool calls share the circuit of the facade that owns the tool —
    // `senken_trade_summary` and `senken.trade_summary` reach the same pool.
    const key = circuitKey(name);
    const breaker = circuits.beforeCall(key);
    if (!breaker.allowed) {
      safeEmit('error', {
        type: 'error', tool: name,
        agentId, runId, requestId, timestamp: new Date().toISOString(),
        duration_ms: 0,
        error: `circuit open for facade "${key}"`,
      } satisfies DispatchEvent);
      return circuitOpenResult(key, breaker);
    }

    const startTime = Date.now();
    safeEmit('dispatch', {
      type: 'dispatch', tool: name,
      agentId, runId, requestId, timestamp: new Date().toISOString(),
    } satisfies DispatchEvent);

    try {
      const result = await tool.handler(directParams);
      const duration = Date.now() - startTime;
      circuits.afterCall(key, {
        threw: false,
        isError: !!result.isError,
        durationMs: duration,
        error: result.isError ? resultErrorText(result) : undefined,
      });
      safeEmit('result', {
        type: 'result', tool: name,
        agentId, runId, requestId, timestamp: new Date().toISOString(),
        duration_ms: duration, success: !result.isError,
      } satisfies DispatchEvent);
      return result;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const duration = Date.now() - startTime;
      circuits.afterCall(key, { threw: true, isError: true, durationMs: duration, error: errMsg });
      safeEmit('error', {
        type: 'error', tool: name,
        agentId, runId, requestId, timestamp: new Date().toISOString(),
        duration_ms: duration,
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

  /**
   * The isolation boundary. Every failure a facade can produce becomes a
   * `ToolResult`, never a rejected promise: the inner dispatch already handles
   * a throwing *handler*, but the code around it can fail too — a malformed
   * schema in `coerceStringifiedParams`, an unexpected shape in facade
   * resolution, an out-of-memory string build. Whatever escapes, one facade's
   * fault must not take down a runtime that six clients share.
   *
   * The transports depend on this: `server.ts` and `httpServer.ts` turn a
   * rejected dispatch into a transport-level error, which for stdio means the
   * MCP client sees a protocol fault rather than a tool that failed.
   */
  async function dispatch(
    name: string,
    args: Record<string, unknown>,
    context?: DispatchContext
  ): Promise<ToolResult> {
    try {
      return await dispatchInner(name, args, context);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log(`Kernel: dispatch of "${name}" failed outside the handler — ${errMsg}`);
      circuits.recordFault(circuitKey(name), errMsg);
      safeEmit('error', {
        type: 'error', tool: name,
        agentId: context?.agentId || 'anonymous',
        runId: context?.runId,
        requestId: context?.requestId,
        timestamp: new Date().toISOString(),
        error: errMsg,
      } satisfies DispatchEvent);
      return {
        content: [{ type: 'text', text: JSON.stringify({
          error: errMsg,
          tool: name,
          dispatch_fault: true,
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
    off: (event: string, listener: (evt: DispatchEvent) => void) => emitter.off(event, listener),
    getMcpToolDefinitions,
    circuitSnapshot: () => circuits.snapshot(),
    resetCircuit: (key?: string) => circuits.reset(key),
    toolCount: tools.length,
    facadeCount: facades.length,
  };
}
