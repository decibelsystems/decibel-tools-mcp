/**
 * Agentic Pack Engine - MCP Tool Registration
 *
 * Exposes the 4 core agentic tools via MCP:
 * 1. agentic.compile_pack - Compile configuration into versioned pack
 * 2. agentic.render - Transform payload to text
 * 3. agentic.lint - Validate output against constraints
 * 4. agentic.golden_eval - Run regression tests
 */

import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { compilePack } from './compiler.js';
import { renderPayload } from './renderer.js';
import { lintOutput } from './linter.js';
import { runGolden } from './golden.js';
import {
  AgentRole,
  AgentStatus,
  LoadLevel,
  MissingData,
  Evidence,
  Guardrail,
  DissentSummary,
  PayloadMetadata,
  CanonicalPayload,
  RenderTarget,
} from './types.js';

// ============================================================================
// Zod Schemas
// ============================================================================

const EvidenceSchema = z.object({
  source: z.string(),
  value: z.unknown(),
  confidence: z.number().min(0).max(1).optional(),
  timestamp: z.string().optional(),
});

const MissingDataSchema = z.object({
  field: z.string(),
  reason: z.string(),
  severity: z.enum(['blocking', 'degraded', 'informational']),
});

const GuardrailSchema = z.object({
  id: z.string(),
  description: z.string(),
  status: z.enum(['active', 'triggered', 'disabled']),
});

const DissentSummarySchema = z.object({
  agent_id: z.string(),
  position: z.string(),
  confidence: z.number().min(0).max(1),
});

const PayloadMetadataSchema = z.object({
  pack_id: z.string(),
  pack_hash: z.string(),
  renderer_id: z.string().optional(),
  specialist_id: z.string().optional(),
  created_at: z.string(),
});

const CanonicalPayloadSchema = z.object({
  role: z.enum(['Sensor', 'Analyst', 'Overmind', 'Specialist']),
  status: z.enum(['OK', 'DEGRADED', 'BLOCKED', 'ALERT']),
  load: z.enum(['GREEN', 'YELLOW', 'RED']),
  summary: z.string(),
  evidence: z.array(EvidenceSchema),
  missing_data: z.array(MissingDataSchema),
  decision: z.string().optional(),
  guardrails: z.array(GuardrailSchema).optional(),
  dissent_summary: z.array(DissentSummarySchema).optional(),
  specialist_id: z.string().optional(),
  specialist_name: z.string().optional(),
  metadata: PayloadMetadataSchema,
});

// ============================================================================
// Tool Registration
// ============================================================================

export function registerAgenticTools(server: McpServer): void {
  // Tool 1: Compile Pack
  server.tool(
    'agentic.compile_pack',
    'Compile agentic configuration files into a versioned, hashed pack. Reads from .decibel/architect/agentic/ and outputs compiled_agentic_pack.json',
    {
      projectId: z.string().optional().describe('Project identifier (optional, uses default if not specified)'),
    },
    async ({ projectId }) => {
      const result = await compilePack({ projectId });

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
        isError: result.status === 'error',
      };
    }
  );

  // Tool 2: Render Payload
  server.tool(
    'agentic.render',
    'Transform a canonical payload into rendered text using a specified renderer. Pure function - no side effects.',
    {
      projectId: z.string().optional().describe('Project identifier (optional)'),
      payload: CanonicalPayloadSchema.describe('The canonical payload to render'),
      renderer_id: z.string().describe('ID of the renderer to use'),
      target: z.enum(['plain', 'markdown', 'ansi']).optional().describe('Output target format (default: plain)'),
    },
    async ({ projectId, payload, renderer_id, target }) => {
      const result = await renderPayload({
        projectId,
        payload: payload as CanonicalPayload,
        renderer_id,
        target: target as RenderTarget | undefined,
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
        isError: result.status === 'error',
      };
    }
  );

  // Tool 3: Lint Output
  server.tool(
    'agentic.lint',
    'Validate rendered output against renderer constraints. Checks emoji count, banned words, line limits, and other dialect rules.',
    {
      projectId: z.string().optional().describe('Project identifier (optional)'),
      rendered: z.string().describe('The rendered text to lint'),
      renderer_id: z.string().describe('ID of the renderer whose constraints to check'),
      payload: CanonicalPayloadSchema.optional().describe('Original payload for consistency checks (optional)'),
    },
    async ({ projectId, rendered, renderer_id, payload }) => {
      const result = await lintOutput({
        projectId,
        rendered,
        renderer_id,
        payload: payload as CanonicalPayload | undefined,
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
        isError: result.status === 'error',
      };
    }
  );

  // Tool 4: Golden Eval
  server.tool(
    'agentic.golden_eval',
    'Run golden eval regression tests. Compares rendered outputs against known-good baseline files.',
    {
      projectId: z.string().optional().describe('Project identifier (optional)'),
      case_name: z.string().optional().describe('Run only this specific test case'),
      strict: z.boolean().optional().describe('Also run lint checks on all outputs'),
    },
    async ({ projectId, case_name, strict }) => {
      const result = await runGolden({
        projectId,
        case_name,
        strict,
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
        isError: result.status === 'error',
      };
    }
  );
}

// Re-export types and functions for direct use
export * from './types.js';
export { compilePack, loadCompiledPack, getOrCompilePack } from './compiler.js';
export { render, renderPayload } from './renderer.js';
export { lint, lintWithPack, lintOutput } from './linter.js';
export { runGoldenEval, updateGoldenFile, createGoldenCase, runGolden } from './golden.js';
