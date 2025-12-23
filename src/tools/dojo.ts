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
import { ensureDir } from '../dataRoot.js';
import { resolveProjectRoot } from '../projectPaths.js';
import { getDefaultProject, listProjects, ProjectEntry } from '../projectRegistry.js';
import { CallerRole, enforceToolAccess, getSandboxPolicy, expandSandboxPaths } from './dojoPolicy.js';
import { emitCreateProvenance } from './provenance.js';
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
// ID Generation Helpers (for native file operations)
// ============================================================================

/**
 * Get the next sequential ID for a given prefix by scanning directory
 * @param dir Directory to scan
 * @param prefix ID prefix (e.g., 'WISH', 'DOJO-PROP', 'DOJO-EXP')
 * @param extension File extension (default: '.yaml')
 */
async function getNextSequentialId(
  dir: string,
  prefix: string,
  extension: string = '.yaml'
): Promise<string> {
  try {
    const files = await fs.readdir(dir);
    const pattern = new RegExp(`^${prefix}-(\\d+)${extension.replace('.', '\\.')}$`);
    const ids = files
      .map(f => {
        const match = f.match(pattern);
        return match ? parseInt(match[1], 10) : NaN;
      })
      .filter(n => !isNaN(n));
    const maxId = ids.length > 0 ? Math.max(...ids) : 0;
    return `${prefix}-${String(maxId + 1).padStart(4, '0')}`;
  } catch {
    return `${prefix}-0001`;
  }
}

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
// Tool Implementations
// ============================================================================

/**
 * Create a new Dojo proposal (native file operations)
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
    const timestamp = new Date().toISOString();
    const proposalDir = path.join(ctx.dojoRoot, 'proposals');
    ensureDir(proposalDir);

    // Generate next sequential proposal ID
    const proposalId = await getNextSequentialId(proposalDir, 'DOJO-PROP');
    const proposalPath = path.join(proposalDir, `${proposalId}.yaml`);

    // Build proposal data structure
    const proposalData: Record<string, unknown> = {
      id: proposalId,
      title: input.title,
      problem: input.problem,
      hypothesis: input.hypothesis,
      owner: input.owner || 'ai',
      state: 'draft',
      created_at: timestamp,
      project_id: ctx.projectId,
    };

    // Optional fields
    if (input.target_module) {
      proposalData.target_module = input.target_module;
    }
    if (input.scope_in && input.scope_in.length > 0) {
      proposalData.scope_in = input.scope_in;
    }
    if (input.scope_out && input.scope_out.length > 0) {
      proposalData.scope_out = input.scope_out;
    }
    if (input.acceptance && input.acceptance.length > 0) {
      proposalData.acceptance = input.acceptance;
    }
    if (input.risks && input.risks.length > 0) {
      proposalData.risks = input.risks;
    }
    if (input.follows) {
      proposalData.follows = input.follows;
    }
    if (input.insight) {
      proposalData.insight = input.insight;
    }
    if (input.wish_id) {
      proposalData.wish_id = input.wish_id;
      // Mark wish as resolved if it exists
      const wishPath = path.join(ctx.dojoRoot, 'wishes', `${input.wish_id}.yaml`);
      try {
        const wishContent = await fs.readFile(wishPath, 'utf-8');
        const wishData = YAML.parse(wishContent);
        wishData.status = 'resolved';
        wishData.resolved_by = proposalId;
        wishData.resolved_at = timestamp;
        await fs.writeFile(wishPath, YAML.stringify(wishData), 'utf-8');
        log(`dojo: Marked wish ${input.wish_id} as resolved by ${proposalId}`);
      } catch {
        // Wish doesn't exist or can't be updated - continue anyway
        log(`dojo: Could not update wish ${input.wish_id}`);
      }
    }

    // Write YAML file
    await fs.writeFile(proposalPath, YAML.stringify(proposalData), 'utf-8');
    log(`dojo: Created proposal ${proposalId} at ${proposalPath}`);

    // Emit provenance
    await emitCreateProvenance(
      `dojo:proposal:${proposalId}`,
      YAML.stringify(proposalData),
      `Created proposal: ${input.title}`,
      ctx.projectId
    );

    return {
      proposal_id: proposalId,
      filepath: proposalPath,
      title: input.title,
    };
  } finally {
    finishDojoRequest(callerRole);
  }
}

/**
 * Scaffold an experiment from a proposal (native file operations)
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
    const timestamp = new Date().toISOString();
    const scriptType = input.script_type || 'py';
    const experimentType = input.experiment_type || 'script';

    // Read proposal to get info
    const proposalPath = path.join(ctx.dojoRoot, 'proposals', `${input.proposal_id}.yaml`);
    let proposalData: Record<string, unknown>;
    try {
      const proposalContent = await fs.readFile(proposalPath, 'utf-8');
      proposalData = YAML.parse(proposalContent);
    } catch {
      return {
        error: `Proposal not found: ${input.proposal_id}`,
        exitCode: 1,
        stderr: `Could not read proposal file: ${proposalPath}`,
      };
    }

    // Generate experiment directory
    const experimentsDir = path.join(ctx.dojoRoot, 'experiments');
    const experimentId = await getNextSequentialId(experimentsDir, 'DOJO-EXP', '');
    const experimentDir = path.join(experimentsDir, experimentId);
    ensureDir(experimentDir);

    // Create manifest.yaml
    const manifestData = {
      id: experimentId,
      proposal_id: input.proposal_id,
      title: proposalData.title || 'Untitled Experiment',
      type: experimentType,
      script_type: scriptType,
      enabled: false,
      created_at: timestamp,
      project_id: ctx.projectId,
    };
    const manifestPath = path.join(experimentDir, 'manifest.yaml');
    await fs.writeFile(manifestPath, YAML.stringify(manifestData), 'utf-8');

    // Create run script
    const entrypoint = scriptType === 'ts' ? 'run.ts' : 'run.py';
    const scriptPath = path.join(experimentDir, entrypoint);
    const scriptContent = scriptType === 'ts'
      ? `#!/usr/bin/env npx ts-node
/**
 * Experiment: ${experimentId}
 * Proposal: ${input.proposal_id}
 * Title: ${proposalData.title || 'Untitled'}
 */

async function main() {
  console.log('Running experiment ${experimentId}...');

  // TODO: Implement experiment logic

  console.log('Experiment complete.');
}

main().catch(console.error);
`
      : `#!/usr/bin/env python3
"""
Experiment: ${experimentId}
Proposal: ${input.proposal_id}
Title: ${proposalData.title || 'Untitled'}
"""

def main():
    print(f"Running experiment ${experimentId}...")

    # TODO: Implement experiment logic

    print("Experiment complete.")

if __name__ == "__main__":
    main()
`;
    await fs.writeFile(scriptPath, scriptContent, 'utf-8');

    // Create README.md
    const readmePath = path.join(experimentDir, 'README.md');
    const readmeContent = `# ${experimentId}: ${proposalData.title || 'Untitled'}

## Proposal
${input.proposal_id}

## Problem
${proposalData.problem || 'N/A'}

## Hypothesis
${proposalData.hypothesis || 'N/A'}

## Running
\`\`\`bash
${scriptType === 'ts' ? 'npx ts-node run.ts' : 'python3 run.py'}
\`\`\`

## Results
Results will be written to \`.decibel/dojo/results/${experimentId}/\`
`;
    await fs.writeFile(readmePath, readmeContent, 'utf-8');

    // Update proposal state
    proposalData.state = 'has_experiment';
    proposalData.experiment_id = experimentId;
    await fs.writeFile(proposalPath, YAML.stringify(proposalData), 'utf-8');

    const filesCreated = ['manifest.yaml', entrypoint, 'README.md'];
    log(`dojo: Scaffolded experiment ${experimentId} at ${experimentDir}`);

    // Emit provenance
    await emitCreateProvenance(
      `dojo:experiment:${experimentId}`,
      YAML.stringify(manifestData),
      `Scaffolded experiment from ${input.proposal_id}`,
      ctx.projectId
    );

    return {
      experiment_id: experimentId,
      proposal_id: input.proposal_id,
      directory: experimentDir,
      entrypoint,
      files_created: filesCreated,
    };
  } finally {
    finishDojoRequest(callerRole);
  }
}

/**
 * List proposals, experiments, and wishes (native file operations)
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
    const filter = input.filter || 'all';
    const proposals: ProposalSummary[] = [];
    const experiments: ExperimentSummary[] = [];
    const wishes: WishSummary[] = [];
    let enabledCount = 0;

    // Read proposals
    if (filter === 'all' || filter === 'proposals') {
      const proposalDir = path.join(ctx.dojoRoot, 'proposals');
      try {
        const files = await fs.readdir(proposalDir);
        for (const file of files) {
          if (!file.endsWith('.yaml')) continue;
          try {
            const content = await fs.readFile(path.join(proposalDir, file), 'utf-8');
            const data = YAML.parse(content);
            proposals.push({
              id: data.id || file.replace('.yaml', ''),
              title: data.title || 'Untitled',
              owner: data.owner || 'ai',
              state: data.state || 'draft',
            });
          } catch {
            // Skip malformed files
          }
        }
      } catch {
        // Directory doesn't exist
      }
    }

    // Read experiments
    if (filter === 'all' || filter === 'experiments') {
      const experimentsDir = path.join(ctx.dojoRoot, 'experiments');
      try {
        const dirs = await fs.readdir(experimentsDir);
        for (const dir of dirs) {
          const manifestPath = path.join(experimentsDir, dir, 'manifest.yaml');
          try {
            const content = await fs.readFile(manifestPath, 'utf-8');
            const data = YAML.parse(content);
            const isEnabled = data.enabled === true;
            if (isEnabled) enabledCount++;
            experiments.push({
              id: data.id || dir,
              proposal_id: data.proposal_id || 'unknown',
              title: data.title || 'Untitled',
              type: data.type || 'script',
              enabled: isEnabled,
            });
          } catch {
            // Skip directories without manifest
          }
        }
      } catch {
        // Directory doesn't exist
      }
    }

    // Read wishes
    if (filter === 'all' || filter === 'wishes') {
      const wishDir = path.join(ctx.dojoRoot, 'wishes');
      try {
        const files = await fs.readdir(wishDir);
        for (const file of files) {
          if (!file.endsWith('.yaml')) continue;
          try {
            const content = await fs.readFile(path.join(wishDir, file), 'utf-8');
            const data = YAML.parse(content);
            wishes.push({
              id: data.id || file.replace('.yaml', ''),
              capability: data.capability || 'Unknown',
              reason: data.reason || 'Unknown',
              resolved_by: data.resolved_by,
            });
          } catch {
            // Skip malformed files
          }
        }
      } catch {
        // Directory doesn't exist
      }
    }

    return {
      proposals,
      experiments,
      wishes,
      summary: {
        total_proposals: proposals.length,
        total_experiments: experiments.length,
        total_wishes: wishes.length,
        enabled_count: enabledCount,
      },
    };
  } finally {
    finishDojoRequest(callerRole);
  }
}

/**
 * Run an experiment in sandbox mode (native file operations)
 * Note: This still uses spawn() to run the experiment script, but not the CLI
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

    // Read experiment manifest
    const experimentDir = path.join(ctx.dojoRoot, 'experiments', input.experiment_id);
    const manifestPath = path.join(experimentDir, 'manifest.yaml');
    let manifestData: Record<string, unknown>;
    try {
      const content = await fs.readFile(manifestPath, 'utf-8');
      manifestData = YAML.parse(content);
    } catch {
      return {
        error: `Experiment not found: ${input.experiment_id}`,
        exitCode: 1,
        stderr: `Could not read manifest: ${manifestPath}`,
      };
    }

    // Determine entrypoint and runner
    const scriptType = manifestData.script_type || 'py';
    const entrypoint = scriptType === 'ts' ? 'run.ts' : 'run.py';
    const scriptPath = path.join(experimentDir, entrypoint);

    // Check script exists
    try {
      await fs.access(scriptPath);
    } catch {
      return {
        error: `Experiment script not found: ${entrypoint}`,
        exitCode: 1,
        stderr: `Script does not exist: ${scriptPath}`,
      };
    }

    // Generate run ID
    const now = new Date();
    const runId = now.toISOString().replace(/[-:]/g, '').slice(0, 15).replace('T', '-');

    // Create results directory
    const resultsDir = path.join(ctx.dojoRoot, 'results', input.experiment_id, runId);
    ensureDir(resultsDir);

    const startTime = Date.now();

    // Run the experiment script
    const runner = scriptType === 'ts' ? 'npx' : 'python3';
    const runnerArgs = scriptType === 'ts' ? ['ts-node', entrypoint] : [entrypoint];

    const { stdout, exitCode } = await new Promise<{ stdout: string; exitCode: number }>((resolve) => {
      const proc = spawn(runner, runnerArgs, {
        cwd: experimentDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          DOJO_RESULTS_DIR: resultsDir,
          DOJO_EXPERIMENT_ID: input.experiment_id,
          DOJO_RUN_ID: runId,
        },
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
        log(`dojo: Experiment run error: ${err.message}`);
        resolve({ stdout: stderr || err.message, exitCode: -1 });
      });

      proc.on('close', (code) => {
        resolve({ stdout: stdout + stderr, exitCode: code ?? -1 });
      });
    });

    const endTime = Date.now();
    const durationSeconds = (endTime - startTime) / 1000;

    // Write result metadata
    const resultMeta = {
      experiment_id: input.experiment_id,
      run_id: runId,
      exit_code: exitCode,
      duration_seconds: durationSeconds,
      timestamp: now.toISOString(),
      status: exitCode === 0 ? 'success' : 'failure',
    };
    await fs.writeFile(
      path.join(resultsDir, 'result.yaml'),
      YAML.stringify(resultMeta),
      'utf-8'
    );

    // Save stdout
    if (stdout) {
      await fs.writeFile(path.join(resultsDir, 'stdout.log'), stdout, 'utf-8');
    }

    // Scan results directory for artifacts
    let artifacts: string[] = [];
    try {
      const files = await fs.readdir(resultsDir);
      artifacts = files.filter(f => !f.startsWith('.'));
    } catch {
      log(`dojo: Could not read results dir: ${resultsDir}`);
    }

    log(`dojo: Experiment ${input.experiment_id} run ${runId} completed with exit code ${exitCode}`);

    return {
      experiment_id: input.experiment_id,
      run_id: runId,
      status: exitCode === 0 ? 'success' : 'failure',
      exit_code: exitCode,
      duration_seconds: durationSeconds,
      artifacts,
      stdout,
    };
  } finally {
    finishDojoRequest(callerRole);
  }
}

/**
 * Get results from a previous experiment run (native file operations)
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
    const experimentResultsDir = path.join(ctx.dojoRoot, 'results', input.experiment_id);

    // Get run ID - either specified, or find latest
    let runId = input.run_id;
    if (!runId) {
      // Find the latest run by listing directories and sorting
      try {
        const runs = await fs.readdir(experimentResultsDir);
        const sortedRuns = runs.filter(r => !r.startsWith('.')).sort().reverse();
        if (sortedRuns.length === 0) {
          return {
            error: `No runs found for experiment: ${input.experiment_id}`,
            exitCode: 1,
            stderr: 'No result directories found',
          };
        }
        runId = sortedRuns[0];
      } catch {
        return {
          error: `No results found for experiment: ${input.experiment_id}`,
          exitCode: 1,
          stderr: `Results directory does not exist: ${experimentResultsDir}`,
        };
      }
    }

    const resultsDir = path.join(experimentResultsDir, runId);

    // Read result metadata
    let resultMeta: Record<string, unknown> = {};
    let stdout = '';
    let stderr = '';
    try {
      const resultPath = path.join(resultsDir, 'result.yaml');
      const content = await fs.readFile(resultPath, 'utf-8');
      resultMeta = YAML.parse(content);
    } catch {
      // No result.yaml, try to infer from files
    }

    // Try to read stdout log
    try {
      stdout = await fs.readFile(path.join(resultsDir, 'stdout.log'), 'utf-8');
    } catch {
      // No stdout log
    }

    // Try to read stderr log
    try {
      stderr = await fs.readFile(path.join(resultsDir, 'stderr.log'), 'utf-8');
    } catch {
      // No stderr log
    }

    // Scan results directory for artifacts
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
      timestamp: (resultMeta.timestamp as string) || new Date().toISOString(),
      exit_code: (resultMeta.exit_code as number) ?? 0,
      artifacts,
      stdout: stdout || undefined,
      stderr: stderr || undefined,
    };
  } finally {
    finishDojoRequest(callerRole);
  }
}

/**
 * Add a wish to the wishlist (native file operations)
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
    const timestamp = new Date().toISOString();
    const wishDir = path.join(ctx.dojoRoot, 'wishes');
    ensureDir(wishDir);

    // Generate next sequential wish ID
    const wishId = await getNextSequentialId(wishDir, 'WISH');
    const wishPath = path.join(wishDir, `${wishId}.yaml`);

    // Build wish data structure
    const wishData: Record<string, unknown> = {
      id: wishId,
      capability: input.capability,
      reason: input.reason,
      inputs: input.inputs || [],
      outputs: input.outputs || {},
      created_at: timestamp,
      status: 'open',
      project_id: ctx.projectId,
    };

    // Optional fields
    if (input.integration_point) {
      wishData.integration_point = input.integration_point;
    }
    if (input.success_metric) {
      wishData.success_metric = input.success_metric;
    }
    if (input.risks && input.risks.length > 0) {
      wishData.risks = input.risks;
    }
    if (input.mvp) {
      wishData.mvp = input.mvp;
    }
    if (input.algorithm_outline) {
      wishData.algorithm_outline = input.algorithm_outline;
    }
    if (input.context) {
      wishData.context = input.context;
    }

    // Write YAML file
    await fs.writeFile(wishPath, YAML.stringify(wishData), 'utf-8');
    log(`dojo: Created wish ${wishId} at ${wishPath}`);

    // Emit provenance
    await emitCreateProvenance(
      `dojo:wish:${wishId}`,
      YAML.stringify(wishData),
      `Created wish: ${input.capability}`,
      ctx.projectId
    );

    return {
      wish_id: wishId,
      capability: input.capability,
      timestamp,
    };
  } finally {
    finishDojoRequest(callerRole);
  }
}

/**
 * List wishes (native file operations)
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
    const wishDir = path.join(ctx.dojoRoot, 'wishes');
    const wishes: WishSummary[] = [];
    let unresolvedCount = 0;

    try {
      const files = await fs.readdir(wishDir);
      for (const file of files) {
        if (!file.endsWith('.yaml')) continue;

        const wishPath = path.join(wishDir, file);
        try {
          const content = await fs.readFile(wishPath, 'utf-8');
          const data = YAML.parse(content);

          const isResolved = data.status === 'resolved' || !!data.resolved_by;

          // Apply filter
          if (input.unresolved_only && isResolved) continue;

          if (!isResolved) unresolvedCount++;

          wishes.push({
            id: data.id || file.replace('.yaml', ''),
            capability: data.capability || 'Unknown',
            reason: data.reason || 'Unknown',
            resolved_by: data.resolved_by,
          });
        } catch {
          // Skip malformed files
          log(`dojo: Could not parse wish file: ${wishPath}`);
        }
      }
    } catch {
      // Directory doesn't exist yet - return empty
    }

    return {
      wishes,
      total: wishes.length,
      unresolved: unresolvedCount,
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
    // Read experiment manifest to check graduation eligibility
    const manifestPath = path.join(ctx.dojoRoot, 'experiments', input.experiment_id, 'manifest.yaml');
    let manifestData: Record<string, unknown>;
    try {
      const content = await fs.readFile(manifestPath, 'utf-8');
      manifestData = YAML.parse(content);
    } catch {
      return {
        error: `Experiment not found: ${input.experiment_id}`,
        exitCode: 1,
        stderr: `Could not read manifest: ${manifestPath}`,
      };
    }

    // Check graduation criteria
    const isEnabled = manifestData.enabled === true;
    const hasToolDef = manifestData.type === 'tool';

    // Check if there are successful runs
    let hasSuccessfulRun = false;
    const resultsDir = path.join(ctx.dojoRoot, 'results', input.experiment_id);
    try {
      const runs = await fs.readdir(resultsDir);
      for (const run of runs) {
        const resultPath = path.join(resultsDir, run, 'result.yaml');
        try {
          const resultContent = await fs.readFile(resultPath, 'utf-8');
          const resultData = YAML.parse(resultContent);
          if (resultData.exit_code === 0 || resultData.status === 'success') {
            hasSuccessfulRun = true;
            break;
          }
        } catch {
          // Skip runs without result files
        }
      }
    } catch {
      // No results directory
    }

    const reasons: string[] = [];
    reasons.push(isEnabled ? 'Experiment is enabled' : 'Experiment not enabled yet');
    reasons.push(hasToolDef ? 'Has tool definition' : 'No tool definition (type != tool)');
    reasons.push(hasSuccessfulRun ? 'Has at least one successful run' : 'No successful runs yet');

    return {
      experiment_id: input.experiment_id,
      can_graduate: isEnabled && hasToolDef && hasSuccessfulRun,
      has_tool_definition: hasToolDef,
      is_enabled: isEnabled,
      reasons,
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
