// ============================================================================
// Project Registry
// ============================================================================
// Maps project IDs/aliases to their filesystem paths.
// Supports multiple resolution strategies:
//   1. Registry file (~/.decibel/projects.json or DECIBEL_REGISTRY_PATH)
//   2. Environment variable (DECIBEL_PROJECT_ROOT for single project)
//   3. Dynamic discovery (walking up from cwd)
// ============================================================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { log } from './config.js';

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ============================================================================
// Types
// ============================================================================

export interface ProjectEntry {
  /** Primary ID (usually directory name) */
  id: string;
  /** Human-readable name */
  name?: string;
  /** Absolute path to project root (contains .decibel/) */
  path: string;
  /** Optional aliases (e.g., "senken" -> "senken-trading-agent") */
  aliases?: string[];
  /** If true, this is the default project when none specified */
  default?: boolean;
}

export interface ProjectRegistry {
  version: 1;
  projects: ProjectEntry[];
}

// ============================================================================
// Registry Loading
// ============================================================================

/**
 * Get the path to the registry file.
 * Default: projects.json in the same directory as this MCP tool.
 */
function getRegistryPath(): string {
  if (process.env.DECIBEL_REGISTRY_PATH) {
    return process.env.DECIBEL_REGISTRY_PATH;
  }
  
  // Default: projects.json in the MCP repo root (sibling to src/)
  // __dirname at runtime is dist/, so go up one level
  const mcpRoot = path.resolve(__dirname, '..');
  return path.join(mcpRoot, 'projects.json');
}

/**
 * Load the project registry from disk
 */
function loadRegistry(): ProjectRegistry {
  const registryPath = getRegistryPath();

  if (!fs.existsSync(registryPath)) {
    log(`ProjectRegistry: No registry file at ${registryPath}`);
    return { version: 1, projects: [] };
  }

  try {
    const content = fs.readFileSync(registryPath, 'utf-8');
    const data = JSON.parse(content) as ProjectRegistry;
    log(`ProjectRegistry: Loaded ${data.projects.length} projects from ${registryPath}`);
    return data;
  } catch (err) {
    log(`ProjectRegistry: Failed to load registry: ${err}`);
    return { version: 1, projects: [] };
  }
}

/**
 * Save the project registry to disk
 */
function saveRegistry(registry: ProjectRegistry): void {
  const registryPath = getRegistryPath();
  const dir = path.dirname(registryPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));
  log(`ProjectRegistry: Saved ${registry.projects.length} projects to ${registryPath}`);
}

// ============================================================================
// Discovery Helpers
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
 * Validate that a path contains a .decibel folder
 */
function hasDecibelFolder(projectPath: string): boolean {
  const decibelPath = path.join(projectPath, '.decibel');
  return fs.existsSync(decibelPath) && fs.statSync(decibelPath).isDirectory();
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Resolve a project ID or alias to its filesystem path.
 *
 * Resolution order:
 * 1. Check registry for exact ID match
 * 2. Check registry for alias match
 * 3. Check DECIBEL_PROJECT_ROOT env var (if ID matches basename)
 * 4. Check if ID is an absolute path with .decibel
 * 5. Walk up from cwd looking for .decibel (if ID matches discovered project)
 *
 * @param projectId - Project ID, alias, or path
 * @returns Absolute path to the project root
 * @throws Error if project cannot be resolved
 */
export function resolveProject(projectId: string): ProjectEntry {
  const registry = loadRegistry();

  // Strategy 1: Exact ID match in registry
  const exactMatch = registry.projects.find((p) => p.id === projectId);
  if (exactMatch) {
    if (!hasDecibelFolder(exactMatch.path)) {
      throw new Error(
        `Project "${projectId}" registered at ${exactMatch.path} but .decibel folder not found. ` +
        `Update the registry or run 'decibel init' in that directory.`
      );
    }
    log(`ProjectRegistry: Resolved "${projectId}" via exact ID match`);
    return exactMatch;
  }

  // Strategy 2: Alias match in registry
  const aliasMatch = registry.projects.find((p) => p.aliases?.includes(projectId));
  if (aliasMatch) {
    if (!hasDecibelFolder(aliasMatch.path)) {
      throw new Error(
        `Project "${projectId}" (alias for "${aliasMatch.id}") registered at ${aliasMatch.path} ` +
        `but .decibel folder not found.`
      );
    }
    log(`ProjectRegistry: Resolved "${projectId}" via alias -> "${aliasMatch.id}"`);
    return aliasMatch;
  }

  // Strategy 3: DECIBEL_PROJECT_ROOT env var
  const envRoot = process.env.DECIBEL_PROJECT_ROOT;
  if (envRoot && path.basename(envRoot) === projectId) {
    if (hasDecibelFolder(envRoot)) {
      log(`ProjectRegistry: Resolved "${projectId}" via DECIBEL_PROJECT_ROOT`);
      return { id: projectId, path: envRoot };
    }
  }

  // Strategy 4: Absolute path with .decibel
  if (path.isAbsolute(projectId) && hasDecibelFolder(projectId)) {
    log(`ProjectRegistry: Resolved "${projectId}" as absolute path`);
    return { id: path.basename(projectId), path: projectId };
  }

  // Strategy 5: Discover from cwd
  const discoveredRoot = findDecibelDir(process.cwd());
  if (discoveredRoot && path.basename(discoveredRoot) === projectId) {
    log(`ProjectRegistry: Resolved "${projectId}" via cwd discovery`);
    return { id: projectId, path: discoveredRoot };
  }

  // Build helpful error message
  const registeredIds = registry.projects.map((p) => p.id);
  const allAliases = registry.projects.flatMap((p) => p.aliases || []);
  const suggestions = [...registeredIds, ...allAliases].filter(Boolean);

  let errorMsg = `Unknown project: "${projectId}".`;
  if (suggestions.length > 0) {
    errorMsg += ` Registered projects: ${suggestions.join(', ')}.`;
  }
  if (discoveredRoot) {
    errorMsg += ` Current directory is in project "${path.basename(discoveredRoot)}".`;
  }
  errorMsg += ` Register this project with 'decibel registry add'.`;

  throw new Error(errorMsg);
}

/**
 * List all registered projects
 */
export function listProjects(): ProjectEntry[] {
  const registry = loadRegistry();
  return registry.projects;
}

/**
 * Register a new project or update an existing one
 */
export function registerProject(entry: ProjectEntry): void {
  const registry = loadRegistry();

  // Validate path exists and has .decibel
  if (!fs.existsSync(entry.path)) {
    throw new Error(`Path does not exist: ${entry.path}`);
  }
  if (!hasDecibelFolder(entry.path)) {
    throw new Error(
      `No .decibel folder found at ${entry.path}. ` +
      `Initialize with 'decibel init' first.`
    );
  }

  // Normalize path
  entry.path = path.resolve(entry.path);

  // Check for duplicate ID
  const existingIdx = registry.projects.findIndex((p) => p.id === entry.id);
  if (existingIdx >= 0) {
    // Update existing
    registry.projects[existingIdx] = entry;
    log(`ProjectRegistry: Updated project "${entry.id}"`);
  } else {
    // Add new
    registry.projects.push(entry);
    log(`ProjectRegistry: Added project "${entry.id}"`);
  }

  saveRegistry(registry);
}

/**
 * Remove a project from the registry
 */
export function unregisterProject(projectId: string): boolean {
  const registry = loadRegistry();
  const beforeCount = registry.projects.length;

  registry.projects = registry.projects.filter((p) => p.id !== projectId);

  if (registry.projects.length < beforeCount) {
    saveRegistry(registry);
    log(`ProjectRegistry: Removed project "${projectId}"`);
    return true;
  }

  return false;
}

/**
 * Add an alias to an existing project
 */
export function addProjectAlias(projectId: string, alias: string): void {
  const registry = loadRegistry();
  const project = registry.projects.find((p) => p.id === projectId);

  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  project.aliases = project.aliases || [];
  if (!project.aliases.includes(alias)) {
    project.aliases.push(alias);
    saveRegistry(registry);
    log(`ProjectRegistry: Added alias "${alias}" to project "${projectId}"`);
  }
}

/**
 * Get the registry file path (for display/debugging)
 */
export function getRegistryFilePath(): string {
  return getRegistryPath();
}

/**
 * Get the default project.
 * Resolution order:
 * 1. Project explicitly marked as default
 * 2. DECIBEL_DEFAULT_PROJECT env var
 * 3. If only one project registered, use it
 * 4. Discover from cwd
 *
 * @returns The default project entry or undefined if none can be determined
 */
export function getDefaultProject(): ProjectEntry | undefined {
  const registry = loadRegistry();

  // Strategy 1: Explicitly marked default
  const explicitDefault = registry.projects.find((p) => p.default === true);
  if (explicitDefault && hasDecibelFolder(explicitDefault.path)) {
    log(`ProjectRegistry: Using explicit default project "${explicitDefault.id}"`);
    return explicitDefault;
  }

  // Strategy 2: DECIBEL_DEFAULT_PROJECT env var
  const envDefault = process.env.DECIBEL_DEFAULT_PROJECT;
  if (envDefault) {
    const envMatch = registry.projects.find(
      (p) => p.id === envDefault || p.aliases?.includes(envDefault)
    );
    if (envMatch && hasDecibelFolder(envMatch.path)) {
      log(`ProjectRegistry: Using DECIBEL_DEFAULT_PROJECT "${envMatch.id}"`);
      return envMatch;
    }
  }

  // Strategy 3: If only one project, use it
  const validProjects = registry.projects.filter((p) => hasDecibelFolder(p.path));
  if (validProjects.length === 1) {
    log(`ProjectRegistry: Using only registered project "${validProjects[0].id}" as default`);
    return validProjects[0];
  }

  // Strategy 4: Discover from cwd
  const discoveredRoot = findDecibelDir(process.cwd());
  if (discoveredRoot) {
    const discoveredId = path.basename(discoveredRoot);
    // Check if it matches a registered project
    const registeredMatch = registry.projects.find((p) => p.id === discoveredId);
    if (registeredMatch) {
      log(`ProjectRegistry: Using cwd-discovered project "${registeredMatch.id}" as default`);
      return registeredMatch;
    }
    // Return an ad-hoc entry for the discovered project
    log(`ProjectRegistry: Using cwd-discovered unregistered project "${discoveredId}" as default`);
    return { id: discoveredId, path: discoveredRoot };
  }

  log(`ProjectRegistry: No default project could be determined`);
  return undefined;
}

/**
 * Set a project as the default
 */
export function setDefaultProject(projectId: string): void {
  const registry = loadRegistry();
  const project = registry.projects.find((p) => p.id === projectId);

  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  // Clear existing defaults
  for (const p of registry.projects) {
    p.default = false;
  }

  // Set new default
  project.default = true;
  saveRegistry(registry);
  log(`ProjectRegistry: Set "${projectId}" as default project`);
}

// ============================================================================
// Path Resolution Helpers (for use by tools)
// ============================================================================

export interface ResolvedProjectPaths {
  /** Project ID */
  id: string;
  /** Absolute path to project root */
  projectPath: string;
  /** Absolute path to .decibel folder */
  decibelPath: string;
  /** Helper to get a subdirectory under .decibel */
  subPath: (...segments: string[]) => string;
}

/**
 * Resolve project and return useful paths.
 * This is the primary helper for tools to get project paths.
 *
 * @param projectId - Project ID, alias, or path (optional, uses default if not provided)
 * @returns Resolved project paths
 * @throws Error if project cannot be resolved
 */
export function resolveProjectPaths(projectId?: string): ResolvedProjectPaths {
  let project: ProjectEntry;

  if (projectId) {
    project = resolveProject(projectId);
  } else {
    const defaultProject = getDefaultProject();
    if (!defaultProject) {
      throw new Error(
        'No project specified and no default project found. ' +
        'Either specify projectId or register a project with the registry.'
      );
    }
    project = defaultProject;
  }

  const decibelPath = path.join(project.path, '.decibel');

  return {
    id: project.id,
    projectPath: project.path,
    decibelPath,
    subPath: (...segments: string[]) => path.join(decibelPath, ...segments),
  };
}

/**
 * Validate that a write path is within the project's .decibel folder.
 * Call this before any file write to prevent escaping project boundaries.
 */
export function validateWritePath(targetPath: string, resolved: ResolvedProjectPaths): void {
  const normalized = path.normalize(targetPath);
  if (!normalized.startsWith(resolved.decibelPath)) {
    throw new Error(
      `SECURITY: Write path ${targetPath} is outside project .decibel folder. ` +
      `Expected path under: ${resolved.decibelPath}`
    );
  }
}
