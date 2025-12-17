import fs from 'fs';
import path from 'path';
import os from 'os';
import { log } from './config.js';

// ============================================================================
// Types
// ============================================================================

export type DataDomain =
  | 'sentinel-issues'
  | 'sentinel-epics'
  | 'architect-project'
  | 'architect-global'
  | 'designer-project'
  | 'designer-global'
  | 'friction-global'
  | 'learnings-project'
  | 'learnings-global';

/** Domains that require a project-local .decibel/ folder */
const PROJECT_LOCAL_DOMAINS: DataDomain[] = [
  'sentinel-issues',
  'sentinel-epics',
  'architect-project',
  'designer-project',
  'learnings-project',
];

interface Roots {
  projectDecibelRoot?: string;
  projectName?: string;
  globalRoot: string;
}

export interface ResolvePathOptions {
  /**
   * If true (default), throws an error when a project-local domain
   * cannot resolve to a .decibel/ folder. Set to false to allow
   * fallback to global paths (legacy behavior).
   */
  requireProject?: boolean;
}

// ============================================================================
// Path Resolution
// ============================================================================

/**
 * Walk up directory tree looking for a .decibel folder
 */
function findUpDir(start: string, target: string): string | undefined {
  let current = path.resolve(start);
  while (true) {
    const candidate = path.join(current, target);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return undefined;
}

/**
 * Infer project name from the directory containing .decibel/
 */
function inferProjectName(decibelRoot: string): string {
  // .decibel/ is inside project root, so go up one level
  const projectDir = path.dirname(decibelRoot);
  return path.basename(projectDir);
}

/**
 * Get both project-local and global roots
 */
function getRoots(projectHint?: string): Roots {
  const projectRoot =
    projectHint ||
    process.env.DECIBEL_PROJECT_ROOT ||
    process.cwd();

  const projectDecibelRoot = findUpDir(projectRoot, '.decibel');
  const globalRoot =
    process.env.DECIBEL_MCP_ROOT ||
    path.join(os.homedir(), '.decibel');

  // Ensure global root exists
  if (!fs.existsSync(globalRoot)) {
    fs.mkdirSync(globalRoot, { recursive: true });
    log(`DataRoot: Created global root at ${globalRoot}`);
  }

  // Only set projectName if we have a valid source
  const projectName = projectDecibelRoot
    ? inferProjectName(projectDecibelRoot)
    : process.env.DECIBEL_PROJECT_ID;  // No fallback to 'unknown_project'

  return { projectDecibelRoot, projectName, globalRoot };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Helper to throw a consistent project resolution error
 */
function throwProjectResolutionError(domain: DataDomain, projectHint?: string): never {
  const hintInfo = projectHint ? ` (hint: ${projectHint})` : '';
  throw new Error(
    `Cannot resolve project path for domain "${domain}"${hintInfo}. ` +
    `No .decibel/ folder found. Either run from a project directory, ` +
    `set DECIBEL_PROJECT_ROOT environment variable, or use resolveProject() ` +
    `from projectRegistry.ts first.`
  );
}

/**
 * Resolve the appropriate data path for a given domain.
 *
 * Project-local domains (use .decibel/ if available):
 * - sentinel-issues, sentinel-epics
 * - architect-project, designer-project, learnings-project
 *
 * Global domains (always use DECIBEL_MCP_ROOT or ~/.decibel):
 * - architect-global, designer-global, learnings-global
 * - friction-global
 *
 * @param domain - The data domain to resolve
 * @param projectHint - Optional project path hint
 * @param options - Resolution options
 * @param options.requireProject - If true (default), throws error when project-local
 *   domain cannot be resolved to a .decibel/ folder. Set to false for legacy fallback.
 */
export function resolvePath(
  domain: DataDomain,
  projectHint?: string,
  options?: ResolvePathOptions
): string {
  const { projectDecibelRoot, projectName, globalRoot } = getRoots(projectHint);
  const requireProject = options?.requireProject !== false; // Default true

  switch (domain) {
    // ========== Sentinel (project-local required) ==========
    case 'sentinel-issues':
      if (projectDecibelRoot) {
        return path.join(projectDecibelRoot, 'sentinel', 'issues');
      }
      if (requireProject) {
        throwProjectResolutionError(domain, projectHint);
      }
      return path.join(globalRoot, 'sentinel', projectName || 'unknown_project', 'issues');

    case 'sentinel-epics':
      if (projectDecibelRoot) {
        return path.join(projectDecibelRoot, 'sentinel', 'epics');
      }
      if (requireProject) {
        throwProjectResolutionError(domain, projectHint);
      }
      return path.join(globalRoot, 'sentinel', projectName || 'unknown_project', 'epics');

    // ========== Architect ==========
    case 'architect-project':
      if (projectDecibelRoot) {
        return path.join(projectDecibelRoot, 'architect', 'adrs');
      }
      if (requireProject) {
        throwProjectResolutionError(domain, projectHint);
      }
      return path.join(globalRoot, 'architect', projectName || 'unknown_project');

    case 'architect-global':
      return path.join(globalRoot, 'architect', 'adrs');

    // ========== Designer ==========
    case 'designer-project':
      if (projectDecibelRoot) {
        return path.join(projectDecibelRoot, 'designer');
      }
      if (requireProject) {
        throwProjectResolutionError(domain, projectHint);
      }
      return path.join(globalRoot, 'designer', projectName || 'unknown_project');

    case 'designer-global':
      return path.join(globalRoot, 'designer', 'global');

    // ========== Learnings ==========
    case 'learnings-project':
      if (projectDecibelRoot) {
        return path.join(projectDecibelRoot, 'learnings');
      }
      if (requireProject) {
        throwProjectResolutionError(domain, projectHint);
      }
      return path.join(globalRoot, 'learnings', projectName || 'unknown_project');

    case 'learnings-global':
      return path.join(globalRoot, 'learnings', 'global');

    // ========== Friction (always global) ==========
    case 'friction-global':
      return path.join(globalRoot, 'friction');
  }
}

/**
 * Check if project-local .decibel/ exists
 */
export function hasProjectLocal(projectHint?: string): boolean {
  const { projectDecibelRoot } = getRoots(projectHint);
  return !!projectDecibelRoot;
}

/**
 * Get current project name (from .decibel/ location or env)
 * Returns undefined if no project can be resolved
 */
export function getProjectName(projectHint?: string): string | undefined {
  const { projectName } = getRoots(projectHint);
  return projectName;
}

/**
 * Initialize .decibel/ structure in a project directory
 */
export function initProjectDecibel(projectRoot: string): void {
  const decibelRoot = path.join(projectRoot, '.decibel');

  const dirs = [
    path.join(decibelRoot, 'sentinel', 'issues'),
    path.join(decibelRoot, 'sentinel', 'epics'),
    path.join(decibelRoot, 'architect', 'adrs'),
    path.join(decibelRoot, 'designer'),
    path.join(decibelRoot, 'learnings'),
  ];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      log(`DataRoot: Created ${dir}`);
    }
  }

  // Create a .gitkeep in each to ensure empty dirs are tracked
  for (const dir of dirs) {
    const gitkeep = path.join(dir, '.gitkeep');
    if (!fs.existsSync(gitkeep)) {
      fs.writeFileSync(gitkeep, '');
    }
  }

  log(`DataRoot: Initialized .decibel/ in ${projectRoot}`);
}

/**
 * Ensure a directory exists before writing
 */
export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}
