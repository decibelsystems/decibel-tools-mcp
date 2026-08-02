// ============================================================================
// Registry Domain Tools
// ============================================================================
// Tools for project initialization and registry management.
// ============================================================================

import fs from 'fs';
import path from 'path';
import { ToolSpec } from '../types.js';
import { toolSuccess, toolError, requireFields } from '../shared/index.js';
import {
  listProjects,
  registerProject,
  unregisterProject,
  addProjectAlias,
  resolveProject,
  getRegistryFilePath,
  scanForProjects,
  getDeviceId,
} from '../../projectRegistry.js';
import {
  getToolConfig,
  getAllToolConfig,
  setToolConfigValue,
  setProfile,
  getEnabledFacades,
  CONFIG_SCHEMA,
  BUILT_IN_PROFILES,
} from '../../toolConfig.js';

// ============================================================================
// Types
// ============================================================================

interface ProjectInitArgs {
  path: string;
  id?: string;
  name?: string;
  description?: string;
  aliases?: string[];
  force?: boolean;
}

interface ProjectStatusArgs {
  projectId?: string;
  path?: string;
}

interface RegistryAddArgs {
  id: string;
  path: string;
  name?: string;
  aliases?: string[];
}

interface RegistryRemoveArgs {
  id: string;
}

interface RegistryAliasArgs {
  id: string;
  alias: string;
}

interface RegistryResolveArgs {
  projectId: string;
}

// ============================================================================
// Constants
// ============================================================================

const DECIBEL_STRUCTURE = [
  'architect/adrs',
  'architect/decisions',
  'architect/policies',
  'architect/roadmap',
  'designer/decisions',
  'designer/crits',
  'sentinel/issues',
  'sentinel/epics',
  'sentinel/tests',
  'dojo/experiments',
  'dojo/proposals',
  'dojo/wishes',
  'oracle/learnings',
  'context/facts',
  'context/events',
  'friction',
  'learnings',
  'provenance/events',
];

// ============================================================================
// Helper Functions
// ============================================================================

function hasDecibelFolder(projectPath: string): boolean {
  const decibelPath = path.join(projectPath, '.decibel');
  return fs.existsSync(decibelPath) && fs.statSync(decibelPath).isDirectory();
}

// ============================================================================
// Tools
// ============================================================================

export const projectInitTool: ToolSpec = {
  definition: {
    name: 'project_init',
    description: `Initialize a new Decibel project. Creates the .decibel/ folder structure and registers in the project registry.

Use this when:
- Starting a new project that will use Decibel tools
- You get a PROJECT_NOT_FOUND error and need to set up the project
- Converting an existing repo to use Decibel

This creates: architect/, designer/, sentinel/, dojo/, oracle/, context/, friction/, learnings/, provenance/ folders.`,
    annotations: {
      title: 'Initialize Project',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Absolute path to the project root directory',
        },
        id: {
          type: 'string',
          description: 'Project ID (defaults to directory name)',
        },
        name: {
          type: 'string',
          description: 'Human-readable project name',
        },
        description: {
          type: 'string',
          description: 'Brief project description',
        },
        aliases: {
          type: 'array',
          items: { type: 'string' },
          description: 'Shortcut names for this project (e.g., ["tools", "tools-ios"])',
        },
        force: {
          type: 'boolean',
          description: 'Overwrite existing .decibel folder if present',
        },
        cursor: {
          type: 'boolean',
          description: 'Generate .cursor/mcp.json for Cursor MCP integration',
        },
      },
      required: ['path'],
    },
  },
  handler: async (args) => {
    try {
      requireFields(args, 'path');

      // Validate path exists
      if (!fs.existsSync(args.path)) {
        return toolError(
          `Path does not exist: ${args.path}`,
          'Create the directory first or check the path.'
        );
      }

      const decibelPath = path.join(args.path, '.decibel');

      // Check for existing .decibel folder
      if (fs.existsSync(decibelPath) && !args.force) {
        return toolError(
          `Project already has a .decibel folder at ${args.path}`,
          'Use force=true to reinitialize, or just use registry_add to register it.'
        );
      }

      // Derive project ID from path if not provided
      const projectId = args.id || path.basename(args.path);

      // Create folder structure
      const createdDirs: string[] = [];
      for (const dir of DECIBEL_STRUCTURE) {
        const fullPath = path.join(decibelPath, dir);
        if (!fs.existsSync(fullPath)) {
          fs.mkdirSync(fullPath, { recursive: true });
          createdDirs.push(dir);

          // Add .gitkeep to leaf directories
          const gitkeepPath = path.join(fullPath, '.gitkeep');
          if (!fs.existsSync(gitkeepPath)) {
            fs.writeFileSync(gitkeepPath, '# This file ensures the directory is tracked by git\n');
          }
        }
      }

      // Create manifest.yaml
      const manifestPath = path.join(decibelPath, 'manifest.yaml');
      if (!fs.existsSync(manifestPath) || args.force) {
        const timestamp = new Date().toISOString();
        const manifestContent = `# Decibel Project Manifest
# Generated: ${timestamp}

id: ${projectId}
name: ${args.name || projectId}
version: 1.0.0
${args.description ? `description: ${args.description}` : ''}

created_at: ${timestamp}
decibel_version: "1.0"
`;
        fs.writeFileSync(manifestPath, manifestContent);
      }

      // Generate .cursor/mcp.json if requested
      let cursorConfigCreated = false;
      if (args.cursor) {
        const cursorDir = path.join(args.path, '.cursor');
        const cursorConfigPath = path.join(cursorDir, 'mcp.json');

        if (!fs.existsSync(cursorDir)) {
          fs.mkdirSync(cursorDir, { recursive: true });
        }

        const cursorConfig = {
          mcpServers: {
            'decibel-tools': {
              command: 'npx',
              args: ['-y', '@decibelsystems/tools'],
              env: {},
            },
          },
        };

        fs.writeFileSync(cursorConfigPath, JSON.stringify(cursorConfig, null, 2) + '\n');
        cursorConfigCreated = true;
      }

      // Register in project registry
      try {
        registerProject({
          id: projectId,
          name: args.name || projectId,
          path: path.resolve(args.path),
          aliases: args.aliases,
        });
      } catch (regErr) {
        // If already registered, that's fine
        const errMsg = regErr instanceof Error ? regErr.message : String(regErr);
        if (!errMsg.includes('already') && !errMsg.includes('Update')) {
          throw regErr;
        }
      }

      const nextSteps = [
        `Project is ready! Use projectId="${projectId}" in tool calls.`,
        'Available tools: sentinel_log_epic, sentinel_createIssue, designer_record_design_decision, architect_createAdr, dojo_add_wish, friction_log, learnings_append',
      ];

      if (cursorConfigCreated) {
        nextSteps.push('Cursor config created at .cursor/mcp.json - restart Cursor to activate');
      }

      return toolSuccess({
        success: true,
        message: `Project "${projectId}" initialized and registered`,
        project: {
          id: projectId,
          name: args.name || projectId,
          path: path.resolve(args.path),
          aliases: args.aliases || [],
        },
        structure: {
          root: decibelPath,
          created: createdDirs.length,
          folders: DECIBEL_STRUCTURE,
        },
        cursor: cursorConfigCreated ? {
          config_path: path.join(args.path, '.cursor', 'mcp.json'),
          server_name: 'decibel-tools',
        } : undefined,
        next_steps: nextSteps,
      });
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

export const projectStatusTool: ToolSpec = {
  definition: {
    name: 'project_status',
    description: 'Check the status of a project - whether it exists, is registered, and what tools are available.',
    annotations: {
      title: 'Project Status',
      readOnlyHint: true,
      destructiveHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project ID to check (lists all if omitted)',
        },
        path: {
          type: 'string',
          description: 'Path to check (alternative to projectId)',
        },
      },
    },
  },
  handler: async (args) => {
    try {
      const projects = listProjects();

      // If checking a specific path — match against every path a project is
      // known by (effective, canonical, and all device copies).
      if (args.path) {
        const hasDecibel = hasDecibelFolder(args.path);
        const dirName = path.basename(args.path);
        const resolvedPath = path.resolve(args.path);
        const isRegistered = projects.some(p =>
          p.path === resolvedPath ||
          p.canonicalPath === resolvedPath ||
          Object.values(p.devicePaths ?? {}).includes(resolvedPath)
        );

        return toolSuccess({
          path: args.path,
          hasDecibelFolder: hasDecibel,
          isRegistered,
          status: hasDecibel && isRegistered ? 'ready' :
                  hasDecibel ? 'needs_registration' :
                  'needs_initialization',
          action: hasDecibel && isRegistered ? 'Project is ready to use' :
                  hasDecibel ? `Run: registry_add with id="${dirName}" and path="${args.path}"` :
                  `Run: project_init with path="${args.path}"`,
        });
      }

      // If checking a specific project ID
      if (args.projectId) {
        const project = projects.find(p =>
          p.id === args.projectId || p.aliases?.includes(args.projectId!)
        );

        if (!project) {
          return toolSuccess({
            projectId: args.projectId,
            found: false,
            registered: projects.map(p => ({ id: p.id, aliases: p.aliases })),
            hint: 'Use project_init to create a new project, or registry_add if .decibel exists.',
          });
        }

        const hasDecibel = hasDecibelFolder(project.path);

        return toolSuccess({
          projectId: project.id,
          found: true,
          name: project.name,
          path: project.path,
          canonicalPath: project.canonicalPath,
          pathSource: project.pathSource,
          deviceId: getDeviceId(),
          aliases: project.aliases,
          hasDecibelFolder: hasDecibel,
          status: hasDecibel ? 'ready' : 'unavailable_on_this_device',
        });
      }

      // List all projects (paths are device-effective)
      const projectStatuses = projects.map(p => ({
        id: p.id,
        name: p.name,
        path: p.path,
        canonicalPath: p.canonicalPath,
        pathSource: p.pathSource,
        aliases: p.aliases,
        hasDecibelFolder: p.available ?? hasDecibelFolder(p.path),
      }));

      return toolSuccess({
        totalProjects: projects.length,
        deviceId: getDeviceId(),
        projects: projectStatuses,
      });
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

export const registryListTool: ToolSpec = {
  definition: {
    name: 'registry_list',
    description: 'List all registered projects in the Decibel registry. Shows project IDs, paths, and aliases.',
    annotations: {
      title: 'List Projects',
      readOnlyHint: true,
      destructiveHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  handler: async () => {
    const projects = listProjects();
    const registryPath = getRegistryFilePath();

    if (projects.length === 0) {
      return toolSuccess({
        registryPath,
        projects: [],
        message: 'No projects registered. Use registry_add to register a project.',
      });
    }

    return toolSuccess({
      registryPath,
      deviceId: getDeviceId(),
      projectCount: projects.length,
      projects: projects.map(p => ({
        id: p.id,
        name: p.name,
        path: p.path,
        canonicalPath: p.canonicalPath,
        available: p.available,
        pathSource: p.pathSource,
        devicePaths: p.devicePaths,
        aliases: p.aliases || [],
      })),
    });
  },
};

export const registryAddTool: ToolSpec = {
  definition: {
    name: 'registry_add',
    description: `Register a project in the Decibel registry. The project path must contain a .decibel folder.

Device-aware: registering an EXISTING id with a different path records that path as this device's copy (devicePaths) instead of overwriting the canonical path — so a laptop and desktop can share one registry. Pass canonical=true to deliberately rewrite the canonical path (project genuinely moved).`,
    annotations: {
      title: 'Register Project',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Unique project ID (typically the directory name)',
        },
        path: {
          type: 'string',
          description: 'Absolute path to the project root (must contain .decibel/)',
        },
        name: {
          type: 'string',
          description: 'Human-readable project name',
        },
        aliases: {
          type: 'array',
          items: { type: 'string' },
          description: 'Alternative names/shortcuts for this project',
        },
        canonical: {
          type: 'boolean',
          description: 'Force-rewrite the canonical path for an existing id (default: a differing path is stored as this device\'s copy)',
        },
      },
      required: ['id', 'path'],
    },
  },
  handler: async (args) => {
    try {
      requireFields(args, 'id', 'path');
      const result = registerProject(
        { id: args.id, path: args.path, name: args.name, aliases: args.aliases },
        // Explicit registry_add may repoint this device's link; scans may not.
        { canonical: args.canonical === true, repoint: true },
      );
      return toolSuccess({
        success: true,
        message: `Project "${args.id}" registered successfully (${result.action})`,
        deviceId: getDeviceId(),
        result,
        project: { id: args.id, path: args.path, name: args.name, aliases: args.aliases },
      });
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

export const registryRemoveTool: ToolSpec = {
  definition: {
    name: 'registry_remove',
    description: 'Remove a project from the Decibel registry. Does not delete project files.',
    annotations: {
      title: 'Unregister Project',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Project ID to remove',
        },
      },
      required: ['id'],
    },
  },
  handler: async (args) => {
    try {
      requireFields(args, 'id');
      const removed = unregisterProject(args.id);
      return toolSuccess({
        success: removed,
        message: removed
          ? `Project "${args.id}" removed from registry`
          : `Project "${args.id}" not found in registry`,
      });
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

export const registryAliasTool: ToolSpec = {
  definition: {
    name: 'registry_alias',
    description: 'Add an alias (shortcut name) to an existing project in the registry.',
    annotations: {
      title: 'Add Project Alias',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Project ID to add alias to',
        },
        alias: {
          type: 'string',
          description: 'Alias to add (e.g., "senken" as alias for "senken-trading-agent")',
        },
      },
      required: ['id', 'alias'],
    },
  },
  handler: async (args) => {
    try {
      requireFields(args, 'id', 'alias');
      addProjectAlias(args.id, args.alias);
      return toolSuccess({
        success: true,
        message: `Alias "${args.alias}" added to project "${args.id}"`,
      });
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

export const registryScanTool: ToolSpec = {
  definition: {
    name: 'registry_scan',
    description: `Scan filesystem roots for .decibel/ directories and reconcile against the registry.

Returns a diff:
- found: every project directory discovered
- unregistered: has .decibel/ on disk but not in registry
- orphans: registered in projects.json but path/.decibel missing on disk

Roots resolution order: explicit roots arg → DECIBEL_SCAN_ROOTS env var → parent dirs of registered projects.

Pass apply=true to register all unregistered projects (ID = directory basename). Device-aware: a found directory whose basename matches an already-registered id is linked as this device's copy (devicePaths) rather than overwriting the canonical path. Orphans with reason "volume_unmounted:<name>" just need their external drive mounted. Does not touch other orphans — use registry_remove to clean those up.`,
    annotations: {
      title: 'Scan Registry',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        roots: {
          type: 'array',
          items: { type: 'string' },
          description: 'Absolute directories to scan. Scans immediate children only.',
        },
        apply: {
          type: 'boolean',
          description: 'If true, register all unregistered found projects. Default: false (dry run).',
        },
      },
    },
  },
  handler: async (args) => {
    try {
      const result = scanForProjects(args.roots as string[] | undefined);

      const applied: Array<{ id: string; path: string; action: string; skippedPath?: string }> = [];
      const applyFailures: Array<{ id: string; path: string; error: string }> = [];

      if (args.apply) {
        for (const finding of result.unregistered) {
          try {
            // No repoint: scan-discovered duplicates (backup drives, stale
            // clones) must not steal an existing valid device link. Root order
            // in the scan = priority for first link.
            const reg = registerProject({ id: finding.id, path: finding.path, name: finding.id });
            applied.push({ id: finding.id, path: reg.path, action: reg.action, skippedPath: reg.skippedPath });
          } catch (err) {
            applyFailures.push({
              id: finding.id,
              path: finding.path,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }

      return toolSuccess({
        roots: result.roots,
        deviceId: getDeviceId(),
        summary: {
          found: result.found.length,
          registered: result.found.filter((f) => f.registered).length,
          unregistered: result.unregistered.length,
          orphans: result.orphans.length,
          applied: applied.length,
          apply_failures: applyFailures.length,
        },
        unregistered: result.unregistered,
        orphans: result.orphans,
        applied,
        apply_failures: applyFailures,
        hint: args.apply
          ? undefined
          : result.unregistered.length > 0
            ? 'Re-run with apply=true to register the unregistered projects.'
            : undefined,
      });
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

export const registryResolveTool: ToolSpec = {
  definition: {
    name: 'registry_resolve',
    description: 'Test resolution of a project ID/alias. Shows which project would be resolved and how.',
    annotations: {
      title: 'Resolve Project',
      readOnlyHint: true,
      destructiveHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project ID, alias, or path to resolve',
        },
      },
      required: ['projectId'],
    },
  },
  handler: async (args) => {
    try {
      requireFields(args, 'projectId');
      const entry = resolveProject(args.projectId);
      return toolSuccess({
        success: true,
        input: args.projectId,
        resolved: {
          id: entry.id,
          name: entry.name,
          path: entry.path,
          aliases: entry.aliases,
        },
      });
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// Config Tools
// ============================================================================

export const configGetTool: ToolSpec = {
  definition: {
    name: 'config_get',
    description: 'Get merged tool configuration for a project. Shows the effective config after merging all layers (defaults, profile, project config, global config, env vars).',
    annotations: {
      title: 'Get Config',
      readOnlyHint: true,
      destructiveHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project ID (uses default project if omitted)',
        },
        facade: {
          type: 'string',
          description: 'Specific facade to get config for (returns all if omitted)',
        },
      },
    },
  },
  handler: async (args) => {
    try {
      const projectId = args.projectId as string | undefined;

      if (args.facade) {
        const facadeConfig = getToolConfig(projectId, args.facade as string);
        if (Object.keys(facadeConfig).length === 0) {
          return toolError(`No configurable keys for facade "${args.facade}". Use config_list to see available facades.`);
        }
        return toolSuccess({
          facade: args.facade,
          projectId: projectId || '(default)',
          config: facadeConfig,
        });
      }

      const allConfig = getAllToolConfig(projectId);
      const enabledFacades = getEnabledFacades(projectId);

      return toolSuccess({
        projectId: projectId || '(default)',
        enabled_facades: enabledFacades || '(all)',
        config: allConfig,
      });
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

export const configSetTool: ToolSpec = {
  definition: {
    name: 'config_set',
    description: 'Set a tool configuration value in the project\'s .decibel/config.yaml. Use config_list to discover available keys.',
    annotations: {
      title: 'Set Config',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project ID',
        },
        facade: {
          type: 'string',
          description: 'Facade name (e.g., "sentinel", "guardian")',
        },
        key: {
          type: 'string',
          description: 'Config key to set (e.g., "fail_threshold")',
        },
        value: {
          description: 'Value to set (type depends on key)',
        },
        profile: {
          type: 'string',
          description: 'Set a named profile instead of individual key (solo-dev|team|ci|minimal)',
        },
      },
      required: ['projectId'],
    },
  },
  handler: async (args) => {
    try {
      requireFields(args, 'projectId');

      // Profile mode
      if (args.profile) {
        const result = setProfile(args.projectId as string, args.profile as string);
        if (!result.success) return toolError(result.message);
        const profile = BUILT_IN_PROFILES[args.profile as string];
        return toolSuccess({
          ...result,
          profile_description: profile.description,
          overrides: profile.overrides,
        });
      }

      // Key-value mode
      if (!args.facade || !args.key) {
        return toolError('Either provide facade + key + value, or profile. Use config_list to see options.');
      }

      const result = setToolConfigValue(
        args.projectId as string,
        args.facade as string,
        args.key as string,
        args.value,
      );
      if (!result.success) return toolError(result.message);
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

export const configListTool: ToolSpec = {
  definition: {
    name: 'config_list',
    description: 'List all configurable keys across all facades, with types, defaults, descriptions, and env var overrides. Optionally show current effective values for a project.',
    annotations: {
      title: 'List Config Keys',
      readOnlyHint: true,
      destructiveHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project ID to show effective values (omit for schema only)',
        },
        facade: {
          type: 'string',
          description: 'Filter to a specific facade',
        },
      },
    },
  },
  handler: async (args) => {
    try {
      const projectId = args.projectId as string | undefined;
      const facadeFilter = args.facade as string | undefined;
      const currentConfig = projectId ? getAllToolConfig(projectId) : null;

      const schema: Record<string, unknown[]> = {};

      for (const [facade, keys] of Object.entries(CONFIG_SCHEMA)) {
        if (facadeFilter && facade !== facadeFilter) continue;

        schema[facade] = keys.map(def => ({
          key: def.key,
          type: def.type,
          default: def.default,
          description: def.description,
          env: def.env || null,
          current: currentConfig?.[facade]?.[def.key] ?? def.default,
        }));
      }

      if (facadeFilter && !schema[facadeFilter]) {
        return toolError(`No configurable keys for facade "${facadeFilter}". Configurable facades: ${Object.keys(CONFIG_SCHEMA).join(', ')}`);
      }

      const profiles = Object.entries(BUILT_IN_PROFILES).map(([name, p]) => ({
        name,
        description: p.description,
        facades_affected: Object.keys(p.overrides),
      }));

      return toolSuccess({
        configurable_facades: Object.keys(CONFIG_SCHEMA),
        total_keys: Object.values(CONFIG_SCHEMA).reduce((sum, keys) => sum + keys.length, 0),
        schema,
        profiles,
        env_vars: {
          DECIBEL_FACADES: 'Comma-separated list of facades to enable (restricts available tools)',
          DECIBEL_PROFILE: 'Active profile name (solo-dev|team|ci|minimal)',
          ...Object.fromEntries(
            Object.values(CONFIG_SCHEMA)
              .flat()
              .filter(d => d.env)
              .map(d => [d.env!, `${d.description} [${d.type}]`])
          ),
        },
        merge_order: 'defaults → profile → project .decibel/config.yaml → ~/.decibel/config.yaml → env vars',
      });
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// Domain Export
// ============================================================================

export const registryTools: ToolSpec[] = [
  projectInitTool,
  projectStatusTool,
  registryListTool,
  registryAddTool,
  registryRemoveTool,
  registryAliasTool,
  registryResolveTool,
  registryScanTool,
  configGetTool,
  configSetTool,
  configListTool,
];
