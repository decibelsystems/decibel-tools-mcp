// ============================================================================
// Agentic Domain Tools
// ============================================================================
// Tools for agentic pack compilation, rendering, linting, and testing.
// ============================================================================

import { ToolSpec } from '../types.js';
import { toolSuccess, toolError, requireFields, withRunTracking } from '../shared/index.js';
import {
  compilePack,
  renderPayload,
  lintOutput,
  runGolden,
  CompilePackInput,
  RenderInput,
  LintInput,
  GoldenInput,
  validateCanonicalPayload,
} from '../../agentic/index.js';
import {
  agentQueueSync,
  agentQueueStatus,
  AgentQueueSyncInput,
  AgentQueueStatusInput,
} from './agentQueue.js';
import {
  enqueueJob,
  listJobs,
  cancelJob,
  EnqueueJobInput,
  CancelJobInput,
} from '../../agenticJobs.js';
import { resolveProjectPaths } from '../../projectRegistry.js';

// ============================================================================
// Compile Pack Tool
// ============================================================================

export const agenticCompilePackTool: ToolSpec = {
  definition: {
    name: 'agentic_compile_pack',
    description: 'Compile agentic configuration files into a versioned, hashed pack. Reads from .decibel/architect/agentic/ and outputs compiled_agentic_pack.json',
    annotations: {
      title: 'Compile Agentic Pack',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
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
    annotations: {
      title: 'Render Payload',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
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

      // Shape, not just presence. requireFields only proved `payload` was
      // there; it let role "NotARealRole", load "PURPLE" and confidence 47
      // through to the renderer, which happily produced output and returned a
      // success envelope. The renderer is a view over the canonical payload, so
      // an invalid payload is not something to render — it is something to
      // refuse. See validateCanonicalPayload in agentic/types.ts.
      const payloadErrors = validateCanonicalPayload(input.payload);
      if (payloadErrors.length > 0) {
        return toolError(
          `Invalid canonical payload:\n  ${payloadErrors.join('\n  ')}`
        );
      }

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
    annotations: {
      title: 'Lint Output',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
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

      // payload is optional here — it is only used for consistency checks — so
      // absence is fine and malformedness is not. Validating an absent payload
      // would break the documented contract of this tool.
      if (input.payload !== undefined) {
        const payloadErrors = validateCanonicalPayload(input.payload);
        if (payloadErrors.length > 0) {
          return toolError(
            `Invalid canonical payload:\n  ${payloadErrors.join('\n  ')}`
          );
        }
      }

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
    annotations: {
      title: 'Run Golden Eval',
      readOnlyHint: true,
      destructiveHint: false,
    },
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
// Agent Queue Sync Tool
// ============================================================================

export const agenticQueueSyncTool: ToolSpec = {
  definition: {
    name: 'agentic_queue_sync',
    description: 'Sync queued agent writes from Supabase to local .decibel/ files. Replays each queued tool call through the kernel, records results and provenance.',
    annotations: {
      title: 'Sync Agent Queue',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project identifier. Uses default project if not specified.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of queued items to sync (default: 50)',
        },
        facadeFilter: {
          type: 'string',
          description: 'Only sync items for this facade (e.g. "sentinel", "friction")',
        },
      },
      required: [],
    },
  },
  handler: async (args) => {
    try {
      const input = args as AgentQueueSyncInput;
      const result = await agentQueueSync(input);
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// Agent Queue Status Tool
// ============================================================================

export const agenticQueueStatusTool: ToolSpec = {
  definition: {
    name: 'agentic_queue_status',
    description: 'Check the status of a queued agent write. Returns pending, synced (with result), or error.',
    annotations: {
      title: 'Check Queue Status',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        queueId: {
          type: 'string',
          description: 'The UUID of the queued item (returned when the item was queued)',
        },
      },
      required: ['queueId'],
    },
  },
  handler: async (args) => {
    try {
      const input = args as AgentQueueStatusInput;
      if (!input.queueId) {
        return toolError('Missing required field: queueId');
      }
      const result = await agentQueueStatus(input);
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// Dispatch / Job Queue Tools
// ============================================================================
// User-queued prompts that agents execute against the project. See
// docs/AGENTIC_DISPATCH.md in the HQ repo for the 3-layer contract.
// Distinct from queue_sync / queue_status above — those manage the agent-
// pack-sync state machine; these manage user-dispatched job prompts.
// ============================================================================

export const agenticEnqueueTool: ToolSpec = {
  definition: {
    name: 'agentic_enqueue',
    description: 'Enqueue a prompt for an agent (Claude Code, Codex, etc.) to execute against the project. Writes a YAML job file to .decibel/agentic/jobs/JOB-NNNN.yml. Agents poll via agentic.list_queue and claim jobs by editing the file. Returns the job id and queue position.',
    annotations: {
      title: 'Enqueue Agentic Job',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project identifier the agent should run against. Uses default project if not specified.',
        },
        prompt: {
          type: 'string',
          description: 'The instruction the agent should execute. Written as if typed to the agent directly.',
        },
        createdBy: {
          type: 'string',
          description: 'Optional identifier of the user/actor that dispatched. Recorded for audit.',
        },
      },
      required: ['prompt'],
    },
  },
  handler: withRunTracking(
    async (args: Record<string, unknown>) => {
      try {
        requireFields(args, 'prompt');
        const input = args as { projectId?: string; prompt: string; createdBy?: string };
        const projectId = resolveProjectPaths(input.projectId).id;
        const enqueueInput: EnqueueJobInput = {
          projectId,
          prompt: input.prompt,
          createdBy: input.createdBy,
        };
        const result = await enqueueJob(enqueueInput);
        return toolSuccess({
          job_id: result.jobId,
          queue_position: result.queuePosition,
          file_path: result.filePath,
          project_id: projectId,
        });
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    },
    {
      toolName: 'agentic_enqueue',
      getSummary: (args, result) => {
        const r = result as { job_id?: string };
        const prompt = (args.prompt as string) || '';
        const preview = prompt.length > 60 ? `${prompt.slice(0, 60)}…` : prompt;
        return `Enqueued ${r.job_id || 'job'}: ${preview}`;
      },
    },
  ),
};

export const agenticListQueueTool: ToolSpec = {
  definition: {
    name: 'agentic_list_queue',
    description: 'List dispatched jobs for a project — both active (queued/claimed/running) and terminal (done/cancelled/failed). Sorted oldest-first. Returns empty array if no jobs.',
    annotations: {
      title: 'List Agentic Queue',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
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
      const input = args as { projectId?: string };
      const projectId = resolveProjectPaths(input.projectId).id;
      const jobs = await listJobs(projectId);
      return toolSuccess({ jobs, count: jobs.length, project_id: projectId });
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

export const agenticCancelJobTool: ToolSpec = {
  definition: {
    name: 'agentic_cancel_job',
    description: 'Cancel a queued or claimed dispatch job. No-op for already-terminal jobs (done / cancelled / failed). Returns the updated job state.',
    annotations: {
      title: 'Cancel Agentic Job',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Optional project identifier. Uses default project if not specified.',
        },
        jobId: {
          type: 'string',
          description: 'The job id to cancel (e.g. "JOB-0007").',
        },
        job_id: {
          type: 'string',
          description: 'Snake-case alias for jobId.',
        },
      },
      required: [],
    },
  },
  handler: withRunTracking(
    async (args: Record<string, unknown>) => {
      try {
        const input = args as { projectId?: string; jobId?: string; job_id?: string };
        const projectId = resolveProjectPaths(input.projectId).id;
        const jobId = input.jobId ?? input.job_id;
        if (!jobId) return toolError('Missing required field: jobId');

        const cancelInput: CancelJobInput = { projectId, jobId };
        const job = await cancelJob(cancelInput);
        return toolSuccess(job);
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    },
    {
      toolName: 'agentic_cancel_job',
      getSummary: (args, result) => {
        const r = result as { id?: string; status?: string };
        return `Cancelled ${r.id || args.jobId || args.job_id || 'job'} → ${r.status || 'cancelled'}`;
      },
    },
  ),
};

// ============================================================================
// Export All Tools
// ============================================================================

export const agenticTools: ToolSpec[] = [
  agenticCompilePackTool,
  agenticRenderTool,
  agenticLintTool,
  agenticGoldenEvalTool,
  agenticQueueSyncTool,
  agenticQueueStatusTool,
  agenticEnqueueTool,
  agenticListQueueTool,
  agenticCancelJobTool,
];
