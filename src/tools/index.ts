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
import { benchTools } from './bench/index.js';
import { guardianTools } from './guardian/index.js';
import { swarmTools } from './swarm.js';
import { decibelTools } from './decibel/index.js';
import { codeReviewTools } from './codereview/index.js';
import { peersTools } from './peers.js';
import { conceptsTools } from './concepts.js';
import { conductorTools } from './conductor/index.js';
import {
  loadGraduatedTools,
  executeGraduatedTool,
  findGraduatedTool,
  graduatedToolsToMcpDefinitions,
} from './dojoGraduated.js';

// Tier gating — require explicit opt-in. See the matching note in kernel.ts:
// keying off `NODE_ENV !== 'production'` failed open on every install that
// leaves NODE_ENV unset, which is the default case.
const PRO_ENABLED = process.env.DECIBEL_PRO === '1';
const APPS_ENABLED = process.env.DECIBEL_APPS === '1';

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
  ...benchTools,
  ...guardianTools,
  ...swarmTools,
  ...decibelTools,
  ...codeReviewTools,
  ...peersTools,
  ...conceptsTools,
  ...conductorTools,
];

// App tools — Decibel internal (only when DECIBEL_APPS=1)
//
// Loaded by dynamic import with the failure tolerated, because these modules
// are not built into the published package (tsconfig.build.json excludes them).
// For a public install the import simply does not resolve and no app tools
// register — the facades are absent rather than present-and-refusing, which is
// both less confusing and a stronger guarantee than a runtime tier check.
//
// The template-literal path is deliberate: it stops TypeScript resolving these
// at compile time, so a build that excludes the sources still typechecks.
const APP_MODULES: ReadonlyArray<readonly [module: string, exportName: string]> = [
  ['deck', 'deckTools'],
  ['senken', 'senkenTools'],
  ['mother', 'motherTools'],
  ['terminal', 'terminalTools'],
];

async function loadAppTools(): Promise<ToolSpec[]> {
  if (!APPS_ENABLED) return [];

  const out: ToolSpec[] = [];
  for (const [name, exportName] of APP_MODULES) {
    try {
      const mod = (await import(`./${name}.js`)) as Record<string, unknown>;
      const tools = mod[exportName];
      if (Array.isArray(tools)) out.push(...(tools as ToolSpec[]));
    } catch {
      // Not in this build. Expected for every public install.
    }
  }
  return out;
}

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

/**
 * Convert graduated Dojo tools to ToolSpec format.
 * Graduated tools are dynamic plugins loaded from dojo/graduated/*.yaml.
 * Previously only exposed in stdio mode — now available in both transports.
 */
function loadGraduatedToolSpecs(): ToolSpec[] {
  const graduated = loadGraduatedTools();
  if (graduated.length === 0) return [];

  return graduated.map(tool => {
    const mcpDef = graduatedToolsToMcpDefinitions([tool])[0];
    return {
      definition: {
        name: mcpDef.name,
        description: mcpDef.description,
        inputSchema: mcpDef.inputSchema as ToolSpec['definition']['inputSchema'],
      },
      handler: async (args: Record<string, unknown>) => {
        const result = await executeGraduatedTool(tool, args);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          isError: !result.success,
        };
      },
    };
  });
}

// Async loader for full tool set (core + pro + graduated)
export async function getAllTools(): Promise<ToolSpec[]> {
  const proTools = await loadProTools();
  const appTools = await loadAppTools();
  const graduatedToolSpecs = loadGraduatedToolSpecs();
  return [...coreTools, ...proTools, ...appTools, ...graduatedToolSpecs];
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
