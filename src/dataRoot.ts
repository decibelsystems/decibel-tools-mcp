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

interface Roots {
  projectDecibelRoot?: string;
  projectName?: string;
  globalRoot: string;
}

// ============================================================================
// Path Resolution
// ============================================================================

/**
 * Walk up directory tree looking for a target folder (like .git or .decibel)
 */
function findUpDir(start: string, target: string): string | undefined {
  let current = path.resolve(start);
  while (true) {
    const candidate = path.join(current, target);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return undefined;
}

/**
 * Infer project name from the directory containing .decibel
 */
function inferProjectName(decibelRoot: string): string {
  // .decibel is inside project root, so go up one level
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
    path.join(os.homedir(), 'decibel-mcp-data');

  // Ensure global root exists
  if (!fs.existsSync(globalRoot)) {
    fs.mkdirSync(globalRoot, { recursive: true });
    log(`DataRoot: Created global root at ${globalRoot}`);
  }

  const projectName = projectDecibelRoot 
    ? inferProjectName(projectDecibelRoot)
    : process.env.DECIBEL_PROJECT_ID || 'unknown_project';

  return { projectDecibelRoot, projectName, globalRoot };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Resolve the appropriate data path for a given domain.
 * 
 * Project-local domains (use .decibel/ if available):
 * - sentinel-issues, sentinel-epics
 * - architect-project, designer-project, learnings-project
 * 
 * Global domains (always use DECIBEL_MCP_ROOT):
 * - architect-global, designer-global, learnings-global
 * - friction-global
 */
export function resolvePath(domain: DataDomain, projectHint?: string): string {
  const { projectDecibelRoot, projectName, globalRoot } = getRoots(projectHint);

  switch (domain) {
    // ========== Sentinel (prefer project-local) ==========
    case 'sentinel-issues':
      if (projectDecibelRoot) {
        return path.join(projectDecibelRoot, 'sentinel', 'issues');
      }
      return path.join(globalRoot, 'sentinel', projectName!, 'issues');

    case 'sentinel-epics':
      if (projectDecibelRoot) {
        return path.join(projectDecibelRoot, 'sentinel', 'epics');
      }
      return path.join(globalRoot, 'sentinel', projectName!, 'epics');

    // ========== Architect ==========
    case 'architect-project':
      if (projectDecibelRoot) {
        return path.join(projectDecibelRoot, 'architect', 'adrs');
      }
      // Fallback to global with project namespace
      return path.join(globalRoot, 'architect', projectName!);

    case 'architect-global':
      return path.join(globalRoot, 'architect', 'adrs');

    // ========== Designer ==========
    case 'designer-project':
      if (projectDecibelRoot) {
        return path.join(projectDecibelRoot, 'designer');
      }
      return path.join(globalRoot, 'designer', projectName!);

    case 'designer-global':
      return path.join(globalRoot, 'designer', 'global');

    // ========== Learnings ==========
    case 'learnings-project':
      if (projectDecibelRoot) {
        return path.join(projectDecibelRoot, 'learnings');
      }
      return path.join(globalRoot, 'learnings', projectName!);

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
 * Get current project name (from .decibel location or env)
 */
export function getProjectName(projectHint?: string): string {
  const { projectName } = getRoots(projectHint);
  return projectName || 'unknown_project';
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
