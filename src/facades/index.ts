// ============================================================================
// Facade Registry — public API for the facade system
// ============================================================================

export type { FacadeSpec, DetailTier, McpToolDefinition } from './types.js';
export { coreFacades, proFacades, appFacades, allFacadeDefinitions } from './definitions.js';

import type { FacadeSpec, DetailTier, McpToolDefinition } from './types.js';
import type { ToolSpec } from '../tools/types.js';

/**
 * Build a compact signature string for one action from its internal tool schema.
 * Example: "create_issue(severity: low|med|high|critical, title, details, epic_id?)"
 */
function buildActionSignature(actionName: string, tool: ToolSpec): string {
  const schema = tool.definition.inputSchema;
  const required = new Set(schema.required || []);
  const parts: string[] = [];

  for (const [name, prop] of Object.entries(schema.properties)) {
    // Skip common implicit params — they're always optional and obvious
    if (name === 'projectId' || name === 'project_id') continue;

    const p = prop as Record<string, unknown>;
    const isRequired = required.has(name);
    const isArray = p.type === 'array';
    const hasEnum = Array.isArray(p.enum);

    let sig = name;
    if (isArray) sig += '[]';
    if (hasEnum) sig += ': ' + (p.enum as string[]).join('|');
    if (!isRequired) sig += '?';

    parts.push(sig);
  }

  return `${actionName}(${parts.join(', ')})`;
}

/**
 * Build a description with per-action parameter signatures.
 * Looks up each action's internal tool to extract its inputSchema.
 */
function buildSignatureDescription(
  facade: FacadeSpec,
  toolMap: Map<string, ToolSpec>
): string {
  const lines: string[] = [];

  // Keep the first sentence from the original description (the domain summary)
  const dotIdx = facade.description.indexOf('.');
  const summary = dotIdx > 0 ? facade.description.slice(0, dotIdx + 1) : facade.description;
  lines.push(summary);
  lines.push('Actions:');

  for (const [actionName, internalName] of Object.entries(facade.actions)) {
    const tool = toolMap.get(internalName);
    if (tool) {
      lines.push(`- ${buildActionSignature(actionName, tool)}`);
    } else {
      // Fallback: just list the action name if tool not found
      lines.push(`- ${actionName}()`);
    }
  }

  return lines.join('\n');
}

/**
 * Build MCP tool definitions from facade specs.
 * Each facade becomes one MCP tool with an `action` enum + flat params.
 *
 * When toolMap is provided, descriptions include per-action parameter signatures
 * so LLMs know exactly what fields each action accepts.
 */
export function buildMcpDefinitions(
  facades: FacadeSpec[],
  tier: DetailTier = 'full',
  toolMap?: Map<string, ToolSpec>
): McpToolDefinition[] {
  return facades
    .filter(f => tier !== 'micro' || f.microEligible)
    .map(f => {
      // Build description: use signatures when toolMap available and tier is full
      let description: string;
      if (tier === 'compact') {
        description = f.compactDescription;
      } else if (toolMap) {
        description = buildSignatureDescription(f, toolMap);
      } else {
        description = f.description;
      }

      return {
        name: f.name,
        description,
        inputSchema: {
          type: 'object' as const,
          properties: {
            action: {
              type: 'string',
              enum: Object.keys(f.actions),
              description: 'The operation to perform',
            },
          },
          required: ['action'],
          additionalProperties: true,
        },
      };
    });
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
