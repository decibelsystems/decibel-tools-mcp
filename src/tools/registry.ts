// ============================================================================
// Registry Tools
// ============================================================================
// MCP tools for managing the project registry.
// ============================================================================

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  listProjects,
  registerProject,
  unregisterProject,
  addProjectAlias,
  getRegistryFilePath,
  resolveProject,
} from '../projectRegistry.js';

// ============================================================================
// Tool Registration
// ============================================================================

export function registerRegistryTools(server: McpServer): void {
  // -------------------------------------------------------------------------
  // registry_list - List all registered projects
  // -------------------------------------------------------------------------
  server.tool(
    'registry_list',
    'List all registered projects in the Decibel registry. Shows project IDs, paths, and aliases.',
    {},
    async () => {
      const projects = listProjects();
      const registryPath = getRegistryFilePath();

      if (projects.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  registryPath,
                  projects: [],
                  message: 'No projects registered. Use registry_add to register a project.',
                },
                null,
                2
              ),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                registryPath,
                projectCount: projects.length,
                projects: projects.map((p) => ({
                  id: p.id,
                  name: p.name,
                  path: p.path,
                  aliases: p.aliases || [],
                })),
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // -------------------------------------------------------------------------
  // registry_add - Register a new project
  // -------------------------------------------------------------------------
  server.tool(
    'registry_add',
    'Register a project in the Decibel registry. The project path must contain a .decibel folder.',
    {
      id: z.string().describe('Unique project ID (typically the directory name)'),
      path: z.string().describe('Absolute path to the project root (must contain .decibel/)'),
      name: z.string().optional().describe('Human-readable project name'),
      aliases: z
        .array(z.string())
        .optional()
        .describe('Alternative names/shortcuts for this project'),
    },
    async ({ id, path, name, aliases }) => {
      try {
        registerProject({ id, path, name, aliases });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  message: `Project "${id}" registered successfully`,
                  project: { id, path, name, aliases },
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: false,
                  error: err instanceof Error ? err.message : String(err),
                },
                null,
                2
              ),
            },
          ],
        };
      }
    }
  );

  // -------------------------------------------------------------------------
  // registry_remove - Remove a project from the registry
  // -------------------------------------------------------------------------
  server.tool(
    'registry_remove',
    'Remove a project from the Decibel registry. Does not delete project files.',
    {
      id: z.string().describe('Project ID to remove'),
    },
    async ({ id }) => {
      const removed = unregisterProject(id);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: removed,
                message: removed
                  ? `Project "${id}" removed from registry`
                  : `Project "${id}" not found in registry`,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // -------------------------------------------------------------------------
  // registry_alias - Add an alias to an existing project
  // -------------------------------------------------------------------------
  server.tool(
    'registry_alias',
    'Add an alias (shortcut name) to an existing project in the registry.',
    {
      id: z.string().describe('Project ID to add alias to'),
      alias: z.string().describe('Alias to add (e.g., "senken" as alias for "senken-trading-agent")'),
    },
    async ({ id, alias }) => {
      try {
        addProjectAlias(id, alias);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  message: `Alias "${alias}" added to project "${id}"`,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: false,
                  error: err instanceof Error ? err.message : String(err),
                },
                null,
                2
              ),
            },
          ],
        };
      }
    }
  );

  // -------------------------------------------------------------------------
  // registry_resolve - Test resolution of a project ID
  // -------------------------------------------------------------------------
  server.tool(
    'registry_resolve',
    'Test resolution of a project ID/alias. Shows which project would be resolved and how.',
    {
      projectId: z.string().describe('Project ID, alias, or path to resolve'),
    },
    async ({ projectId }) => {
      try {
        const entry = resolveProject(projectId);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  input: projectId,
                  resolved: {
                    id: entry.id,
                    name: entry.name,
                    path: entry.path,
                    aliases: entry.aliases,
                  },
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: false,
                  input: projectId,
                  error: err instanceof Error ? err.message : String(err),
                },
                null,
                2
              ),
            },
          ],
        };
      }
    }
  );
}
