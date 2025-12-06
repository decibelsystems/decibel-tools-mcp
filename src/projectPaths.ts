// ============================================================================
// Project Path Resolution
// ============================================================================
// Helps MCP tools resolve project roots from project IDs.
// TODO: Later read from .decibel/config.yml for dynamic project configuration.
// ============================================================================

// ============================================================================
// Types
// ============================================================================

export interface ProjectConfig {
  projectId: string;
  projectName?: string;
  root: string;
}

// ============================================================================
// Project Registry
// ============================================================================

/**
 * Hardcoded project map.
 * TODO: Replace with dynamic loading from .decibel/config.yml
 */
const PROJECTS: Record<string, ProjectConfig> = {
  senken: {
    projectId: "senken",
    projectName: "Senken Trading Agent",
    root: "/Users/ben/decibel/senken-trading-agent",
  },
  // Add other projects here as needed
};

// ============================================================================
// Public API
// ============================================================================

/**
 * Resolve project configuration from a project ID.
 *
 * @param projectId - The unique identifier for the project
 * @returns The project configuration including root path
 * @throws Error if the projectId is not found in the registry
 */
export async function resolveProjectRoot(
  projectId: string
): Promise<ProjectConfig> {
  const config = PROJECTS[projectId];

  if (!config) {
    const knownProjects = Object.keys(PROJECTS);
    throw new Error(
      `Unknown projectId: "${projectId}". ` +
        `Known projects: ${knownProjects.length > 0 ? knownProjects.join(", ") : "(none)"}`
    );
  }

  return config;
}

/**
 * List all known project IDs.
 *
 * @returns Array of registered project IDs
 */
export function listProjectIds(): string[] {
  return Object.keys(PROJECTS);
}
