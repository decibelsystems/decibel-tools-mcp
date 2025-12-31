// ============================================================================
// Tools Aggregator
// ============================================================================
// Central registry of all modular tools.
// Domains are added here as they are migrated from server.ts.
// ============================================================================

import { ToolSpec } from './types.js';
import { registryTools } from './registry/index.js';
import { sentinelTools } from './sentinel/index.js';
import { dojoTools } from './dojo/index.js';
import { provenanceTools } from './provenance/index.js';
import { oracleTools } from './oracle/index.js';
import { learningsTools } from './learnings/index.js';
import { frictionTools } from './friction/index.js';
import { designerTools } from './designer/index.js';
import { voiceTools } from './voice/index.js';
import { contextTools } from './context/index.js';
import { agenticTools } from './agentic/index.js';
import { roadmapTools } from './roadmap/index.js';
import { architectTools } from './architect/index.js';

// ============================================================================
// Aggregate All Tools
// ============================================================================

export const modularTools: ToolSpec[] = [
  ...registryTools,
  ...sentinelTools,
  ...dojoTools,
  ...provenanceTools,
  ...oracleTools,
  ...learningsTools,
  ...frictionTools,
  ...designerTools,
  ...voiceTools,
  ...contextTools,
  ...agenticTools,
  ...roadmapTools,
  ...architectTools,
];

// ============================================================================
// Tool Map for Fast Lookup
// ============================================================================

export const modularToolMap = new Map(
  modularTools.map(t => [t.definition.name, t])
);

// ============================================================================
// Helper to get tool names (for debugging)
// ============================================================================

export function getModularToolNames(): string[] {
  return modularTools.map(t => t.definition.name);
}
