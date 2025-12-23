// ============================================================================
// Project Path Resolution
// ============================================================================
// Helps MCP tools resolve project roots from project IDs.
// Uses registry-based resolution with fallback to dynamic discovery.
// ============================================================================

import fs from 'fs';
import path from 'path';
import { resolveProject, ProjectEntry, listProjects } from './projectRegistry.js';

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
 * Resolution strategy (via projectRegistry):
 * 1. Check registry for exact ID or alias match
 * 2. Check DECIBEL_PROJECT_ROOT env var
 * 3. Check if projectId is a valid absolute path
 * 4. Walk up from cwd looking for matching project
 *
 * @param projectId - The unique identifier for the project (ID, alias, or path)
 * @returns The project configuration including root path
 * @throws Error if the project cannot be resolved
 */
export async function resolveProjectRoot(
  projectId: string
): Promise<ProjectConfig> {
  try {
    const entry: ProjectEntry = resolveProject(projectId);
    return {
      projectId: entry.id,
      projectName: entry.name || entry.id,
      root: entry.path,
    };
  } catch (err) {
    // Re-throw with the helpful error message from registry
    throw err;
  }
}

/**
 * List all known project IDs.
 * Returns projects from the registry plus any discovered from cwd.
 *
 * @returns Array of discovered project IDs
 */
export function listProjectIds(): string[] {
  const registeredProjects = listProjects();
  const ids = registeredProjects.map((p: ProjectEntry) => p.id);

  // Also check cwd for a local project not in registry
  const currentProjectRoot = process.env.DECIBEL_PROJECT_ROOT || process.cwd();
  const discoveredRoot = findDecibelDir(currentProjectRoot);
  if (discoveredRoot) {
    const localId = getProjectNameFromDir(discoveredRoot);
    if (!ids.includes(localId)) {
      ids.push(localId);
    }
  }

  return ids;
}
