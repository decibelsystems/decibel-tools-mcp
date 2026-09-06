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

  /** Deprecated action name → canonical action name. Hidden from LLM, resolved at dispatch. */
  aliases?: Record<string, string>;

  /**
   * Reachable from a local stdio client only — never over the HTTP transport,
   * regardless of tier or license.
   *
   * For facades whose blast radius is wider than the caller's own project: the
   * `zoom` credential is account-wide admin scope, so one call over an
   * unauthenticated hosted bind hands the caller every meeting summary in the
   * account. Tier is the wrong instrument for that — it answers "may this
   * caller use pro features", not "should this reach the open internet".
   *
   * Defence in depth, not a boundary on its own. A deployment that fronts this
   * process with a local reverse proxy (senken.pro runs gunicorn in front of
   * it) makes remote requests arrive wearing a loopback source address. The
   * gate that actually holds for zoom is registration by absence: no
   * DECIBEL_ZOOM=1, no facade.
   */
  localOnly?: boolean;
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
