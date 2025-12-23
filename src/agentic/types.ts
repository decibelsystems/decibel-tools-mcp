/**
 * Agentic Pack Engine - Type Definitions
 *
 * Core invariant: Canonical payload is the truth. Renderers are only views.
 * Renderers NEVER change meaning. They change compression, typography, and stance.
 */

// ============================================================================
// Agent Role Types
// ============================================================================

export type AgentRole = 'Sensor' | 'Analyst' | 'Overmind' | 'Specialist';
export type AgentStatus = 'OK' | 'DEGRADED' | 'BLOCKED' | 'ALERT';
export type LoadLevel = 'GREEN' | 'YELLOW' | 'RED';

// ============================================================================
// Canonical Payload Schema
// ============================================================================

export interface Evidence {
  source: string;
  value: unknown;
  confidence?: number;
  timestamp?: string;
}

export interface MissingData {
  field: string;
  reason: string;
  severity: 'blocking' | 'degraded' | 'informational';
}

export interface Guardrail {
  id: string;
  description: string;
  status: 'active' | 'triggered' | 'disabled';
}

export interface DissentSummary {
  agent_id: string;
  position: string;
  confidence: number;
}

export interface PayloadMetadata {
  pack_id: string;
  pack_hash: string;
  renderer_id?: string;
  specialist_id?: string;
  created_at: string;
}

export interface CanonicalPayload {
  role: AgentRole;
  status: AgentStatus;
  load: LoadLevel;
  summary: string;
  evidence: Evidence[];
  missing_data: MissingData[];
  // Overmind-specific fields
  decision?: string;
  guardrails?: Guardrail[];
  dissent_summary?: DissentSummary[];
  // Specialist-specific fields
  specialist_id?: string;
  specialist_name?: string;
  // Metadata
  metadata: PayloadMetadata;
}

// ============================================================================
// Renderer Types
// ============================================================================

export type RenderTarget = 'plain' | 'markdown' | 'ansi';

export interface RendererConstraints {
  max_emoji_count?: number;
  emoji_position?: 'header-only' | 'none' | 'anywhere';
  max_lines?: number;
  max_section_lines?: number;
  required_sections?: string[];
  banned_punctuation?: string[];
  banned_words?: string[];
}

export interface RendererConfig {
  id: string;
  name: string;
  description?: string;
  template: string;
  constraints: RendererConstraints;
  ansi_styles?: Record<string, string>;
}

export interface RenderOutput {
  rendered: string;
  renderer_id: string;
  target: RenderTarget;
  warnings: string[];
  metadata: {
    line_count: number;
    char_count: number;
    emoji_count: number;
  };
}

// ============================================================================
// Lint Types
// ============================================================================

export type LintSeverity = 'error' | 'warning' | 'info';

export interface LintViolation {
  rule: string;
  severity: LintSeverity;
  message: string;
  line?: number;
  column?: number;
  suggestion?: string;
}

export interface LintResult {
  valid: boolean;
  violations: LintViolation[];
  renderer_id: string;
  checked_at: string;
}

// ============================================================================
// Compiled Pack Types
// ============================================================================

export interface AvatarConfig {
  id: string;
  name: string;
  emoji?: string;
  role: AgentRole;
  description?: string;
}

export interface TaxonomyConfig {
  roles: Record<AgentRole, { emoji: string; description: string }>;
  statuses: Record<AgentStatus, { emoji: string; color: string }>;
  loads: Record<LoadLevel, { emoji: string; color: string }>;
}

export interface ConsensusConfig {
  quorum_threshold: number;
  dissent_highlight_threshold: number;
  max_pending_decisions: number;
}

export interface CompiledPack {
  taxonomy: TaxonomyConfig;
  renderers: Record<string, RendererConfig>;
  consensus?: ConsensusConfig;
  avatars: Record<string, AvatarConfig>;
  ansi_styles?: Record<string, string>;
}

export interface CompileResult {
  pack_id: string;
  pack_hash: string;
  compiled_at: string;
  content: CompiledPack;
  source_files: string[];
}

// ============================================================================
// Golden Eval Types
// ============================================================================

export interface GoldenCase {
  name: string;
  payload_file: string;
  expected_outputs: Record<string, string>; // renderer_id -> expected output file
}

export interface GoldenTestResult {
  case_name: string;
  renderer_id: string;
  passed: boolean;
  expected_file: string;
  actual?: string;
  expected?: string;
  diff?: string[];
  lint_result?: LintResult;
}

export interface GoldenResult {
  passed: boolean;
  total_cases: number;
  passed_cases: number;
  failed_cases: number;
  results: GoldenTestResult[];
  run_at: string;
}

// ============================================================================
// Tool Input/Output Types
// ============================================================================

export interface CompilePackInput {
  projectId?: string;
}

export interface CompilePackOutput {
  status: 'compiled' | 'error';
  result?: CompileResult;
  error?: string;
}

export interface RenderInput {
  projectId?: string;
  payload: CanonicalPayload;
  renderer_id: string;
  target?: RenderTarget;
}

export interface RenderOutputResult {
  status: 'rendered' | 'error';
  result?: RenderOutput;
  error?: string;
}

export interface LintInput {
  projectId?: string;
  rendered: string;
  renderer_id: string;
  payload?: CanonicalPayload;
}

export interface LintOutputResult {
  status: 'linted' | 'error';
  result?: LintResult;
  error?: string;
}

export interface GoldenInput {
  projectId?: string;
  case_name?: string;
  strict?: boolean;
}

export interface GoldenOutputResult {
  status: 'executed' | 'error';
  result?: GoldenResult;
  error?: string;
}
