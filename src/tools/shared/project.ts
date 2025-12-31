// ============================================================================
// Project Resolution Helper
// ============================================================================
// Wraps tool handlers with automatic project resolution.
// ============================================================================

import {
  resolveProjectPaths,
  ResolvedProjectPaths,
} from '../../projectRegistry.js';
import { ToolResult } from '../types.js';
import { toolError } from './response.js';

/**
 * Wrap a tool handler with automatic project resolution.
 * Handles PROJECT_NOT_FOUND errors with helpful hints.
 */
export async function withProject<T>(
  args: { projectId?: string },
  fn: (resolved: ResolvedProjectPaths) => Promise<T>
): Promise<T> {
  try {
    const resolved = resolveProjectPaths(args.projectId);
    return await fn(resolved);
  } catch (err) {
    // Re-throw with the error message (which now includes helpful hints)
    throw err;
  }
}

/**
 * Wrap a tool handler that requires a project, returning ToolResult on error.
 * Use this for top-level tool handlers.
 */
export async function withProjectResult(
  args: { projectId?: string },
  fn: (resolved: ResolvedProjectPaths) => Promise<ToolResult>
): Promise<ToolResult> {
  try {
    const resolved = resolveProjectPaths(args.projectId);
    return await fn(resolved);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return toolError(message);
  }
}
