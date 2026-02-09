// ============================================================================
// Lateral Thinking Tools — MCP Tool Definitions
// ============================================================================
// Three tools for structured lateral thinking sessions.
// ============================================================================

import { ToolSpec } from '../types.js';
import { toolSuccess, toolError, requireFields, withRunTracking, summaryGenerators } from '../shared/index.js';
import {
  startSession,
  type StartSessionInput,
  applyTechnique,
  type ApplyTechniqueInput,
  closeSession,
  type CloseSessionInput,
  VALID_TECHNIQUES,
  VALID_HATS,
} from '../lateral.js';

// ============================================================================
// Helper: Normalize project_id → projectId
// ============================================================================

function normalizeProjectId(args: Record<string, unknown>): void {
  if (!args.projectId && args.project_id) {
    args.projectId = args.project_id;
  }
}

// ============================================================================
// designer_lateral_session — Start or resume
// ============================================================================

export const designerLateralSessionTool: ToolSpec = {
  definition: {
    name: 'designer_lateral_session',
    description:
      'Start or resume a lateral thinking session. Provides structured scaffolding for creative exploration using de Bono\'s methods (Six Hats, Provocation, Random Entry, Challenge, Alternatives, Reversal). Sessions persist as YAML artifacts in .decibel/designer/lateral/.',
    annotations: {
      title: 'Lateral Thinking Session',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'Optional project identifier. Uses default project if not specified.',
        },
        session_id: {
          type: 'string',
          description: 'Resume an existing session by ID (e.g. LAT-20260209T143022).',
        },
        problem: {
          type: 'string',
          description: 'The design problem or challenge to explore. Required for new sessions.',
        },
        context: {
          type: 'string',
          description: 'Optional context about the problem (constraints, prior work, stakeholders).',
        },
      },
    },
  },
  handler: withRunTracking(
    async (args) => {
      try {
        const rawInput = args as Record<string, unknown>;
        normalizeProjectId(rawInput);
        const input = rawInput as unknown as StartSessionInput;

        const result = await startSession(input);
        return toolSuccess(result);
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    },
    {
      toolName: 'designer_lateral_session',
      getProjectId: (args) => (args.projectId as string | undefined) || (args.project_id as string | undefined),
      getSummary: summaryGenerators.lateralSession,
    }
  ),
};

// ============================================================================
// designer_lateral_apply — Apply a technique
// ============================================================================

export const designerLateralApplyTool: ToolSpec = {
  definition: {
    name: 'designer_lateral_apply',
    description:
      'Apply a lateral thinking technique to an open session. Returns structured guidance on what to do next. Techniques: six_hats (parallel thinking), provocation (Po statements), random_entry (forced associations), challenge (question assumptions), alternatives (concept fan), reversal (flip the problem).',
    annotations: {
      title: 'Apply Lateral Technique',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'Optional project identifier.',
        },
        session_id: {
          type: 'string',
          description: 'The session ID to apply the technique to.',
        },
        technique: {
          type: 'string',
          enum: VALID_TECHNIQUES,
          description: 'The lateral thinking technique to apply.',
        },
        input: {
          type: 'object',
          description:
            'Technique-specific input. six_hats: {hat, thinking}. provocation: {po_statement, movement, insights[]}. random_entry: {stimulus?, connections[], promising_leads[]}. challenge: {assumption, why_exists, what_if_false, alternative_framing}. alternatives: {focus, concept_level, alternatives[{idea, approach}]}. reversal: {original, reversed, insights_from_reversal[]}.',
        },
      },
      required: ['session_id', 'technique', 'input'],
    },
  },
  handler: async (args) => {
    try {
      const rawInput = args as Record<string, unknown>;
      normalizeProjectId(rawInput);
      const input = rawInput as unknown as ApplyTechniqueInput;

      requireFields(input, 'session_id', 'technique', 'input');

      if (!VALID_TECHNIQUES.includes(input.technique)) {
        throw new Error(`Invalid technique. Must be one of: ${VALID_TECHNIQUES.join(', ')}`);
      }

      const result = await applyTechnique(input);
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// designer_lateral_close — Synthesize and close
// ============================================================================

export const designerLateralCloseTool: ToolSpec = {
  definition: {
    name: 'designer_lateral_close',
    description:
      'Synthesize insights and close a lateral thinking session. Generates a readable markdown summary and emits a provenance event. The summary groups entries by technique with full context.',
    annotations: {
      title: 'Close Lateral Session',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'Optional project identifier.',
        },
        session_id: {
          type: 'string',
          description: 'The session ID to close.',
        },
        synthesis: {
          type: 'string',
          description: 'Your synthesis of the session — key insights, conclusions, and recommended direction.',
        },
        action_items: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional list of concrete next steps arising from the session.',
        },
        link_to: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional artifact references to link (e.g. ADR IDs, design decision files, issue IDs).',
        },
      },
      required: ['session_id', 'synthesis'],
    },
  },
  handler: withRunTracking(
    async (args) => {
      try {
        const rawInput = args as Record<string, unknown>;
        normalizeProjectId(rawInput);
        const input = rawInput as unknown as CloseSessionInput;

        requireFields(input, 'session_id', 'synthesis');

        const result = await closeSession(input);
        return toolSuccess(result);
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    },
    {
      toolName: 'designer_lateral_close',
      getProjectId: (args) => (args.projectId as string | undefined) || (args.project_id as string | undefined),
      getSummary: summaryGenerators.lateralSession,
    }
  ),
};

// ============================================================================
// Export All Lateral Tools
// ============================================================================

export const lateralTools: ToolSpec[] = [
  designerLateralSessionTool,
  designerLateralApplyTool,
  designerLateralCloseTool,
];
