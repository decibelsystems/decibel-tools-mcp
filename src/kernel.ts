// ============================================================================
// Tool Kernel — single source of truth for tool dispatch
// ============================================================================
// The kernel owns: tool registry, facade registry, dispatch, agent context
// threading, and logging hooks. Both stdio and HTTP transports import the kernel.
//
// Phase 1c: Extract from server.ts and httpServer.ts
// Phase 1d: Facade layer — ~22 public tools dispatching to ~170 internal handlers
// Phase 4:  Will add dispatch hooks, batch, and agent messaging
// ============================================================================

import { getAllTools } from './tools/index.js';
import { trackToolUse } from './tools/shared/index.js';
import { log } from './config.js';
import type { ToolSpec, ToolResult } from './tools/types.js';
import type { FacadeSpec, DetailTier, McpToolDefinition } from './facades/types.js';
import { coreFacades, proFacades } from './facades/definitions.js';
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
}

// Pro tier check (same logic as tools/index.ts)
const PRO_ENABLED = process.env.DECIBEL_PRO === '1' || process.env.NODE_ENV !== 'production';

// ============================================================================
// Tool Kernel
// ============================================================================

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
   * - Facade calls: name="sentinel", args={ action: "create_issue", params: {...} }
   * - Direct calls: name="sentinel_create_issue", args={...}  (backward compat)
   */
  dispatch(name: string, args: Record<string, unknown>, context?: DispatchContext): Promise<ToolResult>;

  /**
   * Get MCP tool definitions for the tools/list response.
   * Returns facade definitions filtered by detail tier.
   */
  getMcpToolDefinitions(tier?: DetailTier): McpToolDefinition[];

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

  // Build facade registry (core + pro if enabled)
  const facades = PRO_ENABLED
    ? [...coreFacades, ...proFacades]
    : [...coreFacades];
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

  // Pre-build MCP definitions for each tier (cached)
  const mcpDefCache = new Map<DetailTier, McpToolDefinition[]>();

  function getMcpToolDefinitions(tier: DetailTier = 'full'): McpToolDefinition[] {
    let cached = mcpDefCache.get(tier);
    if (!cached) {
      cached = buildMcpDefinitions(facades, tier);
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

      const params = (args.params || {}) as Record<string, unknown>;

      log(`Kernel: facade ${name}.${action} → ${internalName} (agent=${agentId}${runId ? ` run=${runId}` : ''})`);
      trackToolUse(internalName);
      return tool.handler(params);
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
    return tool.handler(args);
  }

  return {
    tools,
    toolMap,
    facades,
    facadeMap,
    dispatch,
    getMcpToolDefinitions,
    toolCount: tools.length,
    facadeCount: facades.length,
  };
}
