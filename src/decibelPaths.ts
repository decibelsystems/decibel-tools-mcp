// ============================================================================
// Decibel Path Resolution with Fallback
// ============================================================================
// Handles both .decibel/ (preferred) and decibel/ (legacy) folder structures.
// Reads from both locations, writes to .decibel/ only.
// ============================================================================

import fs from 'fs/promises';
import path from 'path';
import { resolveProjectRoot } from './projectPaths.js';
import { log } from './config.js';

// ============================================================================
// Types
// ============================================================================

export interface DecibelPaths {
  /** Primary path (.decibel/) - used for writes */
  primary: string;
  /** Legacy path (decibel/) - checked for reads if primary doesn't exist */
  legacy: string;
  /** Which path actually exists (or 'none') */
  activeSource: 'primary' | 'legacy' | 'none';
  /** Warning message if legacy path is being used */
  deprecationWarning?: string;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Check if a directory exists
 */
/**
 * Does this directory exist — and say so only when we could actually tell.
 *
 * ISS-0153, second round. The readdir calls below were made to THROW on an
 * unreadable store rather than return empty, and the fix was reported as
 * landed. It never fired: every one of them sits behind this guard, and this
 * guard caught everything. A store at chmod 000 makes stat() fail with EACCES
 * on the directory INSIDE it, so `dirExists` answered false, the readdir was
 * skipped, and the throw was unreachable. The result was the exact behaviour
 * the fix was written to remove — "no issues" for a project whose issues could
 * not be read — with the code that says otherwise sitting right there.
 *
 * ENOENT and ENOTDIR mean the directory genuinely is not there, which is what
 * an untouched project looks like. Every other errno means it may well be
 * there and this process cannot see it, and that is not an answer this
 * function is entitled to give.
 */
async function dirExists(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return false;
    throw new Error(`STORE_UNREADABLE: cannot stat ${dirPath} (${code ?? 'unknown'})`);
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Resolve decibel paths for a project, checking both .decibel/ and decibel/
 * 
 * @param projectId - The project identifier
 * @param subpath - Path within the decibel folder (e.g., 'sentinel/issues')
 * @returns DecibelPaths object with primary, legacy, and active source info
 */
export async function resolveDecibelPaths(
  projectId: string,
  subpath: string
): Promise<DecibelPaths> {
  const project = await resolveProjectRoot(projectId);
  
  const primary = path.join(project.root, '.decibel', subpath);
  const legacy = path.join(project.root, 'decibel', subpath);
  
  const primaryExists = await dirExists(primary);
  const legacyExists = await dirExists(legacy);
  
  let activeSource: 'primary' | 'legacy' | 'none' = 'none';
  let deprecationWarning: string | undefined;
  
  if (primaryExists) {
    activeSource = 'primary';
    // Also warn if legacy exists alongside primary (might have orphaned data)
    if (legacyExists) {
      deprecationWarning = `⚠️ Both .decibel/ and decibel/ exist for ${projectId}. Data may be split. Consider migrating decibel/ → .decibel/`;
      log(deprecationWarning);
    }
  } else if (legacyExists) {
    activeSource = 'legacy';
    deprecationWarning = `⚠️ Using legacy decibel/ path for ${projectId}. Consider migrating to .decibel/`;
    log(deprecationWarning);
  }
  
  return {
    primary,
    legacy,
    activeSource,
    deprecationWarning,
  };
}

/**
 * Get the read path for a decibel subpath.
 * Returns primary if it exists, falls back to legacy, or returns primary for new projects.
 */
export async function getReadPath(
  projectId: string,
  subpath: string
): Promise<string> {
  const paths = await resolveDecibelPaths(projectId, subpath);
  
  if (paths.activeSource === 'primary') {
    return paths.primary;
  } else if (paths.activeSource === 'legacy') {
    return paths.legacy;
  }
  
  // Neither exists - return primary (will be created on first write)
  return paths.primary;
}

/**
 * Get the write path for a decibel subpath.
 * Always returns the primary (.decibel/) path.
 */
export async function getWritePath(
  projectId: string,
  subpath: string
): Promise<string> {
  const project = await resolveProjectRoot(projectId);
  return path.join(project.root, '.decibel', subpath);
}

/**
 * Get all read paths that exist for a subpath.
 * Used when you need to merge data from both locations.
 */
export async function getAllReadPaths(
  projectId: string,
  subpath: string
): Promise<string[]> {
  const paths = await resolveDecibelPaths(projectId, subpath);
  const result: string[] = [];
  
  if (await dirExists(paths.primary)) {
    result.push(paths.primary);
  }
  if (await dirExists(paths.legacy)) {
    result.push(paths.legacy);
  }
  
  return result;
}

/**
 * Read files from both primary and legacy paths, deduping by filename.
 * Primary takes precedence over legacy for duplicate filenames.
 */
export async function readFilesFromBothPaths(
  projectId: string,
  subpath: string,
  extensions: string[] = ['.yml', '.yaml', '.md']
): Promise<{ filePath: string; source: 'primary' | 'legacy' }[]> {
  const paths = await resolveDecibelPaths(projectId, subpath);
  const seen = new Set<string>();
  const results: { filePath: string; source: 'primary' | 'legacy' }[] = [];
  // ISS-0153: a directory that exists but cannot be opened is NOT an empty
  // directory. Both reads below used to `catch { /* Directory read failed */ }`
  // and return whatever had been collected — which, for an unreadable store,
  // was nothing. Every caller then reported "no issues" for a project whose
  // issues it simply could not see.
  //
  // These now THROW. "I could not look" is an exceptional condition, not an
  // empty result, and letting it propagate turns it into a loud tool failure at
  // no cost to the six call sites. Note the dirExists() guard above already
  // handles the ordinary not-created-yet case, so reaching the readdir at all
  // means the directory is really there.
  
  // Read primary first (takes precedence)
  if (await dirExists(paths.primary)) {
    try {
      const files = await fs.readdir(paths.primary);
      for (const file of files) {
        if (extensions.some(ext => file.endsWith(ext))) {
          seen.add(file);
          results.push({
            filePath: path.join(paths.primary, file),
            source: 'primary',
          });
        }
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? 'unknown';
      throw new Error(`STORE_UNREADABLE: cannot read ${paths.primary} (${code})`);
    }
  }
  
  // Read legacy, skip duplicates
  if (await dirExists(paths.legacy)) {
    try {
      const files = await fs.readdir(paths.legacy);
      for (const file of files) {
        if (extensions.some(ext => file.endsWith(ext)) && !seen.has(file)) {
          results.push({
            filePath: path.join(paths.legacy, file),
            source: 'legacy',
          });
          if (paths.deprecationWarning === undefined) {
            log(`⚠️ Reading ${file} from legacy decibel/ path for ${projectId}`);
          }
        }
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? 'unknown';
      throw new Error(`STORE_UNREADABLE: cannot read ${paths.legacy} (${code})`);
    }
  }

  return results;
}
