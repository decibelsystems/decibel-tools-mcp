// ============================================================================
// Facade Types
// ============================================================================
// A facade collapses N internal tool handlers into one MCP-visible tool
// with an `action` enum. This reduces LLM context from ~32K to ~3-5K tokens.
// ============================================================================

/**
 * Facade specification — defines one MCP-visible tool that dispatches
 * to multiple internal handlers based on the `action` parameter.
 */
export interface FacadeSpec {
  /** MCP tool name (e.g. "sentinel", "architect") */
  name: string;

  /** Full description for capable models (Claude, GPT-4) */
  description: string;

  /** One-line description for mid-range SLMs (7-13B) */
  compactDescription: string;

  /** Whether to include in micro tier (tiny SLMs, edge, mobile) */
  microEligible: boolean;

  /** Availability tier: core (public), pro (DECIBEL_PRO), apps (DECIBEL_APPS — internal only) */
  tier: 'core' | 'pro' | 'apps';

  /**
   * Action name → internal tool name mapping.
   * Keys are the enum values the LLM sends (snake_case).
   * Values are the internal tool names in the kernel's toolMap.
   *
   * Example: { "create_issue": "sentinel_create_issue", "list_epics": "sentinel_list_epics" }
   */
  actions: Record<string, string>;
}

/** Detail tier for tool descriptions */
export type DetailTier = 'full' | 'compact' | 'micro';

/** MCP tool definition shape (matches ToolSpec['definition']) */
export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
}
