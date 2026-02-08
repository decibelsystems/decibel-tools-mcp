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
import { contextTools } from './context/index.js';
import { agenticTools } from './agentic/index.js';
import { roadmapTools } from './roadmap/index.js';
import { architectTools } from './architect/index.js';
import { deckTools } from './deck.js';
import { gitTools } from './git/index.js';
import { auditorTools } from './auditor/index.js';
import { workflowTools } from './workflow/index.js';
import { gitSentinelTools } from './git-sentinel/index.js';
import { velocityTools } from './velocity/index.js';
import { vectorTools } from './vector/index.js';
import { hygieneTools } from './hygiene/index.js';
import { feedbackTools } from './feedback/index.js';
import { forecastTools } from './forecast/index.js';
import { coordinatorTools } from './coordinator/index.js';

// Pro tier tools (require DECIBEL_PRO=1 in production, always enabled in dev)
const PRO_ENABLED = process.env.DECIBEL_PRO === '1' || process.env.NODE_ENV !== 'production';

// ============================================================================
// Aggregate All Tools
// ============================================================================

// Core tools (always included)
const coreTools: ToolSpec[] = [
  ...registryTools,
  ...sentinelTools,
  ...dojoTools,
  ...provenanceTools,
  ...oracleTools,
  ...learningsTools,
  ...frictionTools,
  ...designerTools,
  ...contextTools,
  ...agenticTools,
  ...roadmapTools,
  ...architectTools,
  ...deckTools,
  ...gitTools,
  ...auditorTools,
  ...workflowTools,
  ...gitSentinelTools,
  ...velocityTools,
  ...vectorTools,
  ...hygieneTools,
  ...feedbackTools,
  ...forecastTools,
  ...coordinatorTools,
];

// Pro tools (only when DECIBEL_PRO=1)
async function loadProTools(): Promise<ToolSpec[]> {
  if (!PRO_ENABLED) return [];

  const [
    { voiceTools },
    { studioTools },
    { corpusTools },
  ] = await Promise.all([
    import('./voice/index.js'),
    import('./studio/index.js'),
    import('./corpus/index.js'),
  ]);

  return [...voiceTools, ...studioTools, ...corpusTools];
}

// Export sync version for backward compat (pro tools loaded async)
export const modularTools: ToolSpec[] = coreTools;

// Async loader for full tool set
export async function getAllTools(): Promise<ToolSpec[]> {
  const proTools = await loadProTools();
  return [...coreTools, ...proTools];
}

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
