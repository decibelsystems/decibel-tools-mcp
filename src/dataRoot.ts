import fs from 'fs';

// ============================================================================
// Directory Utilities
// ============================================================================
//
// This module provides simple directory utilities.
// Project resolution is handled by projectRegistry.ts.
//
// HISTORICAL NOTE (2026-01-10): Removed ~250 lines of dead code including
// resolvePath(), DataDomain types, hasProjectLocal(), getProjectName(), and
// initProjectDecibel(). These were superseded by projectRegistry.ts but
// never cleaned up. Verified zero callers before removal (external second
// opinion confirmed safety).
// ============================================================================

/**
 * Ensure a directory exists before writing
 */
export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}
