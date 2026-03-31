import { isQueueable, QUEUEABLE_ACTIONS } from './config/queueableActions.js';

/**
 * Parse a tool call into facade + action.
 * Handles both styles:
 *   - Facade call: tool="sentinel", args.action="create_issue"
 *   - Direct call: tool="sentinel_create_issue"
 */
export function parseToolCall(
  tool: string,
  args: Record<string, unknown>
): { facade: string; action: string } | null {
  // Style 1: facade call with action in args
  if (args.action && typeof args.action === 'string') {
    return { facade: tool, action: args.action };
  }

  // Style 2: underscore-separated tool name
  for (const facade of Object.keys(QUEUEABLE_ACTIONS)) {
    const prefix = `${facade}_`;
    if (tool.startsWith(prefix)) {
      const action = tool.slice(prefix.length);
      if (action) return { facade, action };
    }
  }

  return null;
}

/**
 * Should this tool call be queued instead of executed?
 * True when: remote agent + queueable action.
 */
export function shouldQueueForAgent(
  tool: string,
  args: Record<string, unknown>,
  agentId: string | undefined,
): boolean {
  if (!agentId) return false;
  const parsed = parseToolCall(tool, args);
  if (!parsed) return false;
  return isQueueable(parsed.facade, parsed.action);
}
