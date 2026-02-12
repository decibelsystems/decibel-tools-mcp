// ============================================================================
// Tool Kernel — single source of truth for tool dispatch
// ============================================================================
// The kernel owns: tool registry, dispatch, agent context threading,
// and logging hooks. Both stdio and HTTP transports import the kernel.
//
// Phase 1c: Extract from server.ts and httpServer.ts
// Phase 1d: Will add facade layer on top of this
// Phase 4:  Will add dispatch hooks, batch, and agent messaging
// ============================================================================

import { getAllTools } from './tools/index.js';
import { trackToolUse } from './tools/shared/index.js';
import { log } from './config.js';
import type { ToolSpec, ToolResult } from './tools/types.js';

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

// ============================================================================
// Tool Kernel
// ============================================================================

export interface ToolKernel {
  /** All tool definitions (what MCP tools/list returns) */
  tools: ToolSpec[];
  /** Fast lookup by tool name */
  toolMap: Map<string, ToolSpec>;
  /** Dispatch a tool call with optional agent context */
  dispatch(name: string, args: Record<string, unknown>, context?: DispatchContext): Promise<ToolResult>;
  /** Total tool count */
  toolCount: number;
}

/**
 * Create the tool kernel. Call once at startup — both transports share it.
 */
export async function createKernel(): Promise<ToolKernel> {
  const tools = await getAllTools();
  const toolMap = new Map(tools.map(t => [t.definition.name, t]));

  log(`Kernel: loaded ${tools.length} tools`);

  async function dispatch(
    name: string,
    args: Record<string, unknown>,
    context?: DispatchContext
  ): Promise<ToolResult> {
    const tool = toolMap.get(name);
    if (!tool) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: `Unknown tool: ${name}` }) }],
        isError: true,
      };
    }

    const agentId = context?.agentId || 'anonymous';
    const runId = context?.runId;

    log(`Kernel: dispatch ${name} (agent=${agentId}${runId ? ` run=${runId}` : ''})`);

    trackToolUse(name);
    return tool.handler(args);
  }

  return {
    tools,
    toolMap,
    dispatch,
    toolCount: tools.length,
  };
}
