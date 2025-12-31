// ============================================================================
// Validation Helpers
// ============================================================================
// Common validation utilities for tool handlers.
// ============================================================================

/**
 * Validate that required fields are present in args.
 * Throws an error listing any missing fields.
 */
export function requireFields(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: any,
  ...fields: string[]
): void {
  const missing = fields.filter(f => args[f] === undefined || args[f] === null);
  if (missing.length > 0) {
    throw new Error(`Missing required field${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`);
  }
}

/**
 * Validate that a field matches one of the allowed values.
 */
export function requireOneOf<T>(
  value: T,
  fieldName: string,
  allowed: T[]
): void {
  if (!allowed.includes(value)) {
    throw new Error(`Invalid ${fieldName}: "${value}". Must be one of: ${allowed.join(', ')}`);
  }
}
