// ============================================================================
// Tool Types
// ============================================================================
// Shared type definitions for the modular tool architecture.
// ============================================================================

/**
 * Standard MCP tool result format
 */
export interface ToolResult {
  content: Array<{
    type: 'text';
    text: string;
  }>;
  isError?: boolean;
}

/**
 * MCP Tool Annotations for Connectors Directory compliance.
 * These hints describe tool behavior for safety and UX purposes.
 */
export interface ToolAnnotations {
  /** Human-readable title for the tool */
  title?: string;
  /** Tool only reads data, never modifies it */
  readOnlyHint?: boolean;
  /** Tool performs destructive/irreversible actions */
  destructiveHint?: boolean;
  /** Multiple calls produce the same result */
  idempotentHint?: boolean;
  /** Tool accesses external resources (network, APIs) */
  openWorldHint?: boolean;
}

/**
 * Tool specification combining definition and handler.
 * Each tool exports one of these, domains export arrays of them.
 *
 * Note: We use `any` for the handler args to allow flexible typing
 * while maintaining type safety within each tool's implementation.
 */
export interface ToolSpec {
  definition: {
    name: string;
    description: string;
    inputSchema: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
    };
    annotations?: ToolAnnotations;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (args: any) => Promise<ToolResult>;
}
