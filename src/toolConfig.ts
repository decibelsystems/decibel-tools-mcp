// ============================================================================
// Tool Config — per-facade configuration with layered merge
// ============================================================================
// Merge order (last wins):
//   defaults → profile → project .decibel/config.yaml → ~/.decibel/config.yaml → env vars
//
// Tools call getToolConfig(projectId, 'sentinel') to get their merged config.
// Users call registry config_list to discover all configurable keys.
// ============================================================================

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import YAML from 'yaml';
import { log } from './config.js';
import { resolveProjectPaths } from './projectRegistry.js';

// ============================================================================
// Schema: configurable keys per facade
// ============================================================================

export interface ConfigKeyDef {
  key: string;
  type: 'string' | 'number' | 'boolean' | 'string[]';
  default: unknown;
  description: string;
  env?: string; // optional env var override (e.g. DECIBEL_GUARDIAN_BLOCK)
}

/**
 * Registry of all configurable keys, grouped by facade.
 * Add new keys here when a facade gains configurable behavior.
 */
export const CONFIG_SCHEMA: Record<string, ConfigKeyDef[]> = {
  sentinel: [
    { key: 'auto_link_commits', type: 'boolean', default: false, description: 'Automatically link commits to issues on creation', env: 'DECIBEL_SENTINEL_AUTOLINK' },
    { key: 'default_severity', type: 'string', default: 'med', description: 'Default severity for new issues (low|med|high|critical)' },
  ],
  guardian: [
    { key: 'scan_on_push', type: 'boolean', default: true, description: 'Run guardian scan before git push', env: 'DECIBEL_GUARDIAN_SCAN_ON_PUSH' },
    { key: 'fail_threshold', type: 'string', default: 'D', description: 'Block pushes at this grade or below (A|B|C|D|F)', env: 'DECIBEL_GUARDIAN_BLOCK' },
    { key: 'allowlist', type: 'string', default: '.decibel/guardian/allowlist.yaml', description: 'Path to secret allowlist file' },
  ],
  voice: [
    { key: 'auto_process', type: 'boolean', default: false, description: 'Process inbox items immediately after sync', env: 'DECIBEL_VOICE_AUTOPROCESS' },
  ],
  architect: [
    { key: 'adr_template', type: 'string', default: 'full', description: 'ADR template style (lightweight|full|rfc)' },
  ],
  designer: [
    { key: 'auto_review', type: 'boolean', default: false, description: 'Trigger visual review on UI file edits', env: 'DECIBEL_DESIGNER_AUTOREVIEW' },
  ],
  oracle: [
    { key: 'include_friction', type: 'boolean', default: true, description: 'Include friction summary in next_actions' },
    { key: 'max_actions', type: 'number', default: 5, description: 'Maximum next actions to return' },
  ],
  velocity: [
    { key: 'window_days', type: 'number', default: 14, description: 'Default lookback window in days' },
  ],
  git: [
    { key: 'auto_link', type: 'boolean', default: false, description: 'Auto-link commits to sentinel issues', env: 'DECIBEL_GIT_AUTOLINK' },
  ],
  workflow: [
    { key: 'require_issue', type: 'boolean', default: false, description: 'Require a sentinel issue before starting work', env: 'DECIBEL_WORKFLOW_REQUIRE_ISSUE' },
  ],
  codereview: [
    { key: 'auto_scan', type: 'boolean', default: true, description: 'Run guardian scan as part of code review' },
  ],
};

// ============================================================================
// Built-in Profiles
// ============================================================================

export interface Profile {
  name: string;
  description: string;
  overrides: Record<string, Record<string, unknown>>;
}

export const BUILT_IN_PROFILES: Record<string, Profile> = {
  'solo-dev': {
    name: 'solo-dev',
    description: 'Optimized for individual developers — auto-linking, auto-processing enabled',
    overrides: {
      guardian: { scan_on_push: true },
      voice: { auto_process: true },
      sentinel: { auto_link_commits: true },
      git: { auto_link: true },
    },
  },
  team: {
    name: 'team',
    description: 'Balanced for team workflows — issue tracking enforced, reviews enabled',
    overrides: {
      workflow: { require_issue: true },
      guardian: { scan_on_push: true, fail_threshold: 'C' },
      codereview: { auto_scan: true },
      sentinel: { auto_link_commits: true },
    },
  },
  ci: {
    name: 'ci',
    description: 'CI/CD pipeline — strict scanning, no interactive features',
    overrides: {
      guardian: { fail_threshold: 'C', scan_on_push: true },
      voice: { auto_process: false },
      designer: { auto_review: false },
    },
  },
  minimal: {
    name: 'minimal',
    description: 'Minimal footprint — only core tracking, no automation',
    overrides: {
      guardian: { scan_on_push: false },
      voice: { auto_process: false },
      sentinel: { auto_link_commits: false },
      designer: { auto_review: false },
      git: { auto_link: false },
      workflow: { require_issue: false },
    },
  },
};

// ============================================================================
// Config File Types
// ============================================================================

interface ToolConfigFile {
  profile?: string;
  tools?: Record<string, Record<string, unknown>>;
  enabled_facades?: string[];
}

// ============================================================================
// Config Loading
// ============================================================================

const GLOBAL_CONFIG_PATH = join(homedir(), '.decibel', 'config.yaml');

function loadYamlConfig(filePath: string): ToolConfigFile {
  if (!existsSync(filePath)) return {};
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const parsed = YAML.parse(raw) as Record<string, unknown> | null;
    if (!parsed) return {};
    return {
      profile: parsed.profile as string | undefined,
      tools: parsed.tools as Record<string, Record<string, unknown>> | undefined,
      enabled_facades: parsed.enabled_facades as string[] | undefined,
    };
  } catch (err) {
    log(`toolConfig: Failed to parse ${filePath}: ${err}`);
    return {};
  }
}

function getProjectConfigPath(projectId?: string): string | null {
  if (!projectId) return null;
  try {
    const resolved = resolveProjectPaths(projectId);
    const configPath = join(resolved.decibelPath, 'config.yaml');
    return configPath;
  } catch {
    return null;
  }
}

/**
 * Parse env var value to the expected type.
 */
function parseEnvValue(value: string, type: ConfigKeyDef['type']): unknown {
  switch (type) {
    case 'boolean':
      return value === '1' || value === 'true' || value === 'yes';
    case 'number':
      return Number(value);
    case 'string[]':
      return value.split(',').map(s => s.trim());
    default:
      return value;
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Get merged config for a specific facade.
 * Merge order: defaults → profile → project config → global config → env vars
 */
export function getToolConfig<T extends Record<string, unknown> = Record<string, unknown>>(
  projectId: string | undefined,
  facade: string,
): T {
  const schemaDefs = CONFIG_SCHEMA[facade];
  if (!schemaDefs) return {} as T;

  // Layer 1: defaults
  const result: Record<string, unknown> = {};
  for (const def of schemaDefs) {
    result[def.key] = def.default;
  }

  // Layer 2: profile (from project config, then global config)
  const projectConfigPath = getProjectConfigPath(projectId);
  const projectConfig = projectConfigPath ? loadYamlConfig(projectConfigPath) : {};
  const globalConfig = loadYamlConfig(GLOBAL_CONFIG_PATH);

  const profileName = process.env.DECIBEL_PROFILE || projectConfig.profile || globalConfig.profile;
  if (profileName) {
    const profile = BUILT_IN_PROFILES[profileName];
    if (profile?.overrides[facade]) {
      Object.assign(result, profile.overrides[facade]);
    }
  }

  // Layer 3: project .decibel/config.yaml tools section
  if (projectConfig.tools?.[facade]) {
    Object.assign(result, projectConfig.tools[facade]);
  }

  // Layer 4: global ~/.decibel/config.yaml tools section
  if (globalConfig.tools?.[facade]) {
    Object.assign(result, globalConfig.tools[facade]);
  }

  // Layer 5: env vars (highest priority)
  for (const def of schemaDefs) {
    if (def.env && process.env[def.env] !== undefined) {
      result[def.key] = parseEnvValue(process.env[def.env]!, def.type);
    }
  }

  return result as T;
}

/**
 * Get the full merged config for all facades.
 */
export function getAllToolConfig(projectId?: string): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};
  for (const facade of Object.keys(CONFIG_SCHEMA)) {
    result[facade] = getToolConfig(projectId, facade);
  }
  return result;
}

/**
 * Get the enabled facades list (from DECIBEL_FACADES env or config files).
 * Returns undefined if no restriction is set (all facades allowed).
 */
export function getEnabledFacades(projectId?: string): string[] | undefined {
  // Env var takes priority
  const envFacades = process.env.DECIBEL_FACADES;
  if (envFacades) {
    return envFacades.split(',').map(s => s.trim()).filter(Boolean);
  }

  // Check project config
  const projectConfigPath = getProjectConfigPath(projectId);
  const projectConfig = projectConfigPath ? loadYamlConfig(projectConfigPath) : {};
  if (projectConfig.enabled_facades?.length) {
    return projectConfig.enabled_facades;
  }

  // Check global config
  const globalConfig = loadYamlConfig(GLOBAL_CONFIG_PATH);
  if (globalConfig.enabled_facades?.length) {
    return globalConfig.enabled_facades;
  }

  return undefined;
}

/**
 * Set a config value in a project's .decibel/config.yaml.
 */
export function setToolConfigValue(
  projectId: string,
  facade: string,
  key: string,
  value: unknown,
): { success: boolean; path: string; message: string } {
  // Validate facade and key
  const schemaDefs = CONFIG_SCHEMA[facade];
  if (!schemaDefs) {
    return { success: false, path: '', message: `Unknown facade: "${facade}". Available: ${Object.keys(CONFIG_SCHEMA).join(', ')}` };
  }
  const keyDef = schemaDefs.find(d => d.key === key);
  if (!keyDef) {
    return { success: false, path: '', message: `Unknown key "${key}" for facade "${facade}". Available: ${schemaDefs.map(d => d.key).join(', ')}` };
  }

  // Resolve project path
  let configPath: string;
  try {
    const resolved = resolveProjectPaths(projectId);
    configPath = join(resolved.decibelPath, 'config.yaml');
  } catch (err) {
    return { success: false, path: '', message: `Project resolution failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  // Load existing config
  let config: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, 'utf-8');
      config = (YAML.parse(raw) as Record<string, unknown>) || {};
    } catch {
      // Start fresh if corrupt
      config = {};
    }
  }

  // Set value
  if (!config.tools) config.tools = {};
  const tools = config.tools as Record<string, Record<string, unknown>>;
  if (!tools[facade]) tools[facade] = {};
  tools[facade][key] = value;

  // Write back
  const dir = configPath.replace(/\/[^/]+$/, '');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(configPath, YAML.stringify(config, { lineWidth: 120 }));

  return { success: true, path: configPath, message: `Set ${facade}.${key} = ${JSON.stringify(value)}` };
}

/**
 * Set the active profile in a project's .decibel/config.yaml.
 */
export function setProfile(
  projectId: string,
  profileName: string,
): { success: boolean; path: string; message: string } {
  if (!BUILT_IN_PROFILES[profileName]) {
    return {
      success: false,
      path: '',
      message: `Unknown profile: "${profileName}". Available: ${Object.keys(BUILT_IN_PROFILES).join(', ')}`,
    };
  }

  let configPath: string;
  try {
    const resolved = resolveProjectPaths(projectId);
    configPath = join(resolved.decibelPath, 'config.yaml');
  } catch (err) {
    return { success: false, path: '', message: `Project resolution failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  let config: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, 'utf-8');
      config = (YAML.parse(raw) as Record<string, unknown>) || {};
    } catch {
      config = {};
    }
  }

  config.profile = profileName;

  const dir = configPath.replace(/\/[^/]+$/, '');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(configPath, YAML.stringify(config, { lineWidth: 120 }));

  return { success: true, path: configPath, message: `Profile set to "${profileName}"` };
}
