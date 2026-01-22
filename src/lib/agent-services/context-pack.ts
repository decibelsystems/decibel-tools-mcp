// ============================================================================
// Context Pack Service
// ============================================================================
// Builds a memory brief from past runs before starting a new task.
// Helps agents avoid repeating past mistakes and learn from history.
// ============================================================================

import type {
  ContextPackRequest,
  ContextPackResponse,
  RelevantRun,
  ChurnHotspot,
  FailurePattern,
} from '../../types/agent-services.js';
import type { VectorEvent, RunInfo, PromptSpec } from '../../tools/vector.js';
import { getRun, listRuns } from '../../tools/vector.js';

// ============================================================================
// Constants
// ============================================================================

/** Default lookback period in days */
const DEFAULT_LOOKBACK_DAYS = 30;

/** Default max runs to analyze */
const DEFAULT_MAX_RUNS = 50;

/** Minimum similarity score to consider a run relevant */
const MIN_SIMILARITY_SCORE = 0.3;

/** Common error patterns to track */
const COMMON_ERROR_PATTERNS = [
  { pattern: 'type error', category: 'type_safety' },
  { pattern: 'undefined', category: 'null_check' },
  { pattern: 'not found', category: 'missing_resource' },
  { pattern: 'permission denied', category: 'permissions' },
  { pattern: 'timeout', category: 'performance' },
  { pattern: 'connection refused', category: 'connectivity' },
  { pattern: 'syntax error', category: 'syntax' },
  { pattern: 'import', category: 'dependencies' },
  { pattern: 'module not found', category: 'dependencies' },
];

// ============================================================================
// Helpers
// ============================================================================

/**
 * Calculate similarity between task and a past run's prompt
 */
function calculateSimilarity(task: string, promptSpec: PromptSpec, filesHint?: string[]): { score: number; reason: string } {
  const taskLower = task.toLowerCase();
  const promptLower = promptSpec.raw_prompt.toLowerCase();

  let score = 0;
  const reasons: string[] = [];

  // Check for shared keywords (simple word overlap)
  const taskWords = new Set(taskLower.split(/\s+/).filter(w => w.length > 3));
  const promptWords = new Set(promptLower.split(/\s+/).filter(w => w.length > 3));

  let sharedWords = 0;
  for (const word of taskWords) {
    if (promptWords.has(word)) sharedWords++;
  }

  if (taskWords.size > 0) {
    const wordOverlap = sharedWords / taskWords.size;
    score += wordOverlap * 0.4; // Up to 40% from word overlap
    if (wordOverlap > 0.3) {
      reasons.push(`Shares ${sharedWords} keywords`);
    }
  }

  // Check for intent goal similarity
  if (promptSpec.intent?.goal) {
    const goalLower = promptSpec.intent.goal.toLowerCase();
    const goalWords = new Set(goalLower.split(/\s+/).filter(w => w.length > 3));

    let goalShared = 0;
    for (const word of taskWords) {
      if (goalWords.has(word)) goalShared++;
    }

    if (taskWords.size > 0 && goalShared > 0) {
      score += 0.2; // 20% boost for goal overlap
      reasons.push('Similar goal');
    }
  }

  // Check for file hint overlap with scope
  if (filesHint && filesHint.length > 0 && promptSpec.intent?.scope) {
    const scopeSet = new Set(promptSpec.intent.scope.map(s => s.toLowerCase()));
    const hintSet = new Set(filesHint.map(f => f.toLowerCase()));

    for (const hint of hintSet) {
      for (const scope of scopeSet) {
        if (hint.includes(scope) || scope.includes(hint)) {
          score += 0.2;
          reasons.push(`File overlap: ${hint}`);
          break;
        }
      }
    }
  }

  // Check for common action verbs
  const actionVerbs = ['add', 'fix', 'update', 'refactor', 'implement', 'create', 'delete', 'remove'];
  for (const verb of actionVerbs) {
    if (taskLower.includes(verb) && promptLower.includes(verb)) {
      score += 0.1;
      reasons.push(`Same action: ${verb}`);
      break;
    }
  }

  return {
    score: Math.min(score, 1),
    reason: reasons.length > 0 ? reasons.join(', ') : 'Low similarity',
  };
}

/**
 * Extract files touched from run events
 */
function extractFilesTouched(events: VectorEvent[]): string[] {
  const files = new Set<string>();

  for (const event of events) {
    if (event.type === 'file_touched' && event.payload?.file) {
      files.add(event.payload.file);
    }
    if (event.type === 'command_ran' && event.payload?.files) {
      for (const f of event.payload.files) {
        files.add(f);
      }
    }
  }

  return Array.from(files);
}

/**
 * Extract key learnings from a run
 */
function extractLearnings(events: VectorEvent[], success: boolean): string[] {
  const learnings: string[] = [];

  // Look for user corrections - these are always valuable
  for (const event of events) {
    if (event.type === 'user_correction' && event.payload?.correction) {
      learnings.push(`User correction: ${event.payload.correction}`);
    }
  }

  // Look for backtracks - what went wrong?
  for (const event of events) {
    if (event.type === 'backtrack' && event.payload?.reason) {
      learnings.push(`Had to backtrack: ${event.payload.reason}`);
    }
  }

  // Look for errors
  for (const event of events) {
    if (event.type === 'error' && event.payload?.message) {
      learnings.push(`Error encountered: ${event.payload.message}`);
    }
  }

  // For successful runs, note what worked
  if (success && events.length > 0) {
    const lastEvent = events[events.length - 1];
    if (lastEvent.type === 'run_completed' && lastEvent.payload?.summary) {
      learnings.push(`Success: ${lastEvent.payload.summary}`);
    }
  }

  return learnings.slice(0, 5); // Cap at 5 learnings
}

/**
 * Analyze file churn across runs
 */
function analyzeChurn(
  runs: Array<{ run_id: string; events: VectorEvent[]; success: boolean; created_at: string }>
): ChurnHotspot[] {
  const fileStats: Map<string, { touches: number; failures: number; lastTouch: string }> = new Map();

  for (const run of runs) {
    const files = extractFilesTouched(run.events);

    for (const file of files) {
      const existing = fileStats.get(file) || { touches: 0, failures: 0, lastTouch: '' };
      existing.touches++;
      if (!run.success) existing.failures++;
      if (run.created_at > existing.lastTouch) existing.lastTouch = run.created_at;
      fileStats.set(file, existing);
    }
  }

  // Convert to hotspots, sort by touch count
  const hotspots: ChurnHotspot[] = [];

  for (const [file, stats] of fileStats) {
    if (stats.touches < 2) continue; // Only interested in files touched multiple times

    hotspots.push({
      file,
      touch_count: stats.touches,
      failure_rate: stats.touches > 0 ? stats.failures / stats.touches : 0,
      last_touched: stats.lastTouch,
    });
  }

  // Sort by touch count * failure rate (problematic files bubble up)
  hotspots.sort((a, b) => {
    const scoreA = a.touch_count * (1 + a.failure_rate);
    const scoreB = b.touch_count * (1 + b.failure_rate);
    return scoreB - scoreA;
  });

  return hotspots.slice(0, 10); // Top 10 hotspots
}

/**
 * Analyze failure patterns across runs
 */
function analyzeFailurePatterns(
  runs: Array<{ run_id: string; events: VectorEvent[]; success: boolean }>
): FailurePattern[] {
  const patternCounts: Map<string, { count: number; examples: string[] }> = new Map();

  for (const run of runs) {
    if (run.success) continue; // Only look at failed runs

    for (const event of run.events) {
      if (event.type !== 'error') continue;

      const message = (event.payload?.message || '').toLowerCase();

      for (const { pattern, category } of COMMON_ERROR_PATTERNS) {
        if (message.includes(pattern)) {
          const existing = patternCounts.get(category) || { count: 0, examples: [] };
          existing.count++;
          if (existing.examples.length < 3) {
            existing.examples.push(event.payload?.message || pattern);
          }
          patternCounts.set(category, existing);
        }
      }
    }
  }

  // Convert to patterns with prevention suggestions
  const patterns: FailurePattern[] = [];

  const preventionSuggestions: Record<string, string> = {
    type_safety: 'Add type annotations and check for type mismatches before running',
    null_check: 'Check for undefined/null values before accessing properties',
    missing_resource: 'Verify files and resources exist before operations',
    permissions: 'Check file permissions and authentication before access',
    performance: 'Consider timeout settings and async operation handling',
    connectivity: 'Verify network connectivity and service availability',
    syntax: 'Validate syntax before executing commands',
    dependencies: 'Check that all imports and dependencies are installed',
  };

  for (const [category, stats] of patternCounts) {
    if (stats.count < 2) continue; // Only patterns that occur multiple times

    patterns.push({
      pattern: category.replace('_', ' '),
      occurrence_count: stats.count,
      suggested_prevention: preventionSuggestions[category] || 'Review similar past errors',
    });
  }

  patterns.sort((a, b) => b.occurrence_count - a.occurrence_count);

  return patterns;
}

/**
 * Generate suggested questions based on task and history
 */
function generateQuestions(
  task: string,
  relevantRuns: RelevantRun[],
  failurePatterns: FailurePattern[]
): string[] {
  const questions: string[] = [];

  // Questions based on past failures
  for (const pattern of failurePatterns.slice(0, 2)) {
    questions.push(`Past runs had ${pattern.pattern} issues - have you addressed this?`);
  }

  // Questions based on similar runs that failed
  const failedRuns = relevantRuns.filter(r => r.outcome === 'failed');
  if (failedRuns.length > 0) {
    questions.push('Similar tasks have failed before - what makes this attempt different?');
  }

  // Questions based on ambiguous terms in task
  const ambiguousTerms = ['refactor', 'improve', 'fix', 'update', 'optimize'];
  for (const term of ambiguousTerms) {
    if (task.toLowerCase().includes(term)) {
      questions.push(`What specifically should be ${term}ed?`);
      break;
    }
  }

  // General scoping question if no files mentioned
  if (!task.match(/\.(ts|js|py|go|rs|java|tsx|jsx)/) && !task.includes('src/')) {
    questions.push('Which specific files or modules should be modified?');
  }

  return questions.slice(0, 5); // Cap at 5 questions
}

// ============================================================================
// Main Function
// ============================================================================

/**
 * Build a context pack for a new task based on historical runs
 */
export async function buildContextPack(
  request: ContextPackRequest,
  projectId?: string
): Promise<ContextPackResponse> {
  const lookbackDays = request.lookback_days || DEFAULT_LOOKBACK_DAYS;
  const maxRuns = request.max_runs || DEFAULT_MAX_RUNS;

  // Get recent runs
  const { runs } = await listRuns({
    projectId,
    limit: maxRuns,
  });

  // Filter by date
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - lookbackDays);
  const cutoffStr = cutoff.toISOString();

  const recentRuns = runs.filter(r => r.created_at >= cutoffStr);

  // Load full run data
  const fullRuns: Array<{
    run_id: string;
    prompt: PromptSpec;
    events: VectorEvent[];
    success: boolean;
    created_at: string;
  }> = [];

  for (const run of recentRuns) {
    try {
      const runData = await getRun({
        projectId,
        run_id: run.run_id,
        include_events: true,
      });

      fullRuns.push({
        run_id: run.run_id,
        prompt: runData.prompt,
        events: runData.events || [],
        success: run.success ?? !runData.completed, // If not completed, consider failed
        created_at: run.created_at,
      });
    } catch {
      // Skip runs we can't read
    }
  }

  // Find relevant runs
  const relevantRuns: RelevantRun[] = [];

  for (const run of fullRuns) {
    const { score, reason } = calculateSimilarity(request.task, run.prompt, request.files_hint);

    if (score >= MIN_SIMILARITY_SCORE) {
      relevantRuns.push({
        run_id: run.run_id,
        similarity_reason: reason,
        outcome: run.success ? 'success' : 'failed',
        key_learnings: extractLearnings(run.events, run.success),
        files_touched: extractFilesTouched(run.events),
      });
    }
  }

  // Sort by similarity (implicit in the order we found them, but could enhance)
  relevantRuns.sort((a, b) => {
    // Failed runs are more instructive
    if (a.outcome === 'failed' && b.outcome !== 'failed') return -1;
    if (b.outcome === 'failed' && a.outcome !== 'failed') return 1;
    return 0;
  });

  // Analyze churn and failure patterns
  const churnHotspots = analyzeChurn(fullRuns);
  const failurePatterns = analyzeFailurePatterns(fullRuns);

  // Generate suggested questions
  const suggestedQuestions = generateQuestions(request.task, relevantRuns, failurePatterns);

  // Build context summary
  let contextSummary = '';

  if (relevantRuns.length > 0) {
    const successCount = relevantRuns.filter(r => r.outcome === 'success').length;
    const failCount = relevantRuns.filter(r => r.outcome === 'failed').length;
    contextSummary += `Found ${relevantRuns.length} similar past runs (${successCount} successful, ${failCount} failed). `;
  } else {
    contextSummary += 'No similar past runs found. ';
  }

  if (failurePatterns.length > 0) {
    contextSummary += `Common issues: ${failurePatterns.map(p => p.pattern).join(', ')}. `;
  }

  if (churnHotspots.length > 0) {
    const problematic = churnHotspots.filter(h => h.failure_rate > 0.3);
    if (problematic.length > 0) {
      contextSummary += `High-risk files: ${problematic.slice(0, 3).map(h => h.file).join(', ')}.`;
    }
  }

  return {
    relevant_runs: relevantRuns.slice(0, 10), // Top 10 relevant runs
    churn_hotspots: churnHotspots,
    failure_patterns: failurePatterns,
    suggested_questions: suggestedQuestions,
    context_summary: contextSummary.trim() || 'No historical context available.',
  };
}
