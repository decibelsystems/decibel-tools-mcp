// ============================================================================
// Daemon Config — YAML-based persistent configuration
// ============================================================================
// Loads from ~/.decibel/config.yaml. CLI flags override config file values,
// config file overrides defaults. SIGHUP reloads hot-reloadable fields.
// ============================================================================

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import YAML from 'yaml';
import { log } from './config.js';

// ============================================================================
// Config Schema
// ============================================================================

export interface DaemonConfig {
  daemon: {
    port: number;
    host: string;
    auth_token?: string;
    log_max_size_mb: number;
    log_max_files: number;
    rate_limit_rpm: number;
  };
  license?: {
    key?: string;
  };
}

const DEFAULT_CONFIG: DaemonConfig = {
  daemon: {
    port: 4888,
    host: '127.0.0.1',
    log_max_size_mb: 10,
    log_max_files: 3,
    rate_limit_rpm: 100,
  },
};

// ============================================================================
// Config Path
// ============================================================================

const CONFIG_PATH = join(homedir(), '.decibel', 'config.yaml');

// ============================================================================
// Load & Parse
// ============================================================================

/**
 * Load config from ~/.decibel/config.yaml, merged with defaults.
 * Returns defaults if file doesn't exist or is invalid.
 */
export function loadConfig(): DaemonConfig {
  if (!existsSync(CONFIG_PATH)) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    const parsed = YAML.parse(raw) as Partial<DaemonConfig> | null;

    if (!parsed) return { ...DEFAULT_CONFIG };

    return {
      daemon: {
        port: parsed.daemon?.port ?? DEFAULT_CONFIG.daemon.port,
        host: parsed.daemon?.host ?? DEFAULT_CONFIG.daemon.host,
        auth_token: parsed.daemon?.auth_token ?? DEFAULT_CONFIG.daemon.auth_token,
        log_max_size_mb: parsed.daemon?.log_max_size_mb ?? DEFAULT_CONFIG.daemon.log_max_size_mb,
        log_max_files: parsed.daemon?.log_max_files ?? DEFAULT_CONFIG.daemon.log_max_files,
        rate_limit_rpm: parsed.daemon?.rate_limit_rpm ?? DEFAULT_CONFIG.daemon.rate_limit_rpm,
      },
      license: parsed.license ? {
        key: parsed.license.key,
      } : undefined,
    };
  } catch (err) {
    log(`Config: Failed to parse ${CONFIG_PATH}: ${err}`);
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Get the config file path (for display purposes).
 */
export function getConfigPath(): string {
  return CONFIG_PATH;
}

/**
 * Merge CLI flags over config file values. CLI takes precedence.
 */
export function mergeCliOverrides(
  config: DaemonConfig,
  overrides: {
    port?: number;
    host?: string;
    authToken?: string;
    logMaxSizeMb?: number;
    logMaxFiles?: number;
    rateLimitRpm?: number;
  },
): DaemonConfig {
  return {
    ...config,
    daemon: {
      ...config.daemon,
      ...(overrides.port !== undefined && { port: overrides.port }),
      ...(overrides.host !== undefined && { host: overrides.host }),
      ...(overrides.authToken !== undefined && { auth_token: overrides.authToken }),
      ...(overrides.logMaxSizeMb !== undefined && { log_max_size_mb: overrides.logMaxSizeMb }),
      ...(overrides.logMaxFiles !== undefined && { log_max_files: overrides.logMaxFiles }),
      ...(overrides.rateLimitRpm !== undefined && { rate_limit_rpm: overrides.rateLimitRpm }),
    },
  };
}

/**
 * Reload config and return hot-reloadable fields that changed.
 * Port and host changes are detected but require a restart.
 */
export function reloadConfig(
  current: DaemonConfig,
): { config: DaemonConfig; changes: string[]; requiresRestart: boolean } {
  const reloaded = loadConfig();
  const changes: string[] = [];
  let requiresRestart = false;

  if (reloaded.daemon.port !== current.daemon.port) {
    changes.push(`port: ${current.daemon.port} → ${reloaded.daemon.port}`);
    requiresRestart = true;
  }
  if (reloaded.daemon.host !== current.daemon.host) {
    changes.push(`host: ${current.daemon.host} → ${reloaded.daemon.host}`);
    requiresRestart = true;
  }
  if (reloaded.daemon.rate_limit_rpm !== current.daemon.rate_limit_rpm) {
    changes.push(`rate_limit_rpm: ${current.daemon.rate_limit_rpm} → ${reloaded.daemon.rate_limit_rpm}`);
  }
  if (reloaded.daemon.log_max_size_mb !== current.daemon.log_max_size_mb) {
    changes.push(`log_max_size_mb: ${current.daemon.log_max_size_mb} → ${reloaded.daemon.log_max_size_mb}`);
  }
  if (reloaded.daemon.log_max_files !== current.daemon.log_max_files) {
    changes.push(`log_max_files: ${current.daemon.log_max_files} → ${reloaded.daemon.log_max_files}`);
  }
  if (reloaded.daemon.auth_token !== current.daemon.auth_token) {
    changes.push('auth_token: changed');
  }

  return { config: reloaded, changes, requiresRestart };
}
