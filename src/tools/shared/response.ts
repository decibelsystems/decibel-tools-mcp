// ============================================================================
// Response Helpers
// ============================================================================
// Standardized response formatting for tool handlers.
// ============================================================================

import { ToolResult } from '../types.js';

/**
 * Create a successful tool response
 */
export function toolSuccess(data: unknown): ToolResult {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(data, null, 2),
    }],
  };
}

/**
 * Create an error tool response
 */
export function toolError(error: string, hint?: string): ToolResult {
  const payload: Record<string, unknown> = {
    success: false,
    error,
  };
  if (hint) {
    payload.hint = hint;
  }
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(payload, null, 2),
    }],
    isError: true,
  };
}
