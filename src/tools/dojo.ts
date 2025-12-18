/**
 * Dojo MCP Tools - AI Feature Incubator
 *
 * Provides MCP tools for AI to:
 * - Create proposals for new features
 * - Scaffold experiments from proposals
 * - Run experiments in sandbox mode
 * - Track wishes (capabilities AI wants)
 * - View experiment results
 *
 * Safety: AI cannot enable/disable/graduate experiments.
 * Those actions are human-only via CLI.
 *
 * Project-scoped: All operations require project_id and work within {project_root}/dojo
 * Role-based: caller_role determines what operations are allowed
 */

import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import YAML from 'yaml';
import { log } from '../config.js';
import { resolveProjectRoot } from '../projectPaths.js';
import { getDefaultProject, listProjects, ProjectEntry } from '../projectRegistry.js';
import { CallerRole, enforceToolAccess, getSandboxPolicy, expandSandboxPaths } from './dojoPolicy.js';
import { checkRateLimit, recordRequestStart, recordRequestEnd } from './rateLimiter.js';

// ============================================================================
// Types
// ============================================================================

export type ExperimentType = 'script' | 'tool' | 'check' | 'prompt';

/**
 * Base input for all Dojo operations
 * project_id: Optional - identifies which project's Dojo to use (uses default if not provided)
 * caller_role: Optional - determines permissions (default: 'human')
 * agent_id: Optional - identifies the calling agent for audit trails
 */
export interface DojoBaseInput {
  project_id?: string;
  caller_role?: CallerRole;
  agent_id?: string;
}

export interface CreateProposalInput extends DojoBaseInput {
  title: string;
  problem: string;
  hypothesis: string;
  owner?: 'ai' | 'human';
  target_module?: string;
  scope_in?: string[];
  scope_out?: string[];
  acceptance?: string[];
  risks?: string[];
  follows?: string; // proposal_id this follows
  insight?: string; // insight from previous experiment
  wish_id?: string; // link to existing wish (auto-fills problem, marks wish resolved)
}

export interface CreateProposalOutput {
  proposal_id: string;
  filepath: string;
  title: string;
}

export interface ScaffoldExperimentInput extends DojoBaseInput {
  proposal_id: string;
  script_type?: 'py' | 'ts';
  experiment_type?: ExperimentType;
}

export interface ScaffoldExperimentOutput {
  experiment_id: string;
  proposal_id: string;
  directory: string;
  entrypoint: string;
  files_created: string[];
}

export interface ListDojoInput extends DojoBaseInput {
  filter?: 'proposals' | 'experiments' | 'wishes' | 'all';
}

export interface ProposalSummary {
  id: string;
  title: string;
  owner: 'ai' | 'human';
  state: 'draft' | 'has_experiment' | 'enabled';
}

export interface ExperimentSummary {
  id: string;
  proposal_id: string;
  title: string;
  type: string;
  enabled: boolean;
}

export interface WishSummary {
  id: string;
  capability: string;
  reason: string;
  resolved_by?: string;
}

export interface ListDojoOutput {
  proposals: ProposalSummary[];
  experiments: ExperimentSummary[];
  wishes: WishSummary[];
  summary: {
    total_proposals: number;
    total_experiments: number;
    total_wishes: number;
    enabled_count: number;
  };
}

export interface RunExperimentInput extends DojoBaseInput {
  experiment_id: string;
}

export interface RunExperimentOutput {
  experiment_id: string;
  run_id: string;  // canonical run ID (e.g., "20251216-070615")
  status: 'success' | 'failure';
  exit_code: number;
  duration_seconds: number;
  artifacts: string[];  // files in results dir (e.g., ["result.yaml", "plot.png"])
  stdout?: string;  // captured output
}

export interface GetResultsInput extends DojoBaseInput {
  experiment_id: string;
  run_id?: string;
}

export interface GetResultsOutput {
  experiment_id: string;
  run_id: string;
  timestamp: string;
  exit_code: number;
  artifacts: string[];  // files in results dir
  stdout?: string;
  stderr?: string;
}

export interface ReadArtifactInput extends DojoBaseInput {
  experiment_id: string;
  run_id: string;
  filename: string;  // e.g., "result.yaml", "plot.png"
}

export interface ReadArtifactOutput {
  experiment_id: string;
  run_id: string;
  filename: string;
  content_type: 'yaml' | 'json' | 'text' | 'binary';
  content: unknown;  // parsed if yaml/json, string if text, base64 if binary
}

export interface AddWishInput extends DojoBaseInput {
  // Required fields (4)
  capability: string;  // What it does - the core idea
  reason: string;      // Why it improves outcomes - justification
  inputs: string[];    // What data it needs - grounds it in reality
  outputs: Record<string, unknown> | string; // What it produces - makes it concrete

  // Optional fields (filled in as wish progresses)
  integration_point?: string;  // Where it plugs in (filled during scaffold)
  success_metric?: string;     // How we know it works (filled before enable)
  risks?: string[];            // Safety review (filled before enable)
  mvp?: string;                // Smallest viable slice (if scoping needed)
  algorithm_outline?: string;  // If logic is non-obvious

  // Legacy/convenience
  context?: Record<string, unknown>; // structured context about when/why wish occurred
}

export interface AddWishOutput {
  wish_id: string;
  capability: string;
  timestamp: string;
}

export interface ListWishesInput extends DojoBaseInput {
  unresolved_only?: boolean;
}

export interface ListWishesOutput {
  wishes: WishSummary[];
  total: number;
  unresolved: number;
}

export interface CanGraduateInput extends DojoBaseInput {
  experiment_id: string;
}

export interface CanGraduateOutput {
  experiment_id: string;
  can_graduate: boolean;
  has_tool_definition: boolean;
  is_enabled: boolean;
  reasons: string[];
}

export interface DojoError {
  error: string;
  exitCode: number;
  stderr: string;
}

// ============================================================================
// Constants
// ============================================================================

const DECIBEL_COMMAND = 'decibel';

// ============================================================================
// Helper: Resolve project Dojo root
// ============================================================================

export interface DojoContext {
  projectId: string;
  projectRoot: string;
  dojoRoot: string;
  callerRole: CallerRole;
  agentId?: string;
}

/**
 * Resolve the Dojo root for a project.
 * Returns the path to {project_root}/.decibel/dojo
 * If projectId is not provided, attempts to use the default project.
 */
export async function resolveDojoRoot(projectId?: string): Promise<{ projectId: string; projectRoot: string; dojoRoot: string }> {
  // If project_id provided, use it directly
  if (projectId) {
    const project = await resolveProjectRoot(projectId);
    const dojoRoot = path.join(project.root, '.decibel', 'dojo');
    log(`dojo: Resolved project "${projectId}" to Dojo root: ${dojoRoot}`);
    return { projectId, projectRoot: project.root, dojoRoot };
  }

  // Try to get default project
  const defaultProject = getDefaultProject();
  if (defaultProject) {
    const dojoRoot = path.join(defaultProject.path, '.decibel', 'dojo');
    log(`dojo: Using default project "${defaultProject.id}" -> Dojo root: ${dojoRoot}`);
    return { projectId: defaultProject.id, projectRoot: defaultProject.path, dojoRoot };
  }

  // No project could be resolved - provide helpful error
  const registered = listProjects();
  let errorMsg = 'No project specified and no default project could be determined.';
  if (registered.length > 0) {
    errorMsg += ` Available projects: ${registered.map(p => p.id).join(', ')}.`;
    errorMsg += ' Specify project_id or set one as default with DECIBEL_DEFAULT_PROJECT env var.';
  } else {
    errorMsg += ' No projects registered. Register a project with "decibel registry add".';
  }
  throw new Error(errorMsg);
}

/**
 * Build a full Dojo context with policy and rate limit enforcement
 */
export async function buildDojoContext(
  projectId: string | undefined,
  callerRole: CallerRole = 'human',
  toolName: string,
  agentId?: string
): Promise<DojoContext> {
  // Check rate limits first (for AI callers)
  const rateLimitResult = checkRateLimit(callerRole);
  if (!rateLimitResult.allowed) {
    throw new Error(`Rate limit: ${rateLimitResult.reason}`);
  }

  // Enforce policy
  enforceToolAccess(toolName, callerRole);

  // Record request start (for concurrent tracking)
  recordRequestStart(callerRole);

  // Resolve paths (handles default project fallback)
  const resolved = await resolveDojoRoot(projectId);

  // Audit log for AI callers
  if (callerRole !== 'human') {
    log(`dojo-audit: [${new Date().toISOString()}] agent=${agentId || 'unknown'} role=${callerRole} tool=${toolName} project=${resolved.projectId}`);
  }

  return {
    projectId: resolved.projectId,
    projectRoot: resolved.projectRoot,
    dojoRoot: resolved.dojoRoot,
    callerRole,
    agentId,
  };
}

/**
 * Mark a Dojo request as complete (call in finally block)
 */
export function finishDojoRequest(callerRole: CallerRole = 'human'): void {
  recordRequestEnd(callerRole);
}

// ============================================================================
// Helper: Execute decibel CLI command
// ============================================================================

async function execDecibel(
  args: string[],
  cwd?: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  log(`dojo: Running ${DECIBEL_COMMAND} ${args.join(' ')}${cwd ? ` (cwd: ${cwd})` : ''}`);

  return new Promise((resolve) => {
    const proc = spawn(DECIBEL_COMMAND, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
      cwd: cwd || process.cwd(),
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('error', (err) => {
      log(`dojo: Process error: ${err.message}`);
      resolve({
        stdout: '',
        stderr: err.message,
        exitCode: -1,
      });
    });

    proc.on('close', (code) => {
      resolve({
        stdout,
        stderr,
        exitCode: code ?? -1,
      });
    });
  });
}

/**
 * Strip ANSI escape codes from string
 */
function stripAnsi(str: string): string {
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
}

/**
 * Parse text output into a structured response
 * Returns the raw text if JSON parsing fails
 */
function parseTextOutput<T>(
  stdout: string,
  stderr: string,
  exitCode: number,
  fallbackParser?: (text: string) => Partial<T>
): T | DojoError {
  if (exitCode !== 0) {
    return {
      error: `Command exited with code ${exitCode}`,
      exitCode,
      stderr: stripAnsi(stderr).slice(0, 500),
    };
  }

  const cleanOutput = stripAnsi(stdout);

  // Try JSON first (in case CLI adds --json support later)
  try {
    return JSON.parse(cleanOutput) as T;
  } catch {
    // Use custom parser if provided
    if (fallbackParser) {
      try {
        return fallbackParser(cleanOutput) as T;
      } catch {
        // Fall through to raw text
      }
    }

    // Return raw text wrapped in a response object
    return {
      raw_output: cleanOutput,
      success: true,
    } as unknown as T;
  }
}

// ============================================================================
// Text Parsers for CLI output
// ============================================================================

function parseProposalOutput(text: string): Partial<CreateProposalOutput> {
  const idMatch = text.match(/ID:\s*(DOJO-PROP-\d+)/);
  const fileMatch = text.match(/File:\s*(\S+)/);
  return {
    proposal_id: idMatch?.[1] || 'unknown',
    filepath: fileMatch?.[1] || 'unknown',
    title: 'Created',
  };
}

function parseScaffoldOutput(text: string): Partial<ScaffoldExperimentOutput> {
  const idMatch = text.match(/ID:\s*(DOJO-EXP-\d+)/);
  const proposalMatch = text.match(/Proposal:\s*(DOJO-PROP-\d+)/);
  const dirMatch = text.match(/Dir:\s*(\S+)/);
  return {
    experiment_id: idMatch?.[1] || 'unknown',
    proposal_id: proposalMatch?.[1] || 'unknown',
    directory: dirMatch?.[1] || 'unknown',
    entrypoint: 'run.py',
    files_created: ['manifest.yaml', 'run.py', 'README.md'],
  };
}

function parseWishOutput(text: string): Partial<AddWishOutput> {
  const idMatch = text.match(/(WISH-\d+)/);
  return {
    wish_id: idMatch?.[1] || 'unknown',
    capability: 'Added',
    timestamp: new Date().toISOString(),
  };
}

function parseListOutput(text: string): Partial<ListDojoOutput> {
  // Count items from text output
  const proposalMatches = text.match(/DOJO-PROP-\d+/g) || [];
  const experimentMatches = text.match(/DOJO-EXP-\d+/g) || [];
  const wishMatches = text.match(/WISH-\d+/g) || [];

  return {
    proposals: proposalMatches.map((id) => ({
      id,
      title: 'See raw_output',
      owner: 'ai' as const,
      state: 'draft' as const,
    })),
    experiments: experimentMatches.map((id) => ({
      id,
      proposal_id: 'unknown',
      title: 'See raw_output',
      type: 'script',
      enabled: false,
    })),
    wishes: wishMatches.map((id) => ({
      id,
      capability: 'See raw_output',
      reason: 'See raw_output',
    })),
    summary: {
      total_proposals: proposalMatches.length,
      total_experiments: experimentMatches.length,
      total_wishes: wishMatches.length,
      enabled_count: (text.match(/● enabled/g) || []).length,
    },
  };
}

// ============================================================================
// Tool Implementations
// ============================================================================

/**
 * Create a new Dojo proposal
 */
export async function createProposal(
  input: CreateProposalInput
): Promise<CreateProposalOutput | DojoError> {
  const callerRole = input.caller_role || 'human';

  // Build context with policy enforcement
  const ctx = await buildDojoContext(
    input.project_id,
    callerRole,
    'dojo_create_proposal',
    input.agent_id
  );

  try {
    const args = [
      'dojo',
      'propose',
      '--title',
      input.title,
      '--problem',
      input.problem,
      '--hypothesis',
      input.hypothesis,
      '--owner',
      input.owner || 'ai',
    ];

    if (input.target_module) {
      args.push('--module', input.target_module);
    }

    if (input.follows) {
      args.push('--follows', input.follows);
    }

    if (input.insight) {
      args.push('--insight', input.insight);
    }

    if (input.wish_id) {
      args.push('--wish', input.wish_id);
    }

    const { stdout, stderr, exitCode } = await execDecibel(args, ctx.projectRoot);
    return parseTextOutput<CreateProposalOutput>(stdout, stderr, exitCode, parseProposalOutput);
  } finally {
    finishDojoRequest(callerRole);
  }
}

/**
 * Scaffold an experiment from a proposal
 */
export async function scaffoldExperiment(
  input: ScaffoldExperimentInput
): Promise<ScaffoldExperimentOutput | DojoError> {
  const callerRole = input.caller_role || 'human';

  // Build context with policy enforcement
  const ctx = await buildDojoContext(
    input.project_id,
    callerRole,
    'dojo_scaffold_experiment',
    input.agent_id
  );

  try {
    const args = ['dojo', 'scaffold', input.proposal_id];

    if (input.script_type) {
      args.push('--script-type', input.script_type);
    }

    if (input.experiment_type) {
      args.push('--type', input.experiment_type);
    }

    const { stdout, stderr, exitCode } = await execDecibel(args, ctx.projectRoot);
    return parseTextOutput<ScaffoldExperimentOutput>(stdout, stderr, exitCode, parseScaffoldOutput);
  } finally {
    finishDojoRequest(callerRole);
  }
}

/**
 * List proposals, experiments, and wishes
 */
export async function listDojo(input: ListDojoInput): Promise<ListDojoOutput | DojoError> {
  const callerRole = input.caller_role || 'human';

  // Build context with policy enforcement
  const ctx = await buildDojoContext(
    input.project_id,
    callerRole,
    'dojo_list',
    input.agent_id
  );

  try {
    const args = ['dojo', 'list'];

    // Note: --filter may not be supported, but we'll try
    // The CLI will ignore unknown args or error gracefully

    const { stdout, stderr, exitCode } = await execDecibel(args, ctx.projectRoot);
    return parseTextOutput<ListDojoOutput>(stdout, stderr, exitCode, parseListOutput);
  } finally {
    finishDojoRequest(callerRole);
  }
}

/**
 * Run an experiment in sandbox mode (NEVER in enabled mode)
 */
export async function runExperiment(
  input: RunExperimentInput
): Promise<RunExperimentOutput | DojoError> {
  const callerRole = input.caller_role || 'human';

  // Build context with policy enforcement
  const ctx = await buildDojoContext(
    input.project_id,
    callerRole,
    'dojo_run_experiment',
    input.agent_id
  );

  try {
    // Get sandbox policy for the caller
    const sandbox = getSandboxPolicy(ctx.callerRole);
    expandSandboxPaths(sandbox, ctx.dojoRoot);

    // SAFETY: Always use --sandbox, never expose --enabled
    const args = ['dojo', 'run', input.experiment_id, '--sandbox'];

    const { stdout, stderr, exitCode } = await execDecibel(args, ctx.projectRoot);

    // Parse the output
    const cleanOutput = stripAnsi(stdout);

    // Try to extract key information
    const durationMatch = cleanOutput.match(/Duration:\s*([\d.]+)s/);
    const successMatch = cleanOutput.match(/✓|completed successfully/i);

    // Extract run_id from output (format: YYYYMMDD-HHMMSS)
    const runIdMatch = cleanOutput.match(/(\d{8}-\d{6})/);
    const runId = runIdMatch?.[1] || new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15).replace(/(\d{8})(\d{6})/, '$1-$2');

    // Scan results directory for artifacts
    const resultsDir = path.join(ctx.dojoRoot, 'results', input.experiment_id, runId);
    let artifacts: string[] = [];
    try {
      const files = await fs.readdir(resultsDir);
      artifacts = files.filter(f => !f.startsWith('.'));
    } catch {
      // Results dir may not exist yet
      log(`dojo: Could not read results dir: ${resultsDir}`);
    }

    return {
      experiment_id: input.experiment_id,
      run_id: runId,
      status: exitCode === 0 && successMatch ? 'success' : 'failure',
      exit_code: exitCode,
      duration_seconds: durationMatch ? parseFloat(durationMatch[1]) : 0,
      artifacts,
      stdout: cleanOutput,
    };
  } finally {
    finishDojoRequest(callerRole);
  }
}

/**
 * Get results from a previous experiment run
 */
export async function getExperimentResults(
  input: GetResultsInput
): Promise<GetResultsOutput | DojoError> {
  const callerRole = input.caller_role || 'human';

  // Build context with policy enforcement
  const ctx = await buildDojoContext(
    input.project_id,
    callerRole,
    'dojo_get_results',
    input.agent_id
  );

  try {
    const args = ['dojo', 'results', input.experiment_id];

    if (input.run_id) {
      args.push('--run', input.run_id);
    }

    const { stdout, stderr, exitCode } = await execDecibel(args, ctx.projectRoot);
    const cleanOutput = stripAnsi(stdout);

    if (exitCode !== 0) {
      return {
        error: `Command exited with code ${exitCode}`,
        exitCode,
        stderr: stripAnsi(stderr).slice(0, 500),
      };
    }

    // Parse run info from output
    const runMatch = cleanOutput.match(/(\d{8}-\d{6})/);
    const runId = input.run_id || runMatch?.[1] || 'latest';

    // Scan results directory for artifacts
    const resultsDir = path.join(ctx.dojoRoot, 'results', input.experiment_id, runId);
    let artifacts: string[] = [];
    try {
      const files = await fs.readdir(resultsDir);
      artifacts = files.filter(f => !f.startsWith('.'));
    } catch {
      log(`dojo: Could not read results dir: ${resultsDir}`);
    }

    return {
      experiment_id: input.experiment_id,
      run_id: runId,
      timestamp: new Date().toISOString(),
      exit_code: 0,
      artifacts,
      stdout: cleanOutput,
    };
  } finally {
    finishDojoRequest(callerRole);
  }
}

/**
 * Add a wish to the wishlist
 */
export async function addWish(input: AddWishInput): Promise<AddWishOutput | DojoError> {
  const callerRole = input.caller_role || 'human';

  // Build context with policy enforcement
  const ctx = await buildDojoContext(
    input.project_id,
    callerRole,
    'dojo_add_wish',
    input.agent_id
  );

  try {
    const args = ['dojo', 'wish', input.capability, '--reason', input.reason];

    // Required fields: inputs and outputs
    if (input.inputs && input.inputs.length > 0) {
      args.push('--inputs', JSON.stringify(input.inputs));
    }

    if (input.outputs) {
      const outputsStr = typeof input.outputs === 'string'
        ? input.outputs
        : JSON.stringify(input.outputs);
      args.push('--outputs', outputsStr);
    }

    // Optional fields (filled in as wish progresses)
    if (input.integration_point) {
      args.push('--integration-point', input.integration_point);
    }

    if (input.success_metric) {
      args.push('--success-metric', input.success_metric);
    }

    if (input.risks && input.risks.length > 0) {
      args.push('--risks', JSON.stringify(input.risks));
    }

    if (input.mvp) {
      args.push('--mvp', input.mvp);
    }

    if (input.algorithm_outline) {
      args.push('--algorithm', input.algorithm_outline);
    }

    // Legacy context field
    if (input.context) {
      args.push('--context', JSON.stringify(input.context));
    }

    const { stdout, stderr, exitCode } = await execDecibel(args, ctx.projectRoot);
    return parseTextOutput<AddWishOutput>(stdout, stderr, exitCode, parseWishOutput);
  } finally {
    finishDojoRequest(callerRole);
  }
}

/**
 * List wishes
 */
export async function listWishes(input: ListWishesInput): Promise<ListWishesOutput | DojoError> {
  const callerRole = input.caller_role || 'human';

  // Build context with policy enforcement
  const ctx = await buildDojoContext(
    input.project_id,
    callerRole,
    'dojo_list_wishes',
    input.agent_id
  );

  try {
    const args = ['dojo', 'wishes'];

    if (input.unresolved_only) {
      args.push('--unresolved');
    }

    const { stdout, stderr, exitCode } = await execDecibel(args, ctx.projectRoot);
    const cleanOutput = stripAnsi(stdout);

    if (exitCode !== 0) {
      return {
        error: `Command exited with code ${exitCode}`,
        exitCode,
        stderr: stripAnsi(stderr).slice(0, 500),
      };
    }

    // Parse wishes from output
    const wishMatches = cleanOutput.match(/WISH-\d+/g) || [];

    return {
      wishes: wishMatches.map((id) => ({
        id,
        capability: 'See raw output',
        reason: 'See raw output',
      })),
      total: wishMatches.length,
      unresolved: wishMatches.length,
    };
  } finally {
    finishDojoRequest(callerRole);
  }
}

/**
 * Check if an experiment can be graduated (read-only)
 */
export async function canGraduate(
  input: CanGraduateInput
): Promise<CanGraduateOutput | DojoError> {
  const callerRole = input.caller_role || 'human';

  // Build context with policy enforcement
  const ctx = await buildDojoContext(
    input.project_id,
    callerRole,
    'dojo_can_graduate',
    input.agent_id
  );

  try {
    // Use 'status' command since 'can-graduate' doesn't exist
    const args = ['dojo', 'status', input.experiment_id];

    const { stdout, stderr, exitCode } = await execDecibel(args, ctx.projectRoot);
    const cleanOutput = stripAnsi(stdout);

    if (exitCode !== 0) {
      // If status fails, the experiment might not exist
      return {
        error: `Could not check graduation status: ${stripAnsi(stderr).slice(0, 200)}`,
        exitCode,
        stderr: stripAnsi(stderr).slice(0, 500),
      };
    }

    // Parse status to determine graduation eligibility
    const isEnabled = cleanOutput.includes('● enabled');
    const hasToolDef = cleanOutput.includes('type: tool') || cleanOutput.includes('[tool]');

    return {
      experiment_id: input.experiment_id,
      can_graduate: isEnabled && hasToolDef,
      has_tool_definition: hasToolDef,
      is_enabled: isEnabled,
      reasons: [
        isEnabled ? 'Experiment is enabled' : 'Experiment not enabled yet',
        hasToolDef ? 'Has tool definition' : 'No tool definition (type != tool)',
      ],
    };
  } finally {
    finishDojoRequest(callerRole);
  }
}

/**
 * Read an artifact file from experiment results
 * Returns parsed content for yaml/json, raw text for others
 */
export async function readArtifact(
  input: ReadArtifactInput
): Promise<ReadArtifactOutput | DojoError> {
  const callerRole = input.caller_role || 'human';

  // Build context with policy enforcement
  const ctx = await buildDojoContext(
    input.project_id,
    callerRole,
    'dojo_read_artifact',
    input.agent_id
  );

  try {
    // Validate filename (no path traversal)
    if (input.filename.includes('/') || input.filename.includes('..')) {
      return {
        error: 'Invalid filename: path traversal not allowed',
        exitCode: 1,
        stderr: 'Filename must be a simple filename without path separators',
      };
    }

    // Build path to artifact
    const artifactPath = path.join(
      ctx.dojoRoot,
      'results',
      input.experiment_id,
      input.run_id,
      input.filename
    );

    // Check file exists
    try {
      await fs.access(artifactPath);
    } catch {
      return {
        error: `Artifact not found: ${input.filename}`,
        exitCode: 1,
        stderr: `File does not exist: ${artifactPath}`,
      };
    }

    // Determine content type from extension
    const ext = path.extname(input.filename).toLowerCase();
    let contentType: 'yaml' | 'json' | 'text' | 'binary';
    let content: unknown;

    if (ext === '.yaml' || ext === '.yml') {
      contentType = 'yaml';
      const raw = await fs.readFile(artifactPath, 'utf-8');
      try {
        content = YAML.parse(raw);
      } catch {
        content = raw; // Return raw if parsing fails
      }
    } else if (ext === '.json') {
      contentType = 'json';
      const raw = await fs.readFile(artifactPath, 'utf-8');
      try {
        content = JSON.parse(raw);
      } catch {
        content = raw;
      }
    } else if (['.txt', '.log', '.md', '.py', '.ts', '.js'].includes(ext)) {
      contentType = 'text';
      content = await fs.readFile(artifactPath, 'utf-8');
    } else {
      // Binary files (images, etc.) - return base64
      contentType = 'binary';
      const buffer = await fs.readFile(artifactPath);
      content = buffer.toString('base64');
    }

    return {
      experiment_id: input.experiment_id,
      run_id: input.run_id,
      filename: input.filename,
      content_type: contentType,
      content,
    };
  } finally {
    finishDojoRequest(callerRole);
  }
}

/**
 * Type guard for DojoError
 */
export function isDojoError(result: unknown): result is DojoError {
  return (
    typeof result === 'object' &&
    result !== null &&
    'error' in result &&
    'exitCode' in result
  );
}

// ============================================================================
// Project Discovery Tool
// ============================================================================

export interface ListProjectsOutput {
  projects: {
    id: string;
    name?: string;
    path: string;
    aliases?: string[];
    isDefault: boolean;
  }[];
  defaultProject?: string;
  hint: string;
}

/**
 * List all available projects for Dojo operations.
 * Helps AI callers discover what projects they can use.
 */
export function dojoListProjects(): ListProjectsOutput {
  const registered = listProjects();
  const defaultProject = getDefaultProject();

  const projects = registered.map((p) => ({
    id: p.id,
    name: p.name,
    path: p.path,
    aliases: p.aliases,
    isDefault: p.default === true || p.id === defaultProject?.id,
  }));

  // If there's a discovered project not in registry, add it
  if (defaultProject && !registered.find((p) => p.id === defaultProject.id)) {
    projects.push({
      id: defaultProject.id,
      name: undefined,
      path: defaultProject.path,
      aliases: undefined,
      isDefault: true,
    });
  }

  return {
    projects,
    defaultProject: defaultProject?.id,
    hint: defaultProject
      ? `Default project: "${defaultProject.id}". You can omit project_id to use it.`
      : 'No default project. Specify project_id in your requests.',
  };
}
