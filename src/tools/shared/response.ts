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
  // THE FIRST CONTENT BLOCK IS DATA AND ONLY DATA.
  //
  // The feedback prompt used to be concatenated onto this string:
  //
  //     text += '\n\n---\n' + getFeedbackPrompt();
  //
  // which made the block invalid JSON on every fifteenth call, and on the
  // first call after thirty idle minutes. An agent reading the text tolerates
  // the trailing prose, so it looked harmless for a long time. Every
  // programmatic consumer broke instead, intermittently and at a rate nobody
  // could tie to a cause:
  //
  //   - HTTP /call parses this text and falls back to `{message: <raw text>}`
  //     when the parse fails, so one call in fifteen returned the entire
  //     payload stringified into `message` with no `events` / `issues` key at
  //     all. HQ read that as zero results and spent two rounds diagnosing it
  //     as a rate limiter, then as fd exhaustion (2026-08-30).
  //   - FacadeClient's stdio transport calls JSON.parse on it directly and
  //     would simply throw.
  //
  // MCP content is a LIST of blocks for exactly this reason. The prompt is
  // prose for a human, so it goes in its own block, where a JSON reader taking
  // content[0] never sees it and a chat client still renders it.
  const content: ToolResult['content'] = [{
    type: 'text',
    text: JSON.stringify(data, null, 2),
  }];

  if (shouldShowFeedbackPrompt()) {
    content.push({ type: 'text', text: getFeedbackPrompt() });
  }

  return { content };
}

/**
 * True when a payload is already a machine-readable error object.
 *
 * Deliberately narrow: a STRING `error` field, and not a payload that has
 * explicitly declared itself a success. A payload carrying `error` as data —
 * a list of errors, an error count — is not this shape and must not be
 * mistaken for it.
 */
export function isErrorPayload(payload: unknown): payload is Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const p = payload as Record<string, unknown>;
  return typeof p.error === 'string' && p.success !== true;
}

/**
 * Return a structured failure WITH its payload intact.
 *
 * `toolError` builds a fresh `{success, error, hint}` object, which is right
 * when all you have is a message but wrong when the tool already produced a
 * machine-readable error — it drops every other field, `message` included.
 *
 * The alternative that was in use is worse: `toolSuccess(result)` on a payload
 * carrying an `error` field. That is the exact shape S1 hunts for — it reads
 * as failure to a human and as SUCCESS to every programmatic consumer, because
 * `isError` is what they branch on. designer.tokens, designer.drift and
 * designer.lateral_session each answered `{error: "NO_TOKENS"}` with the
 * failure marker unset.
 */
export function toolFailure(payload: Record<string, unknown>): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    isError: true,
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
