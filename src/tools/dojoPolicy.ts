/**
 * Dojo Policy Enforcement
 *
 * Loads and enforces role-based access control for Dojo tools.
 * Ensures Mother and other AI callers can only access sandbox-safe operations.
 */

import fs from 'fs';
import path from 'path';
import { parse as parseYaml } from 'yaml';
import { log } from '../config.js';

// ============================================================================
// Types
// ============================================================================

export type CallerRole = 'human' | 'mother' | 'ai';

export interface SandboxPolicy {
  fs_read: string[];
  fs_write: string[];
  exec_allowlist: string[];
  net: boolean;
}

export interface RolePolicy {
  description?: string;
  allowed_tools: string[];
  denied_tools?: string[];
  sandbox: SandboxPolicy;
  inherits?: string;
}

export interface SafetyPolicy {
  never_expose_to_ai: string[];
  always_sandbox_run: boolean;
  results_write_fence: string;
}

export interface DojoPolicy {
  roles: Record<string, RolePolicy>;
  default_role: CallerRole;
  safety: SafetyPolicy;
}

export interface PolicyCheckResult {
  allowed: boolean;
  reason?: string;
  sandbox?: SandboxPolicy;
}

// ============================================================================
// Default Policy (fallback if file not found)
// ============================================================================

const DEFAULT_POLICY: DojoPolicy = {
  roles: {
    human: {
      description: 'Full Dojo access',
      allowed_tools: ['*'],
      sandbox: {
        fs_read: ['**'],
        fs_write: ['**'],
        exec_allowlist: ['*'],
        net: true,
      },
    },
    mother: {
      description: 'Mother AI - sandbox-only',
      allowed_tools: [
        'dojo_add_wish',
        'dojo_list_wishes',
        'dojo_create_proposal',
        'dojo_list',
        'dojo_scaffold_experiment',
        'dojo_run_experiment',
        'dojo_get_results',
        'dojo_can_graduate',
      ],
      denied_tools: [
        'dojo_enable_experiment',
        'dojo_disable_experiment',
        'dojo_graduate_experiment',
      ],
      sandbox: {
        fs_read: ['{DOJO_ROOT}/**'],
        fs_write: ['{DOJO_ROOT}/results/**', '{DOJO_ROOT}/wishes/**', '{DOJO_ROOT}/proposals/**'],
        exec_allowlist: ['python', 'python3', 'node', 'rg', 'git'],
        net: false,
      },
    },
    ai: {
      description: 'Generic AI caller',
      allowed_tools: [],
      inherits: 'mother',
      sandbox: {
        fs_read: [],
        fs_write: [],
        exec_allowlist: [],
        net: false,
      },
    },
  },
  default_role: 'human',
  safety: {
    never_expose_to_ai: [
      'dojo_enable_experiment',
      'dojo_disable_experiment',
      'dojo_graduate_experiment',
    ],
    always_sandbox_run: true,
    results_write_fence: '{DOJO_ROOT}/results/**',
  },
};

// ============================================================================
// Policy Loader (singleton)
// ============================================================================

let cachedPolicy: DojoPolicy | null = null;

/**
 * Load the Dojo policy from .decibel/dojo_policy.yaml
 * Falls back to default policy if file not found
 */
export function loadDojoPolicy(forceReload = false): DojoPolicy {
  if (cachedPolicy && !forceReload) {
    return cachedPolicy;
  }

  const policyPaths = [
    path.join(process.cwd(), '.decibel', 'dojo_policy.yaml'),
    path.join(process.cwd(), 'dojo_policy.yaml'),
  ];

  for (const policyPath of policyPaths) {
    try {
      if (fs.existsSync(policyPath)) {
        const content = fs.readFileSync(policyPath, 'utf-8');
        const parsed = parseYaml(content) as DojoPolicy;
        cachedPolicy = mergeWithDefaults(parsed);
        log(`dojoPolicy: Loaded policy from ${policyPath}`);
        return cachedPolicy;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`dojoPolicy: Failed to load ${policyPath}: ${message}`);
    }
  }

  log('dojoPolicy: Using default policy (no policy file found)');
  cachedPolicy = DEFAULT_POLICY;
  return cachedPolicy;
}

/**
 * Merge loaded policy with defaults to ensure all fields exist
 */
function mergeWithDefaults(loaded: Partial<DojoPolicy>): DojoPolicy {
  return {
    roles: { ...DEFAULT_POLICY.roles, ...loaded.roles },
    default_role: loaded.default_role || DEFAULT_POLICY.default_role,
    safety: { ...DEFAULT_POLICY.safety, ...loaded.safety },
  };
}

// ============================================================================
// Policy Enforcement
// ============================================================================

/**
 * Resolve a role, handling inheritance
 */
function resolveRole(roleName: string, policy: DojoPolicy): RolePolicy | null {
  const role = policy.roles[roleName];
  if (!role) {
    return null;
  }

  // Handle inheritance
  if (role.inherits && policy.roles[role.inherits]) {
    const parent = resolveRole(role.inherits, policy);
    if (parent) {
      return {
        ...parent,
        ...role,
        allowed_tools: role.allowed_tools.length > 0 ? role.allowed_tools : parent.allowed_tools,
        denied_tools: [...(parent.denied_tools || []), ...(role.denied_tools || [])],
        sandbox: {
          ...parent.sandbox,
          ...role.sandbox,
        },
      };
    }
  }

  return role;
}

/**
 * Check if a caller role is allowed to use a specific tool
 */
export function checkToolAccess(
  toolName: string,
  callerRole: CallerRole = 'human'
): PolicyCheckResult {
  const policy = loadDojoPolicy();

  // Check safety: never expose certain tools to AI
  if (callerRole !== 'human' && policy.safety.never_expose_to_ai.includes(toolName)) {
    return {
      allowed: false,
      reason: `Tool "${toolName}" is never allowed for AI callers`,
    };
  }

  // Get role policy
  const role = resolveRole(callerRole, policy);
  if (!role) {
    // Unknown role - use default
    const defaultRole = resolveRole(policy.default_role, policy);
    if (!defaultRole) {
      return { allowed: false, reason: 'Unknown role and no default role configured' };
    }
  }

  const effectiveRole = role || resolveRole(policy.default_role, policy)!;

  // Check denied list first
  if (effectiveRole.denied_tools?.includes(toolName)) {
    return {
      allowed: false,
      reason: `Tool "${toolName}" is explicitly denied for role "${callerRole}"`,
    };
  }

  // Check allowed list
  const isAllowed =
    effectiveRole.allowed_tools.includes('*') || effectiveRole.allowed_tools.includes(toolName);

  if (!isAllowed) {
    return {
      allowed: false,
      reason: `Tool "${toolName}" is not in allowed list for role "${callerRole}"`,
    };
  }

  return {
    allowed: true,
    sandbox: effectiveRole.sandbox,
  };
}

/**
 * Get the sandbox policy for a caller role
 */
export function getSandboxPolicy(callerRole: CallerRole = 'human'): SandboxPolicy {
  const policy = loadDojoPolicy();
  const role = resolveRole(callerRole, policy);

  if (!role) {
    // Strictest sandbox for unknown roles
    return {
      fs_read: [],
      fs_write: [],
      exec_allowlist: [],
      net: false,
    };
  }

  return role.sandbox;
}

/**
 * Expand sandbox path patterns with actual Dojo root
 */
export function expandSandboxPaths(sandbox: SandboxPolicy, dojoRoot: string): SandboxPolicy {
  const expand = (patterns: string[]): string[] =>
    patterns.map((p) => p.replace('{DOJO_ROOT}', dojoRoot));

  return {
    fs_read: expand(sandbox.fs_read),
    fs_write: expand(sandbox.fs_write),
    exec_allowlist: sandbox.exec_allowlist,
    net: sandbox.net,
  };
}

/**
 * Check if a path is allowed for writing under the sandbox policy
 */
export function isWriteAllowed(targetPath: string, sandbox: SandboxPolicy): boolean {
  const normalizedTarget = path.normalize(targetPath);

  for (const pattern of sandbox.fs_write) {
    // Simple glob matching (supports ** and *)
    const regexPattern = pattern
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]*')
      .replace(/\//g, '\\/');

    const regex = new RegExp(`^${regexPattern}$`);
    if (regex.test(normalizedTarget)) {
      return true;
    }

    // Also check if target is under the pattern directory
    const patternDir = pattern.replace(/\/\*\*$/, '').replace(/\/\*$/, '');
    if (normalizedTarget.startsWith(path.normalize(patternDir))) {
      return true;
    }
  }

  return false;
}

/**
 * Check if an executable is allowed under the sandbox policy
 */
export function isExecAllowed(executable: string, sandbox: SandboxPolicy): boolean {
  if (sandbox.exec_allowlist.includes('*')) {
    return true;
  }

  const baseName = path.basename(executable);
  return sandbox.exec_allowlist.includes(baseName) || sandbox.exec_allowlist.includes(executable);
}

// ============================================================================
// Convenience: Enforce or throw
// ============================================================================

/**
 * Enforce tool access - throws if not allowed
 */
export function enforceToolAccess(toolName: string, callerRole: CallerRole = 'human'): void {
  const result = checkToolAccess(toolName, callerRole);
  if (!result.allowed) {
    throw new Error(`Access denied: ${result.reason}`);
  }
}
