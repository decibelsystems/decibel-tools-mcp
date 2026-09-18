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
import { recordResolution } from './runtime/projectResolution.js';
import os from 'os';
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
  /**
   * Per-device path overrides, keyed by device ID (see getDeviceId).
   * The same registry file can serve multiple machines: `path` stays the
   * canonical location (external drives mount at the same /Volumes/... path on
   * any Mac, so they live here), while machine-local checkouts go in
   * devicePaths. Resolution prefers this device's override, then the canonical
   * path, then any other device's copy that happens to exist here.
   */
  devicePaths?: Record<string, string>;
  /** Display-only (set on entries returned by listProjects): the canonical registered path. */
  canonicalPath?: string;
  /** Display-only: whether the effective path exists with a .decibel folder on this device. */
  available?: boolean;
  /** Display-only: which candidate won — 'device' | 'canonical' | 'other_device'. */
  pathSource?: EffectivePathSource;
}

export type EffectivePathSource = 'device' | 'canonical' | 'other_device';

export interface EffectivePath {
  path: string;
  source: EffectivePathSource;
  available: boolean;
}

export interface ProjectRegistry {
  version: 1;
  projects: ProjectEntry[];
}

// ============================================================================
// Device Identity
// ============================================================================
// A stable per-machine ID so one registry file can hold paths for several
// devices (desktop vs laptop) without them clobbering each other.
// Precedence: DECIBEL_DEVICE_ID env → ~/.decibel/device.json → generated from
// hostname and persisted. Hostnames drift (.local suffixes, network renames),
// so the generated ID is written once and read thereafter.

let cachedDeviceId: string | undefined;

function sanitizeDeviceId(raw: string): string {
  const id = raw
    .trim()
    .toLowerCase()
    .replace(/\.local$/, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return id || 'unknown-device';
}

export function getDeviceId(): string {
  if (process.env.DECIBEL_DEVICE_ID) {
    return sanitizeDeviceId(process.env.DECIBEL_DEVICE_ID);
  }
  if (cachedDeviceId) return cachedDeviceId;

  const deviceFile = path.join(os.homedir(), '.decibel', 'device.json');
  try {
    const data = JSON.parse(fs.readFileSync(deviceFile, 'utf-8')) as { id?: unknown };
    if (typeof data.id === 'string' && data.id) {
      cachedDeviceId = sanitizeDeviceId(data.id);
      return cachedDeviceId;
    }
  } catch {
    // No device file yet — generate one below.
  }

  const id = sanitizeDeviceId(os.hostname());
  try {
    fs.mkdirSync(path.dirname(deviceFile), { recursive: true });
    fs.writeFileSync(
      deviceFile,
      JSON.stringify({ id, hostname: os.hostname(), created_at: new Date().toISOString() }, null, 2),
    );
    log(`ProjectRegistry: Generated device ID "${id}" → ${deviceFile}`);
  } catch (err) {
    log(`ProjectRegistry: Could not persist device ID (${err}) — using "${id}" for this process`);
  }
  cachedDeviceId = id;
  return id;
}

// ============================================================================
// Effective Path Resolution (device-aware)
// ============================================================================

/**
 * All paths an entry might live at, most-specific first:
 * this device's override → canonical path → other devices' copies.
 */
export function listCandidatePaths(entry: ProjectEntry): string[] {
  const deviceId = getDeviceId();
  const candidates: string[] = [];
  const devicePath = entry.devicePaths?.[deviceId];
  if (devicePath) candidates.push(devicePath);
  candidates.push(entry.path);
  for (const [device, p] of Object.entries(entry.devicePaths ?? {})) {
    if (device !== deviceId && !candidates.includes(p)) candidates.push(p);
  }
  return candidates;
}

/**
 * Pick the path this entry actually lives at ON THIS DEVICE: the first
 * candidate whose .decibel/ folder exists. External drives resolve via the
 * canonical path whenever mounted; machine-local checkouts via devicePaths.
 * If nothing exists (drive unplugged, no local copy), returns the
 * most-specific candidate with available=false so error messages can point
 * at the right location.
 */
export function getEffectivePath(entry: ProjectEntry): EffectivePath {
  const deviceId = getDeviceId();
  const devicePath = entry.devicePaths?.[deviceId];

  const sourceOf = (p: string): EffectivePathSource =>
    p === devicePath ? 'device' : p === entry.path ? 'canonical' : 'other_device';

  const candidates = listCandidatePaths(entry);
  for (const candidate of candidates) {
    if (hasDecibelFolder(candidate)) {
      return { path: candidate, source: sourceOf(candidate), available: true };
    }
  }
  const preferred = candidates[0];
  return { path: preferred, source: sourceOf(preferred), available: false };
}

/** Copy of the entry with `path` replaced by the device-effective path. */
function withEffectivePath(entry: ProjectEntry): ProjectEntry {
  const eff = getEffectivePath(entry);
  return { ...entry, path: eff.path };
}

/** Error text for a registered-but-absent project, with device context. */
function unavailableMessage(entry: ProjectEntry, requestedAs: string): string {
  const candidates = listCandidatePaths(entry);
  return (
    `Project "${requestedAs}" is registered but not available on this device (${getDeviceId()}). ` +
    `Tried: ${candidates.join(', ')}. ` +
    `If it lives on an external drive, mount it. If this machine has its own copy, ` +
    `link it with registry_add (same id, this machine's path) or registry_scan with apply=true.`
  );
}

// ============================================================================
// Registry Loading
// ============================================================================

/**
 * Get the path to the registry file.
 *
 * Default: ~/.decibel/projects.json — a stable, USER-LEVEL location that survives
 * MCP reinstalls / fresh checkouts and is shared by the daemon, the CLI, HQ, and
 * other tools. The legacy default was repo-root `<mcp>/projects.json`, which (a)
 * started empty on every reinstall/clone and (b) diverged from the ~/.decibel copy
 * other tools wrote — causing the registry to silently empty (HQ-reported 2026-06-11).
 * `DECIBEL_REGISTRY_PATH` still overrides.
 */
function getRegistryPath(): string {
  if (process.env.DECIBEL_REGISTRY_PATH) {
    return process.env.DECIBEL_REGISTRY_PATH;
  }
  return path.join(os.homedir(), '.decibel', 'projects.json');
}

/** The legacy repo-root location, for one-time migration. */
function getLegacyRegistryPath(): string {
  // __dirname at runtime is dist/, so go up one level to the MCP repo root.
  return path.join(path.resolve(__dirname, '..'), 'projects.json');
}

/**
 * Load the project registry from disk
 */
function loadRegistry(): ProjectRegistry {
  const registryPath = getRegistryPath();

  // One-time migration: if the user-level registry doesn't exist yet but the
  // legacy repo-root file does (and has projects), copy it forward so upgrading
  // doesn't appear to "lose" the registry. Only runs when not overridden by
  // DECIBEL_REGISTRY_PATH, and never deletes the legacy file. (HQ 2026-06-11.)
  if (!process.env.DECIBEL_REGISTRY_PATH && !fs.existsSync(registryPath)) {
    const legacyPath = getLegacyRegistryPath();
    if (legacyPath !== registryPath && fs.existsSync(legacyPath)) {
      try {
        const legacy = JSON.parse(fs.readFileSync(legacyPath, 'utf-8')) as ProjectRegistry;
        if (Array.isArray(legacy.projects) && legacy.projects.length > 0) {
          fs.mkdirSync(path.dirname(registryPath), { recursive: true });
          fs.writeFileSync(registryPath, JSON.stringify(legacy, null, 2));
          log(`ProjectRegistry: Migrated ${legacy.projects.length} projects from legacy ${legacyPath} → ${registryPath}`);
          return legacy;
        }
      } catch (err) {
        log(`ProjectRegistry: Legacy migration skipped (${err})`);
      }
    }
  }

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

  // Safety net against silent data loss: never overwrite a MULTI-project on-disk
  // registry with an empty one. unregisterProject removes entries one at a time
  // (it loads the registry, drops one, saves), so a legitimate emptying is always
  // 1→0 — the on-disk file has exactly one project at that point. A save of [] over
  // a file with >1 project therefore means something loaded an empty/stale registry
  // (wrong path, parse failure) and is about to clobber many real entries — the
  // 32→0 wipe HQ hit. Refuse that, log loudly, but still allow the deliberate 1→0.
  if (registry.projects.length === 0 && fs.existsSync(registryPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(registryPath, 'utf-8')) as ProjectRegistry;
      if (Array.isArray(existing.projects) && existing.projects.length > 1) {
        log(`ProjectRegistry: REFUSED to overwrite ${existing.projects.length} registered projects with an empty registry at ${registryPath} (likely a stale/empty load — investigate)`);
        return;
      }
    } catch {
      // Unparseable existing file — fall through and let the write replace it.
    }
  }

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
    const eff = getEffectivePath(exactMatch);
    if (!eff.available) {
      throw new Error(unavailableMessage(exactMatch, projectId));
    }
    log(`ProjectRegistry: Resolved "${projectId}" via exact ID match (${eff.source} path)`);
    recordResolution(projectId, exactMatch.id, eff.path, 'exact_id');
    return { ...exactMatch, path: eff.path };
  }

  // Strategy 2: Alias match in registry
  const aliasMatch = registry.projects.find((p) => p.aliases?.includes(projectId));
  if (aliasMatch) {
    const eff = getEffectivePath(aliasMatch);
    if (!eff.available) {
      throw new Error(unavailableMessage(aliasMatch, `${projectId}" (alias for "${aliasMatch.id}`));
    }
    log(`ProjectRegistry: Resolved "${projectId}" via alias -> "${aliasMatch.id}" (${eff.source} path)`);
    recordResolution(projectId, aliasMatch.id, eff.path, 'alias');
    return { ...aliasMatch, path: eff.path };
  }

  // Strategy 3: DECIBEL_PROJECT_ROOT env var
  const envRoot = process.env.DECIBEL_PROJECT_ROOT;
  if (envRoot && path.basename(envRoot) === projectId) {
    if (hasDecibelFolder(envRoot)) {
      log(`ProjectRegistry: Resolved "${projectId}" via DECIBEL_PROJECT_ROOT`);
      recordResolution(projectId, projectId, envRoot, 'env_root_exact');
      return { id: projectId, path: envRoot };
    }
  }

  // Strategy 4: Absolute path with .decibel
  if (path.isAbsolute(projectId) && hasDecibelFolder(projectId)) {
    log(`ProjectRegistry: Resolved "${projectId}" as absolute path`);
    recordResolution(projectId, path.basename(projectId), projectId, 'absolute_path');
    return { id: path.basename(projectId), path: projectId };
  }

  // Strategy 5: Discover from cwd (exact basename match)
  const discoveredRoot = findDecibelDir(process.cwd());
  if (discoveredRoot && path.basename(discoveredRoot) === projectId) {
    log(`ProjectRegistry: Resolved "${projectId}" via cwd discovery`);
    recordResolution(projectId, projectId, discoveredRoot, 'cwd_exact');
    return { id: projectId, path: discoveredRoot };
  }

  // Strategy 6: If DECIBEL_PROJECT_ROOT is set and has .decibel, use it as fallback
  // This allows tests and scripts to set a project root and use any projectId as a label
  if (envRoot && hasDecibelFolder(envRoot)) {
    log(`ProjectRegistry: Resolved "${projectId}" via DECIBEL_PROJECT_ROOT fallback (treating as label)`);
    recordResolution(projectId, projectId, envRoot, 'env_root_fallback');
    return { id: projectId, path: envRoot };
  }

  // Strategy 7: If we discovered a project from cwd but ID didn't match, use it anyway
  // This prevents hard failures when Claude sends a slightly wrong project ID
  if (discoveredRoot) {
    const discoveredId = path.basename(discoveredRoot);
    log(`ProjectRegistry: Resolved "${projectId}" via cwd fallback (actual project: "${discoveredId}")`);
    recordResolution(projectId, discoveredId, discoveredRoot, 'cwd_fallback');
    return { id: discoveredId, path: discoveredRoot };
  }

  // Build helpful error message
  const registeredIds = registry.projects.map((p) => p.id);
  const allAliases = registry.projects.flatMap((p) => p.aliases || []);
  const suggestions = [...registeredIds, ...allAliases].filter(Boolean);

  let errorMsg = `PROJECT_NOT_FOUND: "${projectId}".`;
  if (suggestions.length > 0) {
    errorMsg += ` Registered projects: ${suggestions.join(', ')}.`;
  }
  errorMsg += ` To fix: use the project_init tool with the absolute path to your project, or registry_add if .decibel/ already exists.`;

  throw new Error(errorMsg);
}

/**
 * List all registered projects. Entries carry the device-effective `path`
 * (so every consumer reads the right location for this machine), plus
 * display fields: canonicalPath, available, pathSource.
 */
export function listProjects(): ProjectEntry[] {
  const registry = loadRegistry();
  return registry.projects.map((p) => {
    const eff = getEffectivePath(p);
    return {
      ...p,
      path: eff.path,
      canonicalPath: p.path,
      available: eff.available,
      pathSource: eff.source,
    };
  });
}

export interface RegisterResult {
  action: 'added' | 'updated_canonical' | 'device_linked' | 'kept_existing_device_link';
  id: string;
  /** The path now effective for this device. */
  path: string;
  /** For kept_existing_device_link: the path that was NOT recorded. */
  skippedPath?: string;
}

/**
 * Register a new project or update an existing one — device-aware.
 *
 * New IDs register their path as canonical. For an existing ID with a
 * DIFFERENT path, the new path is recorded as this device's override
 * (devicePaths[deviceId]) so machines don't clobber each other's locations —
 * the scenario that broke the laptop when the registry held desktop-only
 * /Volumes/Ashitaka paths. Pass opts.canonical=true to deliberately rewrite
 * the canonical path (e.g. the project genuinely moved).
 *
 * If this device is ALREADY linked to a valid copy, a differing path is NOT
 * recorded unless opts.repoint=true — otherwise a second copy of the same
 * project (e.g. a backup on an external drive) discovered later in a scan
 * would silently steal the link from the working copy. registry_add passes
 * repoint (explicit user intent); registry_scan apply does not.
 */
export function registerProject(
  entry: ProjectEntry,
  opts?: { canonical?: boolean; repoint?: boolean },
): RegisterResult {
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

  // Normalize path; strip display-only fields so they never persist to disk
  // (callers sometimes round-trip entries that came from listProjects).
  entry.path = path.resolve(entry.path);
  delete entry.canonicalPath;
  delete entry.available;
  delete entry.pathSource;

  const deviceId = getDeviceId();
  let result: RegisterResult;
  const existingIdx = registry.projects.findIndex((p) => p.id === entry.id);
  if (existingIdx >= 0) {
    const existing = registry.projects[existingIdx];
    if (opts?.canonical || existing.path === entry.path) {
      // Same path (metadata refresh) or explicit canonical rewrite.
      const updated: ProjectEntry = {
        ...existing,
        ...entry,
        devicePaths: entry.devicePaths ?? existing.devicePaths,
      };
      // A device override equal to the new canonical path is redundant — drop it.
      if (updated.devicePaths?.[deviceId] === updated.path) {
        delete updated.devicePaths[deviceId];
        if (Object.keys(updated.devicePaths).length === 0) delete updated.devicePaths;
      }
      registry.projects[existingIdx] = updated;
      log(`ProjectRegistry: Updated project "${entry.id}" (canonical: ${updated.path})`);
      result = { action: 'updated_canonical', id: entry.id, path: updated.path };
    } else {
      // Different path for a known project: this machine's copy, not a move.
      const currentLink = existing.devicePaths?.[deviceId];
      if (currentLink && currentLink !== entry.path && hasDecibelFolder(currentLink) && !opts?.repoint) {
        // Device already linked to a valid copy — don't let a second copy
        // (backup drive, stale clone) steal the link.
        log(
          `ProjectRegistry: Kept existing device link for "${entry.id}" on ${deviceId} ` +
          `(${currentLink}); not repointing to ${entry.path}`,
        );
        return { action: 'kept_existing_device_link', id: entry.id, path: currentLink, skippedPath: entry.path };
      }
      existing.devicePaths = { ...(existing.devicePaths ?? {}), [deviceId]: entry.path };
      if (entry.name && !existing.name) existing.name = entry.name;
      if (entry.aliases?.length) {
        existing.aliases = Array.from(new Set([...(existing.aliases ?? []), ...entry.aliases]));
      }
      log(`ProjectRegistry: Linked device path for "${entry.id}" on ${deviceId}: ${entry.path}`);
      result = { action: 'device_linked', id: entry.id, path: entry.path };
    }
  } else {
    // Add new
    registry.projects.push(entry);
    log(`ProjectRegistry: Added project "${entry.id}"`);
    result = { action: 'added', id: entry.id, path: entry.path };
  }

  saveRegistry(registry);
  return result;
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

// ============================================================================
// Registry Scan / Drift Detection
// ============================================================================

export interface ScanFinding {
  id: string;
  path: string;
  registered: boolean;
  registeredAs?: string;
}

export interface ScanResult {
  roots: string[];
  found: ScanFinding[];
  unregistered: ScanFinding[];
  orphans: Array<{ id: string; path: string; reason: string }>;
}

/**
 * Resolve the roots to scan for `.decibel/` directories.
 *
 * Precedence:
 *   1. Explicit `roots` argument
 *   2. DECIBEL_SCAN_ROOTS env var (colon-separated)
 *   3. Unique parent dirs of currently-registered projects
 */
/**
 * Coerce a `roots` param to string[]. Over MCP/HTTP an array argument can arrive
 * as a real array, a JSON-stringified array ('["/a","/b"]'), or a single string
 * ("/a"). Previously getScanRoots did `explicit.map(...)` directly, which threw
 * "explicit.map is not a function" for the string forms. (HQ-reported, 2026-06-11.)
 */
function normalizeRoots(explicit?: string[] | string): string[] {
  if (Array.isArray(explicit)) return explicit.filter((r) => typeof r === 'string' && r.length > 0);
  if (typeof explicit === 'string') {
    const s = explicit.trim();
    if (!s) return [];
    if (s.startsWith('[')) {
      try {
        const parsed = JSON.parse(s);
        if (Array.isArray(parsed)) return parsed.filter((r) => typeof r === 'string' && r.length > 0);
      } catch { /* fall through — treat as a single path */ }
    }
    return [s];
  }
  return [];
}

export function getScanRoots(explicit?: string[] | string): string[] {
  const roots = normalizeRoots(explicit);
  if (roots.length > 0) {
    return Array.from(new Set(roots.map((r) => path.resolve(r))));
  }
  const envRoots = process.env.DECIBEL_SCAN_ROOTS;
  if (envRoots) {
    return Array.from(
      new Set(
        envRoots
          .split(':')
          .map((r) => r.trim())
          .filter(Boolean)
          .map((r) => path.resolve(r)),
      ),
    );
  }
  const registry = loadRegistry();
  const parents = registry.projects
    .flatMap((p) => listCandidatePaths(p))
    .filter((p) => p && fs.existsSync(p))
    .map((p) => path.dirname(path.resolve(p)));
  return Array.from(new Set(parents));
}

/**
 * Scan the given roots for `.decibel/` directories and reconcile against the
 * registered project list.
 *
 * Does not mutate the registry. Callers use `registerProject` to apply.
 */
export function scanForProjects(explicitRoots?: string[] | string): ScanResult {
  const roots = getScanRoots(explicitRoots);
  const registry = loadRegistry();
  // Match discovered directories against EVERY path an entry is known by
  // (canonical + all device overrides), so a copy already linked for some
  // device isn't re-reported as unregistered.
  const registeredByPath = new Map<string, ProjectEntry>();
  for (const p of registry.projects) {
    for (const candidate of listCandidatePaths(p)) {
      registeredByPath.set(path.resolve(candidate), p);
    }
  }

  const found: ScanFinding[] = [];
  const seenPaths = new Set<string>();

  for (const root of roots) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const projectPath = path.join(root, entry.name);
      if (seenPaths.has(projectPath)) continue;
      if (!hasDecibelFolder(projectPath)) continue;
      seenPaths.add(projectPath);
      const registeredEntry = registeredByPath.get(path.resolve(projectPath));
      found.push({
        id: registeredEntry?.id ?? entry.name,
        path: projectPath,
        registered: Boolean(registeredEntry),
        registeredAs: registeredEntry?.id,
      });
    }
  }

  const unregistered = found.filter((f) => !f.registered);

  // Orphans = no candidate path (canonical or any device override) is usable
  // on this device. An unmounted external volume gets its own reason so it
  // reads as "plug the drive in", not "the project is gone".
  const orphans: Array<{ id: string; path: string; reason: string }> = [];
  for (const project of registry.projects) {
    const eff = getEffectivePath(project);
    if (eff.available) continue;
    const candidates = listCandidatePaths(project);
    let reason = 'path_missing';
    if (candidates.some((p) => fs.existsSync(p))) {
      reason = 'no_decibel_dir';
    } else {
      const unmounted = candidates
        .map((p) => /^\/Volumes\/[^/]+/.exec(p)?.[0])
        .find((vol) => vol && !fs.existsSync(vol));
      if (unmounted) reason = `volume_unmounted:${path.basename(unmounted)}`;
    }
    orphans.push({ id: project.id, path: eff.path, reason });
  }

  return { roots, found, unregistered, orphans };
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
  if (explicitDefault && getEffectivePath(explicitDefault).available) {
    log(`ProjectRegistry: Using explicit default project "${explicitDefault.id}"`);
    return withEffectivePath(explicitDefault);
  }

  // Strategy 2: DECIBEL_DEFAULT_PROJECT env var
  const envDefault = process.env.DECIBEL_DEFAULT_PROJECT;
  if (envDefault) {
    const envMatch = registry.projects.find(
      (p) => p.id === envDefault || p.aliases?.includes(envDefault)
    );
    if (envMatch && getEffectivePath(envMatch).available) {
      log(`ProjectRegistry: Using DECIBEL_DEFAULT_PROJECT "${envMatch.id}"`);
      return withEffectivePath(envMatch);
    }
  }

  // Strategy 3: If only one project, use it
  const validProjects = registry.projects.filter((p) => getEffectivePath(p).available);
  if (validProjects.length === 1) {
    log(`ProjectRegistry: Using only registered project "${validProjects[0].id}" as default`);
    return withEffectivePath(validProjects[0]);
  }

  // Strategy 4: Discover from cwd
  const discoveredRoot = findDecibelDir(process.cwd());
  if (discoveredRoot) {
    const discoveredId = path.basename(discoveredRoot);
    // Check if it matches a registered project. The cwd-discovered root is
    // certainly valid on this device, so prefer it over a registered path
    // that may point at another machine's location.
    const registeredMatch = registry.projects.find((p) => p.id === discoveredId);
    if (registeredMatch) {
      log(`ProjectRegistry: Using cwd-discovered project "${registeredMatch.id}" as default`);
      return { ...registeredMatch, path: discoveredRoot };
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
// Input Normalization Helpers
// ============================================================================

/**
 * Normalize projectId from various input formats.
 * Handles both camelCase (projectId) and snake_case (project_id).
 * This allows tools to accept inputs from Claude regardless of which format it uses.
 */
export function normalizeProjectId(input: Record<string, unknown>): string | undefined {
  return (input.projectId as string | undefined) || (input.project_id as string | undefined);
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
      const registry = loadRegistry();
      const registered = registry.projects.map(p => p.id);
      let msg = 'No project specified and no default project found.';
      if (registered.length > 0) {
        msg += ` Registered projects: ${registered.join(', ')}. Pass one as project_id.`;
      } else {
        msg += ` No projects registered. Use the project_init tool to initialize a project, or registry_add to register an existing .decibel/ directory.`;
      }
      throw new Error(msg);
    }
    project = defaultProject;
    // No id was requested, so nothing was substituted — this is a match by
    // definition, and the caller still learns which project it got.
    recordResolution(undefined, project.id, project.path, 'default_project');
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
 *
 * SECURITY: Uses realpath to resolve symlinks, preventing symlink-based escapes.
 * If the target doesn't exist yet, validates the parent directory instead.
 */
export function validateWritePath(targetPath: string, resolved: ResolvedProjectPaths): void {
  const normalized = path.normalize(targetPath);

  // First check: basic path prefix (fast path for obvious violations)
  if (!normalized.startsWith(resolved.decibelPath)) {
    throw new Error(
      `SECURITY: Write path ${targetPath} is outside project .decibel folder. ` +
      `Expected path under: ${resolved.decibelPath}`
    );
  }

  // Second check: resolve symlinks to catch symlink-based escapes
  // If target doesn't exist, check parent directory
  let realPath: string;
  try {
    realPath = fs.realpathSync(normalized);
  } catch {
    // File doesn't exist yet - validate parent directory
    const parent = path.dirname(normalized);
    try {
      realPath = fs.realpathSync(parent);
      // Parent must be under .decibel, and target must be a direct child (no symlink tricks)
      if (!realPath.startsWith(fs.realpathSync(resolved.decibelPath))) {
        throw new Error(
          `SECURITY: Parent directory resolves outside .decibel folder (symlink detected). ` +
          `Real path: ${realPath}`
        );
      }
      return; // Parent is valid, new file creation is safe
    } catch (parentErr) {
      // Parent doesn't exist either - likely creating nested dirs, allow it
      // The ensureDir call will create parents, and this check will be called again
      return;
    }
  }

  // Check if resolved path is still within .decibel
  const realDecibelPath = fs.realpathSync(resolved.decibelPath);
  if (!realPath.startsWith(realDecibelPath)) {
    throw new Error(
      `SECURITY: Write path resolves outside .decibel folder (symlink detected). ` +
      `Target: ${targetPath}, Real path: ${realPath}`
    );
  }
}
