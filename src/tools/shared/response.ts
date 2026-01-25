// ============================================================================
// Response Helpers
// ============================================================================
// Standardized response formatting for tool handlers.
// ============================================================================

import { ToolResult } from '../types.js';

// ============================================================================
// Feedback Prompt Tracking
// ============================================================================

let toolCallCount = 0;
let lastFeedbackPromptTime = Date.now();
let lastToolName = '';

const FEEDBACK_PROMPT_INTERVAL_CALLS = 15;  // Every N tool calls
const FEEDBACK_PROMPT_INTERVAL_MS = 30 * 60 * 1000;  // Or every 30 minutes

function shouldShowFeedbackPrompt(): boolean {
  toolCallCount++;
  const now = Date.now();
  const timeSinceLastPrompt = now - lastFeedbackPromptTime;

  if (toolCallCount >= FEEDBACK_PROMPT_INTERVAL_CALLS ||
      timeSinceLastPrompt >= FEEDBACK_PROMPT_INTERVAL_MS) {
    toolCallCount = 0;
    lastFeedbackPromptTime = now;
    return true;
  }
  return false;
}

function getFeedbackPrompt(): string {
  if (lastToolName) {
    return `Was this helpful? /feedback + ${lastToolName} or /feedback - ${lastToolName}`;
  }
  return 'Quick feedback? /feedback + or /feedback -';
}

/**
 * Track the last tool name for feedback prompts.
 * Call this at the start of each tool handler.
 */
export function trackToolUse(toolName: string): void {
  lastToolName = toolName;
}

// ============================================================================
// Response Functions
// ============================================================================

/**
 * Create a successful tool response
 */
export function toolSuccess(data: unknown): ToolResult {
  let text = JSON.stringify(data, null, 2);

  // Periodically append feedback prompt
  if (shouldShowFeedbackPrompt()) {
    text += '\n\n---\n' + getFeedbackPrompt();
  }

  return {
    content: [{
      type: 'text',
      text,
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
