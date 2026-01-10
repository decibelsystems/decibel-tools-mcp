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
} from '../../projectRegistry.js';

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
              args: ['-y', 'decibel-tools-mcp'],
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

      // If checking a specific path
      if (args.path) {
        const hasDecibel = hasDecibelFolder(args.path);
        const dirName = path.basename(args.path);
        const isRegistered = projects.some(p => p.path === path.resolve(args.path!));

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
          aliases: project.aliases,
          hasDecibelFolder: hasDecibel,
          status: hasDecibel ? 'ready' : 'missing_decibel_folder',
        });
      }

      // List all projects
      const projectStatuses = projects.map(p => ({
        id: p.id,
        name: p.name,
        path: p.path,
        aliases: p.aliases,
        hasDecibelFolder: hasDecibelFolder(p.path),
      }));

      return toolSuccess({
        totalProjects: projects.length,
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
      projectCount: projects.length,
      projects: projects.map(p => ({
        id: p.id,
        name: p.name,
        path: p.path,
        aliases: p.aliases || [],
      })),
    });
  },
};

export const registryAddTool: ToolSpec = {
  definition: {
    name: 'registry_add',
    description: 'Register a project in the Decibel registry. The project path must contain a .decibel folder.',
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
      },
      required: ['id', 'path'],
    },
  },
  handler: async (args) => {
    try {
      requireFields(args, 'id', 'path');
      registerProject({ id: args.id, path: args.path, name: args.name, aliases: args.aliases });
      return toolSuccess({
        success: true,
        message: `Project "${args.id}" registered successfully`,
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
];
