// ============================================================================
// Project Path Resolution
// ============================================================================
// Helps MCP tools resolve project roots from project IDs.
// Uses dynamic discovery based on .decibel folder locations.
// ============================================================================

import fs from 'fs';
import path from 'path';

// ============================================================================
// Types
// ============================================================================

export interface ProjectConfig {
  projectId: string;
  projectName?: string;
  root: string;
}

// ============================================================================
// Path Resolution Helpers
// ============================================================================

/**
 * Walk up directory tree looking for a .decibel folder
 */
function findDecibelDir(start: string): string | undefined {
  let current = path.resolve(start);
  while (true) {
    const candidate = path.join(current, '.decibel');
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return current; // Return the project root, not the .decibel folder
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return undefined;
}

/**
 * Get the project name from a project root directory
 */
function getProjectNameFromDir(projectRoot: string): string {
  return path.basename(projectRoot);
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Resolve project configuration from a project ID.
 *
 * Resolution strategy:
 * 1. If projectId matches the current project (based on cwd or DECIBEL_PROJECT_ROOT), use that
 * 2. Check if projectId is a valid path to a project with .decibel folder
 * 3. Otherwise throw an error with helpful guidance
 *
 * @param projectId - The unique identifier for the project (directory name or path)
 * @returns The project configuration including root path
 * @throws Error if the project cannot be resolved
 */
export async function resolveProjectRoot(
  projectId: string
): Promise<ProjectConfig> {
  // Strategy 1: Check if we're in a project that matches the projectId
  const currentProjectRoot = process.env.DECIBEL_PROJECT_ROOT || process.cwd();
  const discoveredRoot = findDecibelDir(currentProjectRoot);

  if (discoveredRoot) {
    const discoveredName = getProjectNameFromDir(discoveredRoot);
    if (discoveredName === projectId || path.basename(discoveredRoot) === projectId) {
      return {
        projectId,
        projectName: discoveredName,
        root: discoveredRoot,
      };
    }
  }

  // Strategy 2: Check if projectId is a path to a project with .decibel
  if (fs.existsSync(projectId)) {
    const absolutePath = path.resolve(projectId);
    const decibelPath = path.join(absolutePath, '.decibel');
    if (fs.existsSync(decibelPath) && fs.statSync(decibelPath).isDirectory()) {
      return {
        projectId: path.basename(absolutePath),
        projectName: path.basename(absolutePath),
        root: absolutePath,
      };
    }
  }

  // If we have a discovered project, suggest using that
  if (discoveredRoot) {
    throw new Error(
      `Unknown projectId: "${projectId}". ` +
      `Current project is "${getProjectNameFromDir(discoveredRoot)}" at ${discoveredRoot}. ` +
      `Either use the current project ID or provide a path to a project with a .decibel folder.`
    );
  }

  throw new Error(
    `Unknown projectId: "${projectId}". ` +
    `No .decibel folder found in current directory tree. ` +
    `Run from within a project that has a .decibel folder, or provide a path to one.`
  );
}

/**
 * List all known project IDs.
 * Returns the current project if discovered.
 *
 * @returns Array of discovered project IDs
 */
export function listProjectIds(): string[] {
  const currentProjectRoot = process.env.DECIBEL_PROJECT_ROOT || process.cwd();
  const discoveredRoot = findDecibelDir(currentProjectRoot);

  if (discoveredRoot) {
    return [getProjectNameFromDir(discoveredRoot)];
  }

  return [];
}
