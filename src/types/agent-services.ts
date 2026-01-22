// ============================================================================
// Agent Services Types
// ============================================================================
// Types for agent-to-agent coordination services.
// These enable agents to share context, check drift, and learn from history.
// ============================================================================

import type { VectorEvent, RunInfo, PromptSpec } from '../tools/vector.js';

// ============================================================================
// Context Pack - Memory retrieval before starting
// ============================================================================

/** Request for context pack before starting a task */
export interface ContextPackRequest {
  /** The task description or goal */
  task: string;
  /** Hint about which files might be involved */
  files_hint?: string[];
  /** How far back to look for relevant runs (days) */
  lookback_days?: number;
  /** Maximum number of relevant runs to include */
  max_runs?: number;
}

/** A run that's relevant to the current task */
export interface RelevantRun {
  run_id: string;
  similarity_reason: string;
  outcome: 'success' | 'failed' | 'unknown';
  key_learnings?: string[];
  files_touched?: string[];
}

/** Files that have been frequently modified/problematic */
export interface ChurnHotspot {
  file: string;
  touch_count: number;
  failure_rate: number;
  last_touched: string;
}

/** Pattern of failures observed in past runs */
export interface FailurePattern {
  pattern: string;
  occurrence_count: number;
  suggested_prevention: string;
}

/** Response with context pack for starting a task */
export interface ContextPackResponse {
  /** Runs that are relevant to this task */
  relevant_runs: RelevantRun[];
  /** Files with high churn or failure rates */
  churn_hotspots: ChurnHotspot[];
  /** Common failure patterns to avoid */
  failure_patterns: FailurePattern[];
  /** Questions the agent should ask before starting */
  suggested_questions: string[];
  /** Summary of what was learned from past runs */
  context_summary: string;
}

// ============================================================================
// Drift Guard - Mid-run course correction
// ============================================================================

/** Request to check if agent has drifted from original intent */
export interface DriftCheckRequest {
  /** The original task/goal */
  original_intent: string;
  /** What the agent is currently doing */
  current_plan: string;
  /** Files touched so far */
  files_touched: string[];
  /** How many steps/actions taken */
  steps_taken?: number;
  /** Events logged so far in this run */
  events?: VectorEvent[];
}

/** Recommendation for how to proceed */
export type DriftRecommendation =
  | 'continue'       // On track, keep going
  | 'narrow'         // Scope creeping, refocus
  | 'pause_and_confirm' // Significant drift, ask user
  | 'rollback';      // Way off, undo recent changes

/** Response with drift analysis */
export interface DriftCheckResponse {
  /** Score from 0-1 where 0 = on track, 1 = completely off */
  drift_score: number;
  /** What to do next */
  recommendation: DriftRecommendation;
  /** Questions to ask if pausing */
  questions: string[];
  /** Why the drift was detected */
  drift_reasons: string[];
  /** Suggested course correction */
  correction_hint?: string;
}

// ============================================================================
// Action Gate - Confidence-gated execution
// ============================================================================

/** Request to gate an action based on confidence */
export interface ActionGateRequest {
  /** The action being considered */
  action: string;
  /** Type of action */
  action_type: 'file_edit' | 'command' | 'api_call' | 'refactor' | 'delete';
  /** Agent's confidence in this action (0-1) */
  confidence: number;
  /** Files that would be affected */
  affected_files?: string[];
  /** Is this reversible? */
  reversible: boolean;
  /** Risk areas involved */
  risk_areas?: string[];
}

/** Response indicating whether to proceed */
export interface ActionGateResponse {
  /** Whether to proceed with the action */
  proceed: boolean;
  /** If not proceeding, why not */
  block_reason?: string;
  /** Confidence threshold that was applied */
  threshold_applied: number;
  /** Suggested alternative if blocked */
  alternative?: string;
  /** Should ask user for confirmation? */
  require_confirmation: boolean;
}

// ============================================================================
// Postmortem - Learning extraction after runs
// ============================================================================

/** A learning patch to apply to future runs */
export interface PostmortemPatch {
  /** Type of learning */
  type: 'assumption_validated' | 'assumption_invalidated' | 'new_constraint' | 'pattern_discovered';
  /** The learning content */
  content: string;
  /** Confidence in this learning (0-1) */
  confidence: number;
  /** Context where this applies */
  applies_to: string[];
  /** Source run ID */
  source_run: string;
}

/** Result of extracting learnings from a run */
export interface PostmortemResult {
  run_id: string;
  patches: PostmortemPatch[];
  /** Overall run health score */
  health_score: number;
  /** Key events that shaped the outcome */
  pivotal_events: string[];
}

// ============================================================================
// Assumption Tracking - Cross-run assumption aggregation
// ============================================================================

/** Category of assumption */
export type AssumptionCategory =
  | 'architecture'
  | 'api_behavior'
  | 'auth'
  | 'data_format'
  | 'dependencies'
  | 'environment'
  | 'permissions'
  | 'performance'
  | 'security'
  | 'user_intent'
  | 'other';

/** Outcome of an assumption */
export type AssumptionOutcome =
  | 'validated'    // Turned out to be correct
  | 'invalidated'  // Turned out to be wrong
  | 'unknown';     // Never confirmed either way

/** Enhanced assumption event with tracking fields */
export interface TrackedAssumption {
  /** The assumption that was made */
  assumption: string;
  /** Why this assumption was made */
  rationale?: string;
  /** Alternatives that were considered */
  alternatives?: string[];
  /** Confidence threshold - ask if below this */
  ask_if_below?: number;
  /** Category for aggregation */
  category: AssumptionCategory;
  /** What happened with this assumption */
  outcome: AssumptionOutcome;
  /** The run this came from */
  run_id: string;
  /** When it was made */
  timestamp: string;
}

/** Aggregated stats about assumptions */
export interface AssumptionStats {
  /** Total assumptions tracked */
  total_count: number;
  /** Breakdown by outcome */
  by_outcome: {
    validated: number;
    invalidated: number;
    unknown: number;
  };
  /** Categories with highest invalidation rates */
  high_risk_categories: AssumptionCategory[];
  /** Specific assumptions that should always be asked */
  always_ask: string[];
  /** Validation rate by category */
  category_validation_rates: Record<AssumptionCategory, number>;
}

/** Assumption stats with full context for debugging */
export interface AssumptionStatsWithContext extends AssumptionStats {
  /** All tracked assumptions */
  assumptions: TrackedAssumption[];
  /** Analysis period */
  period: {
    start: string;
    end: string;
    run_count: number;
  };
}

// ============================================================================
// Checkpoint - Combined mid-run state check
// ============================================================================

/** Request for a comprehensive checkpoint */
export interface CheckpointRequest {
  run_id: string;
  original_intent: string;
  current_plan: string;
  files_touched: string[];
  pending_action?: ActionGateRequest;
}

/** Response with full checkpoint analysis */
export interface CheckpointResponse {
  drift: DriftCheckResponse;
  action_gate?: ActionGateResponse;
  /** Should the agent continue, pause, or stop? */
  overall_status: 'green' | 'yellow' | 'red';
  /** Human-readable summary */
  summary: string;
}
