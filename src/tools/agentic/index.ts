// ============================================================================
// Agentic Domain Tools
// ============================================================================
// Tools for agentic pack compilation, rendering, linting, and testing.
// ============================================================================

import { ToolSpec } from '../types.js';
import { toolSuccess, toolError, requireFields } from '../shared/index.js';
import {
  compilePack,
  renderPayload,
  lintOutput,
  runGolden,
  CompilePackInput,
  RenderInput,
  LintInput,
  GoldenInput,
} from '../../agentic/index.js';

// ============================================================================
// Compile Pack Tool
// ============================================================================

export const agenticCompilePackTool: ToolSpec = {
  definition: {
    name: 'agentic_compile_pack',
    description: 'Compile agentic configuration files into a versioned, hashed pack. Reads from .decibel/architect/agentic/ and outputs compiled_agentic_pack.json',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Optional project identifier. Uses default project if not specified.',
        },
      },
      required: [],
    },
  },
  handler: async (args) => {
    try {
      const input = args as CompilePackInput;
      const result = await compilePack(input);
      if (result.status === 'error') {
        return toolError(JSON.stringify(result, null, 2));
      }
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// Render Payload Tool
// ============================================================================

export const agenticRenderTool: ToolSpec = {
  definition: {
    name: 'agentic_render',
    description: 'Transform a canonical payload into rendered text using a specified renderer. Pure function - no side effects.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Optional project identifier.',
        },
        payload: {
          type: 'object',
          description: 'The canonical payload to render (role, status, load, summary, evidence, missing_data, metadata)',
        },
        renderer_id: {
          type: 'string',
          description: 'ID of the renderer to use',
        },
        target: {
          type: 'string',
          enum: ['plain', 'markdown', 'ansi'],
          description: 'Output target format (default: plain)',
        },
      },
      required: ['payload', 'renderer_id'],
    },
  },
  handler: async (args) => {
    try {
      const input = args as RenderInput;
      requireFields(input, 'payload', 'renderer_id');
      const result = await renderPayload(input);
      if (result.status === 'error') {
        return toolError(JSON.stringify(result, null, 2));
      }
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// Lint Output Tool
// ============================================================================

export const agenticLintTool: ToolSpec = {
  definition: {
    name: 'agentic_lint',
    description: 'Validate rendered output against renderer constraints. Checks emoji count, banned words, line limits, and other dialect rules.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Optional project identifier.',
        },
        rendered: {
          type: 'string',
          description: 'The rendered text to lint',
        },
        renderer_id: {
          type: 'string',
          description: 'ID of the renderer whose constraints to check',
        },
        payload: {
          type: 'object',
          description: 'Original payload for consistency checks (optional)',
        },
      },
      required: ['rendered', 'renderer_id'],
    },
  },
  handler: async (args) => {
    try {
      const input = args as LintInput;
      requireFields(input, 'rendered', 'renderer_id');
      const result = await lintOutput(input);
      if (result.status === 'error') {
        return toolError(JSON.stringify(result, null, 2));
      }
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// Golden Eval Tool
// ============================================================================

export const agenticGoldenEvalTool: ToolSpec = {
  definition: {
    name: 'agentic_golden_eval',
    description: 'Run golden eval regression tests. Compares rendered outputs against known-good baseline files.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Optional project identifier.',
        },
        case_name: {
          type: 'string',
          description: 'Run only this specific test case',
        },
        strict: {
          type: 'boolean',
          description: 'Also run lint checks on all outputs',
        },
      },
      required: [],
    },
  },
  handler: async (args) => {
    try {
      const input = args as GoldenInput;
      const result = await runGolden(input);
      if (result.status === 'error') {
        return toolError(JSON.stringify(result, null, 2));
      }
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// Export All Tools
// ============================================================================

export const agenticTools: ToolSpec[] = [
  agenticCompilePackTool,
  agenticRenderTool,
  agenticLintTool,
  agenticGoldenEvalTool,
];
