// ============================================================================
// Facade Registry — public API for the facade system
// ============================================================================

export type { FacadeSpec, DetailTier, McpToolDefinition } from './types.js';
export { coreFacades, proFacades, allFacadeDefinitions } from './definitions.js';

import type { FacadeSpec, DetailTier, McpToolDefinition } from './types.js';

/**
 * Build MCP tool definitions from facade specs.
 * Each facade becomes one MCP tool with an `action` enum + `params` object.
 */
export function buildMcpDefinitions(
  facades: FacadeSpec[],
  tier: DetailTier = 'full'
): McpToolDefinition[] {
  return facades
    .filter(f => tier !== 'micro' || f.microEligible)
    .map(f => ({
      name: f.name,
      description: tier === 'compact' ? f.compactDescription : f.description,
      inputSchema: {
        type: 'object' as const,
        properties: {
          action: {
            type: 'string',
            enum: Object.keys(f.actions),
            description: 'The operation to perform',
          },
          params: {
            type: 'object',
            description: 'Action-specific parameters (pass the arguments the underlying tool expects)',
            additionalProperties: true,
          },
        },
        required: ['action'],
      },
    }));
}

/**
 * Build a reverse map: internal tool name → { facade, action }
 * Used for backward compatibility — when someone calls "sentinel_create_issue"
 * directly, the kernel can still route it.
 */
export function buildReverseMap(
  facades: FacadeSpec[]
): Map<string, { facade: string; action: string }> {
  const map = new Map<string, { facade: string; action: string }>();
  for (const f of facades) {
    for (const [action, internalName] of Object.entries(f.actions)) {
      map.set(internalName, { facade: f.name, action });
    }
  }
  return map;
}

/**
 * Validate that all facade action mappings point to tools that exist
 * in the kernel's tool map. Returns array of missing tool names.
 */
export function validateFacades(
  facades: FacadeSpec[],
  toolMap: Map<string, unknown>
): string[] {
  const missing: string[] = [];
  for (const f of facades) {
    for (const [action, internalName] of Object.entries(f.actions)) {
      if (!toolMap.has(internalName)) {
        missing.push(`${f.name}.${action} → ${internalName}`);
      }
    }
  }
  return missing;
}
