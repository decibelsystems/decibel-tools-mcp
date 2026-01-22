// ============================================================================
// Drift Guard Service
// ============================================================================
// Detects when an agent has drifted from the original intent and recommends
// course corrections. Helps prevent scope creep and wasted effort.
// ============================================================================

import type {
  DriftCheckRequest,
  DriftCheckResponse,
  DriftRecommendation,
  ActionGateRequest,
  ActionGateResponse,
  CheckpointRequest,
  CheckpointResponse,
} from '../../types/agent-services.js';
import type { VectorEvent } from '../../tools/vector.js';

// ============================================================================
// Constants
// ============================================================================

/** Drift score thresholds */
const DRIFT_THRESHOLDS = {
  LOW: 0.3,      // Below this = continue
  MEDIUM: 0.5,   // Below this = narrow scope
  HIGH: 0.7,     // Below this = pause and confirm
  // Above HIGH = rollback
};

/** Confidence thresholds by action type */
const CONFIDENCE_THRESHOLDS: Record<ActionGateRequest['action_type'], number> = {
  file_edit: 0.6,
  command: 0.7,
  api_call: 0.8,
  refactor: 0.7,
  delete: 0.9, // Very high threshold for destructive actions
};

/** Keywords that indicate scope expansion */
const SCOPE_EXPANSION_SIGNALS = [
  'also', 'while we\'re at it', 'might as well', 'refactor',
  'clean up', 'improve', 'optimize', 'related', 'similar',
];

/** Keywords that indicate the agent is on track */
const ON_TRACK_SIGNALS = [
  'as requested', 'per the task', 'completing', 'finishing',
  'implementing', 'adding the', 'fixing the', 'updating the',
];

// ============================================================================
// Helpers
// ============================================================================

/**
 * Calculate word overlap between two strings (Jaccard-like)
 */
function calculateWordOverlap(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 3));

  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersection = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) intersection++;
  }

  const union = new Set([...wordsA, ...wordsB]).size;
  return union > 0 ? intersection / union : 0;
}

/**
 * Extract scope from intent text (file paths, module names)
 */
function extractScope(text: string): string[] {
  const scope: string[] = [];

  // File paths
  const fileMatches = text.match(/[\w\-./]+\.(ts|js|py|go|rs|java|tsx|jsx|vue|svelte|rb|php)/gi);
  if (fileMatches) scope.push(...fileMatches);

  // Directory paths
  const dirMatches = text.match(/(src|lib|components|services|utils|api|test|tests)\/[\w\-./]*/gi);
  if (dirMatches) scope.push(...dirMatches);

  return [...new Set(scope)];
}

/**
 * Check if current work has expanded beyond original scope
 */
function detectScopeExpansion(
  originalIntent: string,
  currentPlan: string,
  filesTouched: string[]
): { expanded: boolean; reasons: string[] } {
  const reasons: string[] = [];

  // Check for scope expansion signals in current plan
  const planLower = currentPlan.toLowerCase();
  for (const signal of SCOPE_EXPANSION_SIGNALS) {
    if (planLower.includes(signal)) {
      reasons.push(`Plan contains scope expansion signal: "${signal}"`);
    }
  }

  // Check if files touched are outside original scope
  const originalScope = extractScope(originalIntent);
  if (originalScope.length > 0 && filesTouched.length > 0) {
    const outsideScope = filesTouched.filter(file => {
      const fileLower = file.toLowerCase();
      return !originalScope.some(scope => fileLower.includes(scope.toLowerCase()));
    });

    if (outsideScope.length > filesTouched.length * 0.5) {
      reasons.push(`${outsideScope.length} of ${filesTouched.length} files touched are outside original scope`);
    }
  }

  // Check if plan has significantly different focus
  const intentWords = new Set(originalIntent.toLowerCase().split(/\s+/).filter(w => w.length > 4));
  const planWords = currentPlan.toLowerCase().split(/\s+/).filter(w => w.length > 4);

  const newWords = planWords.filter(w => !intentWords.has(w));
  if (newWords.length > planWords.length * 0.6) {
    reasons.push('Current plan introduces many concepts not in original intent');
  }

  return {
    expanded: reasons.length > 0,
    reasons,
  };
}

/**
 * Analyze events for drift signals
 */
function analyzeEventDrift(events: VectorEvent[]): { score: number; signals: string[] } {
  const signals: string[] = [];
  let driftScore = 0;

  // Count backtracks
  const backtracks = events.filter(e => e.type === 'backtrack').length;
  if (backtracks > 2) {
    signals.push(`${backtracks} backtracks indicate uncertainty`);
    driftScore += 0.1 * backtracks;
  }

  // Check for repeated errors
  const errors = events.filter(e => e.type === 'error');
  if (errors.length > 3) {
    signals.push(`${errors.length} errors suggest the approach may be wrong`);
    driftScore += 0.15;
  }

  // Check for user corrections
  const corrections = events.filter(e => e.type === 'user_correction');
  if (corrections.length > 0) {
    signals.push(`${corrections.length} user corrections needed`);
    driftScore += 0.2 * corrections.length;
  }

  // Check for assumptions without validation
  const assumptions = events.filter(e => e.type === 'assumption_made');
  const unvalidated = assumptions.filter(a => !a.payload?.validated);
  if (unvalidated.length > 3) {
    signals.push(`${unvalidated.length} unvalidated assumptions`);
    driftScore += 0.05 * unvalidated.length;
  }

  return {
    score: Math.min(driftScore, 1),
    signals,
  };
}

/**
 * Generate questions to ask when pausing
 */
function generateDriftQuestions(
  originalIntent: string,
  currentPlan: string,
  reasons: string[]
): string[] {
  const questions: string[] = [];

  // Always include a clarification question
  questions.push('Is this still aligned with what you wanted?');

  // Context-specific questions
  if (reasons.some(r => r.includes('scope expansion'))) {
    questions.push('Should we expand scope to include these additional changes, or stay focused?');
  }

  if (reasons.some(r => r.includes('outside original scope'))) {
    questions.push('I\'ve touched files outside the original scope - should I continue or revert?');
  }

  if (reasons.some(r => r.includes('backtracks'))) {
    questions.push('I\'ve had to backtrack several times - would a different approach be better?');
  }

  if (reasons.some(r => r.includes('errors'))) {
    questions.push('I\'m encountering repeated errors - should we pause and diagnose?');
  }

  // Extract key differences and ask about them
  const intentNouns: string[] = originalIntent.match(/\b[A-Z][a-z]+\b/g) || [];
  const planNouns: string[] = currentPlan.match(/\b[A-Z][a-z]+\b/g) || [];
  const newNouns = planNouns.filter(n => !intentNouns.includes(n));

  if (newNouns.length > 0 && newNouns.length <= 3) {
    questions.push(`I'm now working with ${newNouns.join(', ')} - is this expected?`);
  }

  return questions.slice(0, 4); // Cap at 4 questions
}

// ============================================================================
// Main Functions
// ============================================================================

/**
 * Check for drift from original intent
 */
export function checkDrift(request: DriftCheckRequest): DriftCheckResponse {
  const reasons: string[] = [];
  let driftScore = 0;

  // 1. Check word overlap between intent and current plan
  const overlap = calculateWordOverlap(request.original_intent, request.current_plan);
  const overlapDrift = 1 - overlap;
  driftScore += overlapDrift * 0.3; // 30% weight for word overlap

  if (overlapDrift > 0.6) {
    reasons.push('Current plan has little word overlap with original intent');
  }

  // 2. Check for scope expansion
  const { expanded, reasons: expansionReasons } = detectScopeExpansion(
    request.original_intent,
    request.current_plan,
    request.files_touched
  );

  if (expanded) {
    driftScore += 0.25;
    reasons.push(...expansionReasons);
  }

  // 3. Analyze events if provided
  if (request.events && request.events.length > 0) {
    const { score: eventDrift, signals } = analyzeEventDrift(request.events);
    driftScore += eventDrift * 0.3; // 30% weight for event analysis
    reasons.push(...signals);
  }

  // 4. Check step count (more steps = more opportunity for drift)
  if (request.steps_taken && request.steps_taken > 20) {
    driftScore += 0.1;
    reasons.push(`${request.steps_taken} steps taken - long sessions are prone to drift`);
  }

  // 5. Check for on-track signals (reduce drift score)
  const planLower = request.current_plan.toLowerCase();
  for (const signal of ON_TRACK_SIGNALS) {
    if (planLower.includes(signal)) {
      driftScore -= 0.1;
      break;
    }
  }

  // Clamp score
  driftScore = Math.max(0, Math.min(1, driftScore));

  // Determine recommendation
  let recommendation: DriftRecommendation;
  if (driftScore < DRIFT_THRESHOLDS.LOW) {
    recommendation = 'continue';
  } else if (driftScore < DRIFT_THRESHOLDS.MEDIUM) {
    recommendation = 'narrow';
  } else if (driftScore < DRIFT_THRESHOLDS.HIGH) {
    recommendation = 'pause_and_confirm';
  } else {
    recommendation = 'rollback';
  }

  // Generate questions
  const questions = recommendation !== 'continue'
    ? generateDriftQuestions(request.original_intent, request.current_plan, reasons)
    : [];

  // Generate correction hint
  let correctionHint: string | undefined;
  if (recommendation === 'narrow') {
    const originalScope = extractScope(request.original_intent);
    if (originalScope.length > 0) {
      correctionHint = `Refocus on: ${originalScope.join(', ')}`;
    } else {
      correctionHint = 'Complete the core task before expanding scope';
    }
  } else if (recommendation === 'rollback') {
    correctionHint = 'Consider reverting recent changes and restarting with a clearer plan';
  }

  return {
    drift_score: Math.round(driftScore * 100) / 100,
    recommendation,
    questions,
    drift_reasons: reasons,
    correction_hint: correctionHint,
  };
}

/**
 * Gate an action based on confidence and risk
 */
export function checkActionGate(request: ActionGateRequest): ActionGateResponse {
  const threshold = CONFIDENCE_THRESHOLDS[request.action_type];

  // Adjust threshold based on risk areas
  let adjustedThreshold = threshold;
  if (request.risk_areas && request.risk_areas.length > 0) {
    // Increase threshold for risky operations
    adjustedThreshold = Math.min(0.95, threshold + 0.1 * request.risk_areas.length);
  }

  // Lower threshold slightly for reversible actions
  if (request.reversible) {
    adjustedThreshold = Math.max(0.5, adjustedThreshold - 0.1);
  }

  const proceed = request.confidence >= adjustedThreshold;

  let blockReason: string | undefined;
  let alternative: string | undefined;
  let requireConfirmation = false;

  if (!proceed) {
    blockReason = `Confidence ${Math.round(request.confidence * 100)}% is below threshold ${Math.round(adjustedThreshold * 100)}%`;

    if (request.action_type === 'delete') {
      alternative = 'Move to a backup location instead of deleting';
    } else if (request.action_type === 'refactor') {
      alternative = 'Make smaller, incremental changes instead of a large refactor';
    } else {
      alternative = 'Ask the user for confirmation before proceeding';
    }

    requireConfirmation = true;
  } else if (request.risk_areas && request.risk_areas.length > 0) {
    // Even if proceeding, require confirmation for risky areas
    requireConfirmation = true;
  }

  return {
    proceed,
    block_reason: blockReason,
    threshold_applied: adjustedThreshold,
    alternative,
    require_confirmation: requireConfirmation,
  };
}

/**
 * Comprehensive checkpoint combining drift check and action gate
 */
export function checkpoint(request: CheckpointRequest): CheckpointResponse {
  // Check drift
  const drift = checkDrift({
    original_intent: request.original_intent,
    current_plan: request.current_plan,
    files_touched: request.files_touched,
  });

  // Check action gate if there's a pending action
  let actionGate: ActionGateResponse | undefined;
  if (request.pending_action) {
    actionGate = checkActionGate(request.pending_action);
  }

  // Determine overall status
  let overallStatus: 'green' | 'yellow' | 'red';

  if (drift.recommendation === 'rollback' || (actionGate && !actionGate.proceed && !actionGate.require_confirmation)) {
    overallStatus = 'red';
  } else if (drift.recommendation !== 'continue' || (actionGate && actionGate.require_confirmation)) {
    overallStatus = 'yellow';
  } else {
    overallStatus = 'green';
  }

  // Build summary
  let summary = '';

  switch (overallStatus) {
    case 'green':
      summary = 'On track. Continue with the current approach.';
      break;
    case 'yellow':
      if (drift.recommendation === 'narrow') {
        summary = `Drift detected (${Math.round(drift.drift_score * 100)}%). ${drift.correction_hint || 'Consider narrowing scope.'}`;
      } else if (drift.recommendation === 'pause_and_confirm') {
        summary = `Significant drift detected (${Math.round(drift.drift_score * 100)}%). Pause and confirm direction with user.`;
      } else if (actionGate?.require_confirmation) {
        summary = `Pending action requires confirmation. ${actionGate.block_reason || ''}`;
      }
      break;
    case 'red':
      if (drift.recommendation === 'rollback') {
        summary = `Critical drift (${Math.round(drift.drift_score * 100)}%). Recommend rolling back recent changes.`;
      } else if (actionGate && !actionGate.proceed) {
        summary = `Action blocked: ${actionGate.block_reason}`;
      }
      break;
  }

  return {
    drift,
    action_gate: actionGate,
    overall_status: overallStatus,
    summary,
  };
}
