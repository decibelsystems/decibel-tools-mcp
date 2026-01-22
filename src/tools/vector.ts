// ============================================================================
// Vector Domain Logic
// ============================================================================
// Core implementation for Vector (AI session tracking and analysis).
// Manages runs, events, and inference scoring.
// ============================================================================

import fs from 'fs/promises';
import path from 'path';
import { resolveProjectPaths } from '../projectRegistry.js';
import { log } from '../config.js';

// ============================================================================
// Types
// ============================================================================

/** Supported AI coding agent types */
export type AgentType = 'claude-code' | 'cursor' | 'replit' | 'chatgpt' | 'custom';

/** Information about the AI agent generating events */
export interface AgentInfo {
  type: AgentType;
  version?: string;
}

/** All possible event types */
export type EventType =
  | 'prompt_received'
  | 'plan_proposed'
  | 'assumption_made'
  | 'clarifying_question'
  | 'command_ran'
  | 'file_touched'
  | 'test_result'
  | 'backtrack'
  | 'error'
  | 'user_correction'
  | 'run_completed';

/** Base event structure */
export interface BaseEvent {
  ts: string;
  run_id: string;
  agent: AgentInfo;
  type: EventType;
}

/** Full event with type-specific payload */
export interface VectorEvent extends BaseEvent {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: Record<string, any>;
}

/** Intent specification from prompt analysis */
export interface PromptIntent {
  goal?: string;
  scope?: string[];
  non_goals?: string[];
  constraints?: string[];
  acceptance?: string[];
  risk_posture?: 'safe' | 'moderate' | 'aggressive';
}

/** Prompt specification stored with each run */
export interface PromptSpec {
  run_id: string;
  agent: AgentInfo;
  raw_prompt: string;
  intent?: PromptIntent;
  anchors?: {
    adrs?: string[];
    memento_packs?: string[];
  };
  created_at: string;
}

/** Run summary information */
export interface RunInfo {
  run_id: string;
  agent: AgentInfo;
  created_at: string;
  completed_at?: string;
  event_count: number;
  success?: boolean;
  summary?: string;
}

/** Inference load score breakdown */
export interface ScoreBreakdown {
  nonGoals?: number;
  acceptance?: number;
  constraints?: number;
  scopeBounds?: number;
  ambiguousVerbs?: number;
  undefinedNouns?: number;
  unguardedRiskAreas?: number;
}

/** Suggestion for reducing inference load */
export interface Suggestion {
  type: 'add_non_goals' | 'add_acceptance' | 'add_constraints' | 'add_scope' | 'clarify_verbs' | 'bind_nouns' | 'guard_risk';
  message: string;
  priority: 'high' | 'medium' | 'low';
}

/** Complete inference score result */
export interface InferenceScore {
  score: number;
  breakdown: ScoreBreakdown;
  suggestions: Suggestion[];
  risk_level: 'low' | 'medium' | 'high' | 'critical';
}

// ============================================================================
// Input Types
// ============================================================================

export interface CreateRunInput {
  projectId?: string;
  project_id?: string;
  agent: AgentInfo;
  raw_prompt: string;
  intent?: PromptIntent;
}

export interface LogEventInput {
  projectId?: string;
  project_id?: string;
  run_id: string;
  type: EventType;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: Record<string, any>;
}

export interface CompleteRunInput {
  projectId?: string;
  project_id?: string;
  run_id: string;
  success: boolean;
  summary?: string;
}

export interface ListRunsInput {
  projectId?: string;
  project_id?: string;
  limit?: number;
  agent_type?: AgentType;
}

export interface GetRunInput {
  projectId?: string;
  project_id?: string;
  run_id: string;
  include_events?: boolean;
}

export interface ScorePromptInput {
  prompt: string;
  projectId?: string;
  project_id?: string;
}

// ============================================================================
// Constants
// ============================================================================

const VALID_AGENT_TYPES: AgentType[] = ['claude-code', 'cursor', 'replit', 'chatgpt', 'custom'];

/** Path to global hook events log */
const GLOBAL_EVENTS_PATH = path.join(process.env.HOME || '~', '.decibel', 'events.jsonl');

/** How far back to look for hook events (ms) */
const HOOK_EVENT_LOOKBACK_MS = 5 * 60 * 1000; // 5 minutes
const VALID_EVENT_TYPES: EventType[] = [
  'prompt_received', 'plan_proposed', 'assumption_made', 'clarifying_question',
  'command_ran', 'file_touched', 'test_result', 'backtrack', 'error',
  'user_correction', 'run_completed'
];

// Inference scoring constants
const MISSING_NON_GOALS_POINTS = 15;
const MISSING_ACCEPTANCE_POINTS = 15;
const MISSING_CONSTRAINTS_POINTS = 10;
const MISSING_SCOPE_BOUNDS_POINTS = 10;
const AMBIGUOUS_VERBS_POINTS = 10;
const UNDEFINED_NOUN_POINTS = 5;
const UNGUARDED_RISK_AREA_POINTS = 10;
const MAX_SCORE = 100;

// Detection patterns
const AMBIGUOUS_VERBS = ['refactor', 'clean up', 'cleanup', 'improve', 'optimize', 'fix', 'update', 'enhance'];
const RISK_AREAS = ['database', 'db', 'auth', 'authentication', 'payment', 'migration', 'security', 'password', 'credential', 'secret'];

// ============================================================================
// Helpers
// ============================================================================

function generateRunId(): string {
  const now = new Date();
  return `RUN-${now.toISOString().replace(/[:.]/g, '-')}`;
}

function getRunsDir(projectId?: string): string {
  const resolved = resolveProjectPaths(projectId);
  return resolved.subPath('runs');
}

async function ensureDir(dir: string): Promise<void> {
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (err) {
    // Ignore if exists
    const error = err as NodeJS.ErrnoException;
    if (error.code !== 'EEXIST') throw err;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/** Hook event from global events.jsonl */
interface HookEvent {
  ts: string;
  tool: string;
  project: string;
  cwd: string;
}

/**
 * Map hook tool names to Vector event types
 */
function mapToolToEventType(tool: string): EventType {
  const toolLower = tool.toLowerCase();
  if (toolLower === 'edit' || toolLower === 'write' || toolLower === 'notebookedit') {
    return 'file_touched';
  }
  if (toolLower === 'bash') {
    return 'command_ran';
  }
  // Default to file_touched for unknown tools
  return 'file_touched';
}

/**
 * Import recent hook events from global events.jsonl
 * Filters by project name and recency (last 5 minutes by default)
 */
async function importHookEvents(
  projectName: string,
  agent: AgentInfo,
  run_id: string,
  lookbackMs: number = HOOK_EVENT_LOOKBACK_MS
): Promise<VectorEvent[]> {
  const events: VectorEvent[] = [];

  if (!await fileExists(GLOBAL_EVENTS_PATH)) {
    log(`Vector: No global events file at ${GLOBAL_EVENTS_PATH}`);
    return events;
  }

  try {
    const content = await fs.readFile(GLOBAL_EVENTS_PATH, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    const cutoffTime = Date.now() - lookbackMs;

    for (const line of lines) {
      try {
        const hookEvent = JSON.parse(line) as HookEvent;

        // Filter by project
        if (hookEvent.project !== projectName) {
          continue;
        }

        // Filter by recency
        const eventTime = new Date(hookEvent.ts).getTime();
        if (eventTime < cutoffTime) {
          continue;
        }

        // Convert to VectorEvent
        const vectorEvent: VectorEvent = {
          ts: hookEvent.ts,
          run_id,
          agent,
          type: mapToolToEventType(hookEvent.tool),
          payload: {
            tool: hookEvent.tool,
            cwd: hookEvent.cwd,
            source: 'hook_import',
          },
        };

        events.push(vectorEvent);
      } catch {
        // Skip malformed lines
      }
    }

    log(`Vector: Imported ${events.length} hook events for project ${projectName}`);
  } catch (err) {
    log(`Vector: Error reading global events: ${err}`);
  }

  return events;
}

// ============================================================================
// Run Management
// ============================================================================

/**
 * Create a new run for an agent session
 */
export async function createRun(input: CreateRunInput): Promise<{ run_id: string; path: string; imported_events?: number }> {
  const projectId = input.projectId || input.project_id;
  const resolved = resolveProjectPaths(projectId);
  const runsDir = resolved.subPath('runs');

  // Get project name for hook event matching
  const projectName = path.basename(resolved.projectPath);

  // Validate agent type
  if (!VALID_AGENT_TYPES.includes(input.agent.type)) {
    throw new Error(`Invalid agent type: ${input.agent.type}. Must be one of: ${VALID_AGENT_TYPES.join(', ')}`);
  }

  const run_id = generateRunId();
  const runDir = path.join(runsDir, run_id);

  await ensureDir(runDir);

  // Create prompt.json
  const promptSpec: PromptSpec = {
    run_id,
    agent: input.agent,
    raw_prompt: input.raw_prompt,
    intent: input.intent,
    created_at: new Date().toISOString(),
  };

  await fs.writeFile(
    path.join(runDir, 'prompt.json'),
    JSON.stringify(promptSpec, null, 2)
  );

  // Initialize events.jsonl (empty)
  await fs.writeFile(path.join(runDir, 'events.jsonl'), '');

  // Log initial prompt_received event
  const initialEvent: VectorEvent = {
    ts: new Date().toISOString(),
    run_id,
    agent: input.agent,
    type: 'prompt_received',
    payload: { prompt: input.raw_prompt },
  };

  await fs.appendFile(
    path.join(runDir, 'events.jsonl'),
    JSON.stringify(initialEvent) + '\n'
  );

  // Import recent hook events from global events.jsonl (Option D reconciliation)
  const hookEvents = await importHookEvents(projectName, input.agent, run_id);
  if (hookEvents.length > 0) {
    const eventsPath = path.join(runDir, 'events.jsonl');
    for (const event of hookEvents) {
      await fs.appendFile(eventsPath, JSON.stringify(event) + '\n');
    }
  }

  log(`Vector: Created run ${run_id} (imported ${hookEvents.length} hook events)`);

  return {
    run_id,
    path: runDir,
    imported_events: hookEvents.length > 0 ? hookEvents.length : undefined,
  };
}

/**
 * Log an event to an existing run
 */
export async function logEvent(input: LogEventInput): Promise<{ success: true; event_count: number }> {
  const projectId = input.projectId || input.project_id;
  const runsDir = getRunsDir(projectId);
  const runDir = path.join(runsDir, input.run_id);

  // Validate run exists
  if (!await fileExists(runDir)) {
    throw new Error(`Run not found: ${input.run_id}`);
  }

  // Validate event type
  if (!VALID_EVENT_TYPES.includes(input.type)) {
    throw new Error(`Invalid event type: ${input.type}. Must be one of: ${VALID_EVENT_TYPES.join(', ')}`);
  }

  // Read prompt.json to get agent info
  const promptPath = path.join(runDir, 'prompt.json');
  const promptContent = await fs.readFile(promptPath, 'utf-8');
  const promptSpec = JSON.parse(promptContent) as PromptSpec;

  // Create event
  const event: VectorEvent = {
    ts: new Date().toISOString(),
    run_id: input.run_id,
    agent: promptSpec.agent,
    type: input.type,
    payload: input.payload,
  };

  // Append to events.jsonl
  const eventsPath = path.join(runDir, 'events.jsonl');
  await fs.appendFile(eventsPath, JSON.stringify(event) + '\n');

  // Count events
  const eventsContent = await fs.readFile(eventsPath, 'utf-8');
  const eventCount = eventsContent.trim().split('\n').filter(Boolean).length;

  log(`Vector: Logged ${input.type} event to ${input.run_id}`);

  return { success: true, event_count: eventCount };
}

/**
 * Complete a run with summary
 */
export async function completeRun(input: CompleteRunInput): Promise<{ success: true; run_id: string }> {
  const projectId = input.projectId || input.project_id;
  const runsDir = getRunsDir(projectId);
  const runDir = path.join(runsDir, input.run_id);

  // Validate run exists
  if (!await fileExists(runDir)) {
    throw new Error(`Run not found: ${input.run_id}`);
  }

  // Read prompt.json to get agent info
  const promptPath = path.join(runDir, 'prompt.json');
  const promptContent = await fs.readFile(promptPath, 'utf-8');
  const promptSpec = JSON.parse(promptContent) as PromptSpec;

  // Log run_completed event
  const completedEvent: VectorEvent = {
    ts: new Date().toISOString(),
    run_id: input.run_id,
    agent: promptSpec.agent,
    type: 'run_completed',
    payload: {
      success: input.success,
      summary: input.summary,
    },
  };

  const eventsPath = path.join(runDir, 'events.jsonl');
  await fs.appendFile(eventsPath, JSON.stringify(completedEvent) + '\n');

  // Create summary.md
  const summaryContent = `# Run Summary: ${input.run_id}

**Agent**: ${promptSpec.agent.type}${promptSpec.agent.version ? ` v${promptSpec.agent.version}` : ''}
**Started**: ${promptSpec.created_at}
**Completed**: ${completedEvent.ts}
**Status**: ${input.success ? 'Success' : 'Failed'}

## Original Prompt

\`\`\`
${promptSpec.raw_prompt}
\`\`\`

## Summary

${input.summary || 'No summary provided.'}
`;

  await fs.writeFile(path.join(runDir, 'summary.md'), summaryContent);

  log(`Vector: Completed run ${input.run_id}`);

  return { success: true, run_id: input.run_id };
}

/**
 * List runs for a project
 */
export async function listRuns(input: ListRunsInput): Promise<{ runs: RunInfo[] }> {
  const projectId = input.projectId || input.project_id;
  const runsDir = getRunsDir(projectId);

  // Ensure runs dir exists
  await ensureDir(runsDir);

  const entries = await fs.readdir(runsDir, { withFileTypes: true });
  const runDirs = entries
    .filter(e => e.isDirectory() && e.name.startsWith('RUN-'))
    .map(e => e.name);

  // Sort by run ID (which includes timestamp)
  runDirs.sort().reverse();

  const limit = input.limit || 20;
  const runs: RunInfo[] = [];

  for (const run_id of runDirs.slice(0, limit)) {
    try {
      const runDir = path.join(runsDir, run_id);
      const promptPath = path.join(runDir, 'prompt.json');
      const eventsPath = path.join(runDir, 'events.jsonl');

      if (!await fileExists(promptPath)) continue;

      const promptContent = await fs.readFile(promptPath, 'utf-8');
      const promptSpec = JSON.parse(promptContent) as PromptSpec;

      // Filter by agent type if specified
      if (input.agent_type && promptSpec.agent.type !== input.agent_type) {
        continue;
      }

      // Count events and check for completion
      let eventCount = 0;
      let completed_at: string | undefined;
      let success: boolean | undefined;
      let summary: string | undefined;

      if (await fileExists(eventsPath)) {
        const eventsContent = await fs.readFile(eventsPath, 'utf-8');
        const lines = eventsContent.trim().split('\n').filter(Boolean);
        eventCount = lines.length;

        // Check last event for completion
        if (lines.length > 0) {
          const lastEvent = JSON.parse(lines[lines.length - 1]) as VectorEvent;
          if (lastEvent.type === 'run_completed') {
            completed_at = lastEvent.ts;
            success = lastEvent.payload?.success;
            summary = lastEvent.payload?.summary;
          }
        }
      }

      runs.push({
        run_id,
        agent: promptSpec.agent,
        created_at: promptSpec.created_at,
        completed_at,
        event_count: eventCount,
        success,
        summary,
      });
    } catch (err) {
      log(`Vector: Error reading run ${run_id}: ${err}`);
    }
  }

  return { runs };
}

/**
 * Get details of a specific run
 */
export async function getRun(input: GetRunInput): Promise<{
  prompt: PromptSpec;
  events?: VectorEvent[];
  event_count: number;
  completed: boolean;
}> {
  const projectId = input.projectId || input.project_id;
  const runsDir = getRunsDir(projectId);
  const runDir = path.join(runsDir, input.run_id);

  // Validate run exists
  if (!await fileExists(runDir)) {
    throw new Error(`Run not found: ${input.run_id}`);
  }

  // Read prompt
  const promptPath = path.join(runDir, 'prompt.json');
  const promptContent = await fs.readFile(promptPath, 'utf-8');
  const prompt = JSON.parse(promptContent) as PromptSpec;

  // Read events
  const eventsPath = path.join(runDir, 'events.jsonl');
  let events: VectorEvent[] = [];
  let completed = false;

  if (await fileExists(eventsPath)) {
    const eventsContent = await fs.readFile(eventsPath, 'utf-8');
    const lines = eventsContent.trim().split('\n').filter(Boolean);
    events = lines.map(line => JSON.parse(line) as VectorEvent);

    // Check if completed
    if (events.length > 0 && events[events.length - 1].type === 'run_completed') {
      completed = true;
    }
  }

  const result: {
    prompt: PromptSpec;
    events?: VectorEvent[];
    event_count: number;
    completed: boolean;
  } = {
    prompt,
    event_count: events.length,
    completed,
  };

  if (input.include_events) {
    result.events = events;
  }

  return result;
}

// ============================================================================
// Inference Scoring
// ============================================================================

/**
 * Calculate inference load score for a prompt
 */
export function scorePrompt(input: ScorePromptInput): InferenceScore {
  const prompt = input.prompt.toLowerCase();
  const breakdown: ScoreBreakdown = {};
  let totalScore = 0;
  const suggestions: Suggestion[] = [];

  // Check for non-goals
  if (!prompt.includes('non-goal') && !prompt.includes('do not') && !prompt.includes("don't") && !prompt.includes('avoid')) {
    breakdown.nonGoals = MISSING_NON_GOALS_POINTS;
    totalScore += MISSING_NON_GOALS_POINTS;
    suggestions.push({
      type: 'add_non_goals',
      message: 'Add explicit non-goals to prevent scope creep (e.g., "Do NOT refactor unrelated code")',
      priority: 'high',
    });
  }

  // Check for acceptance criteria
  if (!prompt.includes('accept') && !prompt.includes('success') && !prompt.includes('done when') && !prompt.includes('complete when')) {
    breakdown.acceptance = MISSING_ACCEPTANCE_POINTS;
    totalScore += MISSING_ACCEPTANCE_POINTS;
    suggestions.push({
      type: 'add_acceptance',
      message: 'Add acceptance criteria (e.g., "Done when tests pass and API returns 200")',
      priority: 'high',
    });
  }

  // Check for constraints
  if (!prompt.includes('constraint') && !prompt.includes('must') && !prompt.includes('require') && !prompt.includes('only')) {
    breakdown.constraints = MISSING_CONSTRAINTS_POINTS;
    totalScore += MISSING_CONSTRAINTS_POINTS;
    suggestions.push({
      type: 'add_constraints',
      message: 'Add constraints (e.g., "Must maintain backward compatibility")',
      priority: 'medium',
    });
  }

  // Check for scope bounds (file/module hints)
  const hasFilePath = /\.(ts|js|py|go|rs|java|tsx|jsx|vue|svelte|rb|php|swift|kt)/.test(prompt);
  const hasModuleHint = /src\/|lib\/|components\/|services\/|utils\//.test(prompt);
  if (!hasFilePath && !hasModuleHint) {
    breakdown.scopeBounds = MISSING_SCOPE_BOUNDS_POINTS;
    totalScore += MISSING_SCOPE_BOUNDS_POINTS;
    suggestions.push({
      type: 'add_scope',
      message: 'Add scope bounds (e.g., "Only modify files in src/services/")',
      priority: 'medium',
    });
  }

  // Check for ambiguous verbs
  const foundAmbiguous = AMBIGUOUS_VERBS.filter(verb => {
    const regex = new RegExp(`\\b${verb}\\b`, 'i');
    return regex.test(prompt);
  });
  if (foundAmbiguous.length > 0) {
    breakdown.ambiguousVerbs = AMBIGUOUS_VERBS_POINTS;
    totalScore += AMBIGUOUS_VERBS_POINTS;
    suggestions.push({
      type: 'clarify_verbs',
      message: `Clarify ambiguous verbs: "${foundAmbiguous.join('", "')}". Be specific about what changes to make.`,
      priority: 'medium',
    });
  }

  // Check for unguarded risk areas
  const foundRiskAreas = RISK_AREAS.filter(area => {
    const regex = new RegExp(`\\b${area}\\b`, 'i');
    return regex.test(prompt);
  });
  if (foundRiskAreas.length > 0 && !prompt.includes('constraint') && !prompt.includes('do not') && !prompt.includes("don't")) {
    breakdown.unguardedRiskAreas = UNGUARDED_RISK_AREA_POINTS;
    totalScore += UNGUARDED_RISK_AREA_POINTS;
    suggestions.push({
      type: 'guard_risk',
      message: `Add guardrails for risk areas: "${foundRiskAreas.join('", "')}". Specify what changes are allowed.`,
      priority: 'high',
    });
  }

  // Cap score
  const cappedScore = Math.min(totalScore, MAX_SCORE);

  // Determine risk level
  let risk_level: 'low' | 'medium' | 'high' | 'critical';
  if (cappedScore <= 25) risk_level = 'low';
  else if (cappedScore <= 50) risk_level = 'medium';
  else if (cappedScore <= 75) risk_level = 'high';
  else risk_level = 'critical';

  // Sort suggestions by priority
  suggestions.sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    return order[a.priority] - order[b.priority];
  });

  return {
    score: cappedScore,
    breakdown,
    suggestions,
    risk_level,
  };
}
