// ============================================================================
// Dojo Domain Tools
// ============================================================================
// AI Feature Incubator - proposals, experiments, wishes, graduation.
// ============================================================================

import { ToolSpec } from '../types.js';
import { toolSuccess, toolError, requireFields, requireOneOf, withRunTracking, summaryGenerators } from '../shared/index.js';
import {
  createProposal,
  CreateProposalInput,
  scaffoldExperiment,
  ScaffoldExperimentInput,
  listDojo,
  ListDojoInput,
  runExperiment,
  RunExperimentInput,
  getExperimentResults,
  GetResultsInput,
  addWish,
  AddWishInput,
  listWishes,
  ListWishesInput,
  canGraduate,
  CanGraduateInput,
  readArtifact,
  ReadArtifactInput,
  isDojoError,
  ExperimentType,
  dojoListProjects,
} from '../dojo.js';

// ============================================================================
// Proposal Tools
// ============================================================================

export const dojoCreateProposalTool: ToolSpec = {
  definition: {
    name: 'dojo_create_proposal',
    description: 'Create a new Dojo proposal for a feature or capability. Automatically saves to .decibel/dojo/proposals/. AI can propose, but only humans can enable experiments. No separate file writing needed.',
    annotations: {
      title: 'Create Proposal',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'Project ID to create proposal in (e.g., "senken" or "decibel-tools-mcp")',
        },
        caller_role: {
          type: 'string',
          enum: ['human', 'mother', 'ai'],
          description: 'Role of the caller for access control (default: human)',
        },
        agent_id: {
          type: 'string',
          description: 'Identifier for the calling agent (e.g., "mother", "chatgpt") - used for audit trails',
        },
        title: {
          type: 'string',
          description: 'Proposal title (e.g., "Exchange Rate Limit Pattern Detector")',
        },
        problem: {
          type: 'string',
          description: 'The problem this proposal addresses',
        },
        hypothesis: {
          type: 'string',
          description: 'Why this solution will work',
        },
        owner: {
          type: 'string',
          enum: ['ai', 'human'],
          description: 'Who created this proposal (default: ai)',
        },
        target_module: {
          type: 'string',
          description: 'Target module: sentinel|designer|architect|oracle|tools|dojo',
        },
        scope_in: {
          type: 'array',
          items: { type: 'string' },
          description: "What's included in scope",
        },
        scope_out: {
          type: 'array',
          items: { type: 'string' },
          description: "What's explicitly NOT included",
        },
        acceptance: {
          type: 'array',
          items: { type: 'string' },
          description: 'Acceptance criteria - how we know it works',
        },
        risks: {
          type: 'array',
          items: { type: 'string' },
          description: 'What could go wrong',
        },
        follows: {
          type: 'string',
          description: 'Proposal ID this follows (for feedback loops)',
        },
        insight: {
          type: 'string',
          description: 'Insight from previous experiment that led to this proposal',
        },
        wish_id: {
          type: 'string',
          description: 'Link to existing wish (e.g., "WISH-0001"). Auto-fills problem from wish reason and marks wish as resolved.',
        },
      },
      required: ['title', 'problem', 'hypothesis'],
    },
  },
  handler: withRunTracking(
    async (args) => {
      try {
        requireFields(args, 'title', 'problem', 'hypothesis');
        const result = await createProposal(args as CreateProposalInput);
        if (isDojoError(result)) {
          return toolError(JSON.stringify(result));
        }
        return toolSuccess(result);
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    },
    {
      toolName: 'dojo_create_proposal',
      getProjectId: (args) => args.project_id as string | undefined,
      getSummary: summaryGenerators.proposal,
    }
  ),
};

export const dojoScaffoldExperimentTool: ToolSpec = {
  definition: {
    name: 'dojo_scaffold_experiment',
    description: 'Create an experiment skeleton from a proposal. Automatically creates the experiment directory at .decibel/dojo/experiments/ with manifest, entrypoint, and README. No separate file writing needed.',
    annotations: {
      title: 'Scaffold Experiment',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'Project ID containing the proposal (e.g., "senken" or "decibel-tools-mcp")',
        },
        caller_role: {
          type: 'string',
          enum: ['human', 'mother', 'ai'],
          description: 'Role of the caller for access control (default: human)',
        },
        agent_id: {
          type: 'string',
          description: 'Identifier for the calling agent (e.g., "mother", "chatgpt") - used for audit trails',
        },
        proposal_id: {
          type: 'string',
          description: 'Proposal ID (e.g., "DOJO-PROP-0001")',
        },
        script_type: {
          type: 'string',
          enum: ['py', 'ts'],
          description: 'Script type for entrypoint (default: py)',
        },
        experiment_type: {
          type: 'string',
          enum: ['script', 'tool', 'check', 'prompt'],
          description: 'Experiment type: script (default), tool (MCP tool candidate), check (validation), prompt (template)',
        },
      },
      required: ['proposal_id'],
    },
  },
  handler: withRunTracking(
    async (args) => {
      try {
        requireFields(args, 'proposal_id');
        if (args.experiment_type) {
          const validTypes: ExperimentType[] = ['script', 'tool', 'check', 'prompt'];
          requireOneOf(args.experiment_type, 'experiment_type', validTypes);
        }
        const result = await scaffoldExperiment(args as ScaffoldExperimentInput);
        if (isDojoError(result)) {
          return toolError(JSON.stringify(result));
        }
        return toolSuccess(result);
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    },
    {
      toolName: 'dojo_scaffold_experiment',
      getProjectId: (args) => args.project_id as string | undefined,
      getSummary: summaryGenerators.scaffold,
    }
  ),
};

export const dojoListTool: ToolSpec = {
  definition: {
    name: 'dojo_list',
    description: 'List Dojo proposals, experiments, and wishes with their states.',
    annotations: {
      title: 'List Dojo Items',
      readOnlyHint: true,
      destructiveHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'Project ID to list Dojo items from (e.g., "senken" or "decibel-tools-mcp")',
        },
        caller_role: {
          type: 'string',
          enum: ['human', 'mother', 'ai'],
          description: 'Role of the caller for access control (default: human)',
        },
        agent_id: {
          type: 'string',
          description: 'Identifier for the calling agent (e.g., "mother", "chatgpt") - used for audit trails',
        },
        filter: {
          type: 'string',
          enum: ['proposals', 'experiments', 'wishes', 'all'],
          description: 'Filter results (default: all)',
        },
      },
    },
  },
  handler: async (args) => {
    try {
      const result = await listDojo(args as ListDojoInput);
      if (isDojoError(result)) {
        return toolError(JSON.stringify(result));
      }
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// Experiment Tools
// ============================================================================

export const dojoRunExperimentTool: ToolSpec = {
  definition: {
    name: 'dojo_run_experiment',
    description: 'Run an experiment in SANDBOX mode. Results are written to {project}/.decibel/dojo/results/. NOTE: This always runs in sandbox mode - enabled mode is human-only via CLI.',
    annotations: {
      title: 'Run Experiment',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'Project ID containing the experiment (e.g., "senken" or "decibel-tools-mcp")',
        },
        caller_role: {
          type: 'string',
          enum: ['human', 'mother', 'ai'],
          description: 'Role of the caller for access control (default: human)',
        },
        agent_id: {
          type: 'string',
          description: 'Identifier for the calling agent (e.g., "mother", "chatgpt") - used for audit trails',
        },
        experiment_id: {
          type: 'string',
          description: 'Experiment ID (e.g., "DOJO-EXP-0001")',
        },
      },
      required: ['experiment_id'],
    },
  },
  handler: async (args) => {
    try {
      requireFields(args, 'experiment_id');
      // SAFETY: runExperiment always uses --sandbox, never --enabled
      const result = await runExperiment(args as RunExperimentInput);
      if (isDojoError(result)) {
        return toolError(JSON.stringify(result));
      }
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

export const dojoGetResultsTool: ToolSpec = {
  definition: {
    name: 'dojo_get_results',
    description: 'Get results from a previous experiment run. Use to examine what an experiment produced.',
    annotations: {
      title: 'Get Results',
      readOnlyHint: true,
      destructiveHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'Project ID containing the experiment (e.g., "senken" or "decibel-tools-mcp")',
        },
        caller_role: {
          type: 'string',
          enum: ['human', 'mother', 'ai'],
          description: 'Role of the caller for access control (default: human)',
        },
        agent_id: {
          type: 'string',
          description: 'Identifier for the calling agent (e.g., "mother", "chatgpt") - used for audit trails',
        },
        experiment_id: {
          type: 'string',
          description: 'Experiment ID (e.g., "DOJO-EXP-0001")',
        },
        run_id: {
          type: 'string',
          description: 'Specific run ID (default: latest)',
        },
      },
      required: ['experiment_id'],
    },
  },
  handler: async (args) => {
    try {
      requireFields(args, 'experiment_id');
      const result = await getExperimentResults(args as GetResultsInput);
      if (isDojoError(result)) {
        return toolError(JSON.stringify(result));
      }
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

export const dojoReadArtifactTool: ToolSpec = {
  definition: {
    name: 'dojo_read_artifact',
    description: 'Read an artifact file from experiment results. Returns parsed content for yaml/json, raw text for others, base64 for binary.',
    annotations: {
      title: 'Read Artifact',
      readOnlyHint: true,
      destructiveHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'Project ID containing the experiment (e.g., "senken" or "decibel-tools-mcp")',
        },
        caller_role: {
          type: 'string',
          enum: ['human', 'mother', 'ai'],
          description: 'Role of the caller for access control (default: human)',
        },
        agent_id: {
          type: 'string',
          description: 'Identifier for the calling agent (e.g., "mother", "chatgpt") - used for audit trails',
        },
        experiment_id: {
          type: 'string',
          description: 'Experiment ID (e.g., "DOJO-EXP-0001")',
        },
        run_id: {
          type: 'string',
          description: 'Run ID from dojo_run_experiment response (e.g., "20251216-070615")',
        },
        filename: {
          type: 'string',
          description: 'Artifact filename (e.g., "result.yaml", "plot.png")',
        },
      },
      required: ['experiment_id', 'run_id', 'filename'],
    },
  },
  handler: async (args) => {
    try {
      requireFields(args, 'experiment_id', 'run_id', 'filename');
      const result = await readArtifact(args as ReadArtifactInput);
      if (isDojoError(result)) {
        return toolError(JSON.stringify(result));
      }
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

export const dojoCanGraduateTool: ToolSpec = {
  definition: {
    name: 'dojo_can_graduate',
    description: 'Check if an experiment can be graduated to a real tool. Returns eligibility and reasons. (Actual graduation is human-only via CLI)',
    annotations: {
      title: 'Check Graduation',
      readOnlyHint: true,
      destructiveHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'Project ID containing the experiment (e.g., "senken" or "decibel-tools-mcp")',
        },
        caller_role: {
          type: 'string',
          enum: ['human', 'mother', 'ai'],
          description: 'Role of the caller for access control (default: human)',
        },
        agent_id: {
          type: 'string',
          description: 'Identifier for the calling agent (e.g., "mother", "chatgpt") - used for audit trails',
        },
        experiment_id: {
          type: 'string',
          description: 'Experiment ID (e.g., "DOJO-EXP-0001")',
        },
      },
      required: ['experiment_id'],
    },
  },
  handler: async (args) => {
    try {
      requireFields(args, 'experiment_id');
      const result = await canGraduate(args as CanGraduateInput);
      if (isDojoError(result)) {
        return toolError(JSON.stringify(result));
      }
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// Wish Tools
// ============================================================================

export const dojoAddWishTool: ToolSpec = {
  definition: {
    name: 'dojo_add_wish',
    description: 'Add a capability wish to the Dojo wishlist. Requires 4 fields: capability (what), reason (why), inputs (data needed), outputs (what it produces).',
    annotations: {
      title: 'Add Wish',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'Project ID to add wish to (e.g., "senken" or "decibel-tools-mcp")',
        },
        caller_role: {
          type: 'string',
          enum: ['human', 'mother', 'ai'],
          description: 'Role of the caller for access control (default: human)',
        },
        agent_id: {
          type: 'string',
          description: 'Identifier for the calling agent (e.g., "mother", "chatgpt") - used for audit trails',
        },
        capability: {
          type: 'string',
          description: 'What it does - the core idea (e.g., "Correlation matrix for active signals")',
        },
        reason: {
          type: 'string',
          description: 'Why it improves outcomes (e.g., "Identify when multiple trades create unintended hedging")',
        },
        inputs: {
          type: 'array',
          items: { type: 'string' },
          description: 'What data it needs (e.g., ["active_signals", "price_history_30d"])',
        },
        outputs: {
          type: ['string', 'object'],
          description: 'What it produces (e.g., {"correlation_matrix": {}, "hedging_risk_score": 0.0, "conflicts": []})',
        },
        integration_point: {
          type: 'string',
          description: 'Where it plugs in - filled during scaffold phase',
        },
        success_metric: {
          type: 'string',
          description: 'How we know it works - filled before enable phase',
        },
        risks: {
          type: 'array',
          items: { type: 'string' },
          description: 'Safety review items - filled before enable phase',
        },
        mvp: {
          type: 'string',
          description: 'Smallest viable slice - if scoping is needed',
        },
        algorithm_outline: {
          type: 'string',
          description: 'Logic outline - if the algorithm is non-obvious',
        },
        context: {
          type: 'object',
          description: 'Additional structured context about when/why this wish occurred',
        },
      },
      required: ['capability', 'reason', 'inputs', 'outputs'],
    },
  },
  handler: withRunTracking(
    async (args) => {
      try {
        requireFields(args, 'capability', 'reason');
        const result = await addWish(args as AddWishInput);
        if (isDojoError(result)) {
          return toolError(JSON.stringify(result));
        }
        return toolSuccess(result);
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    },
    {
      toolName: 'dojo_add_wish',
      getProjectId: (args) => args.project_id as string | undefined,
      getSummary: summaryGenerators.wish,
    }
  ),
};

export const dojoListWishesTool: ToolSpec = {
  definition: {
    name: 'dojo_list_wishes',
    description: 'List wishes from the Dojo wishlist. Shows what capabilities AI has requested.',
    annotations: {
      title: 'List Wishes',
      readOnlyHint: true,
      destructiveHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'Project ID to list wishes from (e.g., "senken" or "decibel-tools-mcp")',
        },
        caller_role: {
          type: 'string',
          enum: ['human', 'mother', 'ai'],
          description: 'Role of the caller for access control (default: human)',
        },
        agent_id: {
          type: 'string',
          description: 'Identifier for the calling agent (e.g., "mother", "chatgpt") - used for audit trails',
        },
        unresolved_only: {
          type: 'boolean',
          description: 'Only show unresolved wishes (default: false)',
        },
      },
    },
  },
  handler: async (args) => {
    try {
      const result = await listWishes(args as ListWishesInput);
      if (isDojoError(result)) {
        return toolError(JSON.stringify(result));
      }
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// Utility Tools
// ============================================================================

export const dojoProjectsTool: ToolSpec = {
  definition: {
    name: 'dojo_projects',
    description: 'List available projects for Dojo operations. Helps discover which projects you can use. Shows the default project if one exists.',
    annotations: {
      title: 'List Projects',
      readOnlyHint: true,
      destructiveHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  handler: async () => {
    try {
      const result = dojoListProjects();
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// Domain Export
// ============================================================================

export const dojoTools: ToolSpec[] = [
  // Proposal tools
  dojoCreateProposalTool,
  dojoScaffoldExperimentTool,
  dojoListTool,
  // Experiment tools
  dojoRunExperimentTool,
  dojoGetResultsTool,
  dojoReadArtifactTool,
  dojoCanGraduateTool,
  // Wish tools
  dojoAddWishTool,
  dojoListWishesTool,
  // Utility tools
  dojoProjectsTool,
];
