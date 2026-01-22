// ============================================================================
// Assumption Aggregation Service
// ============================================================================
// Aggregates assumptions across runs to identify patterns, high-risk categories,
// and things the agent should always ask about rather than assume.
// ============================================================================

import type {
  TrackedAssumption,
  AssumptionStats,
  AssumptionStatsWithContext,
  AssumptionCategory,
  AssumptionOutcome,
} from '../../types/agent-services.js';
import type { VectorEvent, RunInfo } from '../../tools/vector.js';
import { getRun, listRuns } from '../../tools/vector.js';

// ============================================================================
// Constants
// ============================================================================

/** Threshold for considering a category high-risk */
const HIGH_RISK_INVALIDATION_RATE = 0.3; // 30%+ invalidation = high risk

/** Minimum occurrences to consider for "always ask" */
const MIN_OCCURRENCES_FOR_ALWAYS_ASK = 2;

/** Invalidation rate threshold for "always ask" */
const ALWAYS_ASK_INVALIDATION_RATE = 0.5; // 50%+ invalidation = always ask

// ============================================================================
// Helpers
// ============================================================================

/**
 * Extract tracked assumptions from run events
 */
function extractAssumptions(events: VectorEvent[], run_id: string): TrackedAssumption[] {
  const assumptions: TrackedAssumption[] = [];

  for (const event of events) {
    if (event.type !== 'assumption_made') continue;
    if (!event.payload) continue;

    const payload = event.payload;

    assumptions.push({
      assumption: payload.assumption || payload.content || 'Unknown assumption',
      rationale: payload.rationale,
      alternatives: payload.alternatives,
      ask_if_below: payload.ask_if_below,
      category: normalizeCategory(payload.category),
      outcome: normalizeOutcome(payload.outcome),
      run_id,
      timestamp: event.ts,
    });
  }

  return assumptions;
}

/**
 * Normalize category string to valid AssumptionCategory
 */
function normalizeCategory(category?: string): AssumptionCategory {
  if (!category) return 'other';

  const normalized = category.toLowerCase().replace(/[^a-z_]/g, '');

  const validCategories: AssumptionCategory[] = [
    'architecture', 'api_behavior', 'auth', 'data_format',
    'dependencies', 'environment', 'permissions', 'performance',
    'security', 'user_intent', 'other'
  ];

  if (validCategories.includes(normalized as AssumptionCategory)) {
    return normalized as AssumptionCategory;
  }

  // Map common variations
  if (normalized.includes('api')) return 'api_behavior';
  if (normalized.includes('auth') || normalized.includes('login')) return 'auth';
  if (normalized.includes('data') || normalized.includes('format')) return 'data_format';
  if (normalized.includes('dep') || normalized.includes('package')) return 'dependencies';
  if (normalized.includes('env') || normalized.includes('config')) return 'environment';
  if (normalized.includes('perm') || normalized.includes('access')) return 'permissions';
  if (normalized.includes('perf') || normalized.includes('speed')) return 'performance';
  if (normalized.includes('sec')) return 'security';
  if (normalized.includes('user') || normalized.includes('intent')) return 'user_intent';

  return 'other';
}

/**
 * Normalize outcome string to valid AssumptionOutcome
 */
function normalizeOutcome(outcome?: string): AssumptionOutcome {
  if (!outcome) return 'unknown';

  const normalized = outcome.toLowerCase();

  if (normalized === 'validated' || normalized === 'valid' || normalized === 'correct') {
    return 'validated';
  }
  if (normalized === 'invalidated' || normalized === 'invalid' || normalized === 'wrong' || normalized === 'incorrect') {
    return 'invalidated';
  }

  return 'unknown';
}

/**
 * Infer outcome from subsequent events if not explicitly set
 */
function inferOutcome(
  assumption: TrackedAssumption,
  allEvents: VectorEvent[],
  assumptionIndex: number
): AssumptionOutcome {
  if (assumption.outcome !== 'unknown') {
    return assumption.outcome;
  }

  // Look at events after this assumption
  const subsequentEvents = allEvents.slice(assumptionIndex + 1);

  for (const event of subsequentEvents) {
    // Backtrack or error after assumption often means it was wrong
    if (event.type === 'backtrack' || event.type === 'error') {
      const payload = event.payload;
      if (payload?.reason?.toLowerCase().includes(assumption.assumption.toLowerCase())) {
        return 'invalidated';
      }
    }

    // User correction specifically about this assumption
    if (event.type === 'user_correction') {
      const payload = event.payload;
      if (payload?.correction?.toLowerCase().includes(assumption.assumption.toLowerCase())) {
        return 'invalidated';
      }
    }
  }

  return 'unknown';
}

// ============================================================================
// Main Functions
// ============================================================================

/**
 * Aggregate assumptions from multiple runs
 */
export async function aggregateAssumptions(
  projectId?: string,
  options?: {
    lookback_days?: number;
    max_runs?: number;
  }
): Promise<AssumptionStatsWithContext> {
  const lookbackDays = options?.lookback_days || 30;
  const maxRuns = options?.max_runs || 100;

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

  // Collect all assumptions
  const allAssumptions: TrackedAssumption[] = [];

  for (const run of recentRuns) {
    try {
      const runData = await getRun({
        projectId,
        run_id: run.run_id,
        include_events: true,
      });

      if (!runData.events) continue;

      const assumptions = extractAssumptions(runData.events, run.run_id);

      // Try to infer outcomes
      for (let i = 0; i < runData.events.length; i++) {
        const event = runData.events[i];
        if (event.type === 'assumption_made') {
          const assumptionIndex = assumptions.findIndex(
            a => a.timestamp === event.ts && a.run_id === run.run_id
          );
          if (assumptionIndex >= 0) {
            assumptions[assumptionIndex].outcome = inferOutcome(
              assumptions[assumptionIndex],
              runData.events,
              i
            );
          }
        }
      }

      allAssumptions.push(...assumptions);
    } catch {
      // Skip runs we can't read
    }
  }

  // Calculate stats
  const stats = calculateStats(allAssumptions);

  return {
    ...stats,
    assumptions: allAssumptions,
    period: {
      start: cutoffStr,
      end: new Date().toISOString(),
      run_count: recentRuns.length,
    },
  };
}

/**
 * Calculate statistics from assumptions
 */
function calculateStats(assumptions: TrackedAssumption[]): AssumptionStats {
  const byOutcome = {
    validated: 0,
    invalidated: 0,
    unknown: 0,
  };

  const byCategory: Record<AssumptionCategory, { valid: number; invalid: number; total: number }> = {
    architecture: { valid: 0, invalid: 0, total: 0 },
    api_behavior: { valid: 0, invalid: 0, total: 0 },
    auth: { valid: 0, invalid: 0, total: 0 },
    data_format: { valid: 0, invalid: 0, total: 0 },
    dependencies: { valid: 0, invalid: 0, total: 0 },
    environment: { valid: 0, invalid: 0, total: 0 },
    permissions: { valid: 0, invalid: 0, total: 0 },
    performance: { valid: 0, invalid: 0, total: 0 },
    security: { valid: 0, invalid: 0, total: 0 },
    user_intent: { valid: 0, invalid: 0, total: 0 },
    other: { valid: 0, invalid: 0, total: 0 },
  };

  // Track specific assumptions for "always ask"
  const assumptionOccurrences: Map<string, { valid: number; invalid: number }> = new Map();

  for (const a of assumptions) {
    byOutcome[a.outcome]++;

    const cat = byCategory[a.category];
    cat.total++;
    if (a.outcome === 'validated') cat.valid++;
    if (a.outcome === 'invalidated') cat.invalid++;

    // Normalize assumption text for grouping
    const normalized = a.assumption.toLowerCase().trim();
    const existing = assumptionOccurrences.get(normalized) || { valid: 0, invalid: 0 };
    if (a.outcome === 'validated') existing.valid++;
    if (a.outcome === 'invalidated') existing.invalid++;
    assumptionOccurrences.set(normalized, existing);
  }

  // Calculate category validation rates and find high-risk ones
  const categoryValidationRates: Record<AssumptionCategory, number> = {} as Record<AssumptionCategory, number>;
  const highRiskCategories: AssumptionCategory[] = [];

  for (const [category, stats] of Object.entries(byCategory)) {
    const cat = category as AssumptionCategory;
    if (stats.total === 0) {
      categoryValidationRates[cat] = 1; // No data = assume safe
      continue;
    }

    const knownOutcomes = stats.valid + stats.invalid;
    if (knownOutcomes === 0) {
      categoryValidationRates[cat] = 1;
      continue;
    }

    const validationRate = stats.valid / knownOutcomes;
    categoryValidationRates[cat] = validationRate;

    const invalidationRate = stats.invalid / knownOutcomes;
    if (invalidationRate >= HIGH_RISK_INVALIDATION_RATE && stats.total >= MIN_OCCURRENCES_FOR_ALWAYS_ASK) {
      highRiskCategories.push(cat);
    }
  }

  // Find specific assumptions to always ask about
  const alwaysAsk: string[] = [];
  for (const [assumption, counts] of assumptionOccurrences) {
    const total = counts.valid + counts.invalid;
    if (total < MIN_OCCURRENCES_FOR_ALWAYS_ASK) continue;

    const invalidationRate = counts.invalid / total;
    if (invalidationRate >= ALWAYS_ASK_INVALIDATION_RATE) {
      alwaysAsk.push(assumption);
    }
  }

  return {
    total_count: assumptions.length,
    by_outcome: byOutcome,
    high_risk_categories: highRiskCategories,
    always_ask: alwaysAsk,
    category_validation_rates: categoryValidationRates,
  };
}

/**
 * Check if a specific assumption should be asked about
 */
export async function shouldAskAbout(
  assumption: string,
  category: AssumptionCategory,
  projectId?: string
): Promise<{ should_ask: boolean; reason?: string }> {
  const stats = await aggregateAssumptions(projectId);

  // Check if this specific assumption is in always_ask
  const normalized = assumption.toLowerCase().trim();
  if (stats.always_ask.some(a => normalized.includes(a) || a.includes(normalized))) {
    return {
      should_ask: true,
      reason: 'This assumption has been invalidated frequently in the past',
    };
  }

  // Check if category is high-risk
  if (stats.high_risk_categories.includes(category)) {
    return {
      should_ask: true,
      reason: `Category "${category}" has a high invalidation rate (${Math.round((1 - stats.category_validation_rates[category]) * 100)}%)`,
    };
  }

  return { should_ask: false };
}
