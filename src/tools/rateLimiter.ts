/**
 * Rate Limiter for AI Callers
 *
 * Prevents runaway scenarios where AI makes too many requests.
 * Humans bypass rate limiting entirely.
 */

import { CallerRole } from './dojoPolicy.js';
import { log } from '../config.js';

// ============================================================================
// Configuration
// ============================================================================

interface RateLimitConfig {
  maxRequestsPerMinute: number;
  maxConcurrent: number;
}

const DEFAULT_LIMITS: Record<CallerRole, RateLimitConfig> = {
  human: { maxRequestsPerMinute: Infinity, maxConcurrent: Infinity },
  mother: { maxRequestsPerMinute: 30, maxConcurrent: 3 },
  ai: { maxRequestsPerMinute: 20, maxConcurrent: 2 },
};

// ============================================================================
// State
// ============================================================================

interface RateLimitState {
  requests: number[];  // timestamps of recent requests
  concurrent: number;  // current concurrent requests
}

const state = new Map<CallerRole, RateLimitState>();

function getState(role: CallerRole): RateLimitState {
  if (!state.has(role)) {
    state.set(role, { requests: [], concurrent: 0 });
  }
  return state.get(role)!;
}

// ============================================================================
// Rate Limiting
// ============================================================================

export interface RateLimitResult {
  allowed: boolean;
  reason?: string;
  retryAfterMs?: number;
}

/**
 * Check if a request is allowed under rate limits.
 * Call this BEFORE processing a request.
 */
export function checkRateLimit(callerRole: CallerRole = 'human'): RateLimitResult {
  const limits = DEFAULT_LIMITS[callerRole];
  const roleState = getState(callerRole);
  const now = Date.now();
  const oneMinuteAgo = now - 60_000;

  // Clean old requests
  roleState.requests = roleState.requests.filter(ts => ts > oneMinuteAgo);

  // Check concurrent limit
  if (roleState.concurrent >= limits.maxConcurrent) {
    log(`rateLimiter: ${callerRole} blocked - concurrent limit (${roleState.concurrent}/${limits.maxConcurrent})`);
    return {
      allowed: false,
      reason: `Concurrent request limit reached (${limits.maxConcurrent}). Wait for current requests to complete.`,
    };
  }

  // Check requests per minute
  if (roleState.requests.length >= limits.maxRequestsPerMinute) {
    const oldestRequest = roleState.requests[0];
    const retryAfterMs = oldestRequest + 60_000 - now;
    log(`rateLimiter: ${callerRole} blocked - rate limit (${roleState.requests.length}/${limits.maxRequestsPerMinute}/min)`);
    return {
      allowed: false,
      reason: `Rate limit exceeded (${limits.maxRequestsPerMinute} requests/minute). Try again in ${Math.ceil(retryAfterMs / 1000)}s.`,
      retryAfterMs,
    };
  }

  return { allowed: true };
}

/**
 * Record that a request has started.
 * Call this AFTER checkRateLimit returns allowed: true.
 */
export function recordRequestStart(callerRole: CallerRole = 'human'): void {
  const roleState = getState(callerRole);
  roleState.requests.push(Date.now());
  roleState.concurrent++;
  log(`rateLimiter: ${callerRole} request started (concurrent: ${roleState.concurrent})`);
}

/**
 * Record that a request has completed.
 * Call this in a finally block after processing.
 */
export function recordRequestEnd(callerRole: CallerRole = 'human'): void {
  const roleState = getState(callerRole);
  roleState.concurrent = Math.max(0, roleState.concurrent - 1);
  log(`rateLimiter: ${callerRole} request ended (concurrent: ${roleState.concurrent})`);
}

/**
 * Get current rate limit status for monitoring/debugging.
 */
export function getRateLimitStatus(callerRole: CallerRole): {
  requestsInLastMinute: number;
  concurrent: number;
  limits: RateLimitConfig;
} {
  const limits = DEFAULT_LIMITS[callerRole];
  const roleState = getState(callerRole);
  const oneMinuteAgo = Date.now() - 60_000;
  const recentRequests = roleState.requests.filter(ts => ts > oneMinuteAgo);

  return {
    requestsInLastMinute: recentRequests.length,
    concurrent: roleState.concurrent,
    limits,
  };
}

/**
 * Reset rate limit state (useful for testing).
 */
export function resetRateLimits(): void {
  state.clear();
}
