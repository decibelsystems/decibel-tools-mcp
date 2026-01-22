// ============================================================================
// Agent Services Module
// ============================================================================
// Services for agent-to-agent coordination and self-awareness.
// ============================================================================

// Re-export all services
export { aggregateAssumptions, shouldAskAbout } from './assumptions.js';
export { buildContextPack } from './context-pack.js';
export { checkDrift, checkActionGate, checkpoint } from './drift-guard.js';

// Re-export types
export type {
  // Context Pack
  ContextPackRequest,
  ContextPackResponse,
  RelevantRun,
  ChurnHotspot,
  FailurePattern,

  // Drift Guard
  DriftCheckRequest,
  DriftCheckResponse,
  DriftRecommendation,
  ActionGateRequest,
  ActionGateResponse,
  CheckpointRequest,
  CheckpointResponse,

  // Assumptions
  TrackedAssumption,
  AssumptionStats,
  AssumptionStatsWithContext,
  AssumptionCategory,
  AssumptionOutcome,

  // Postmortem
  PostmortemPatch,
  PostmortemResult,
} from '../../types/agent-services.js';
