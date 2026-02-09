// ============================================================================
// Lateral Design Thinking
// ============================================================================
// Structured lateral thinking sessions inspired by Edward de Bono's methods.
// Sessions persist as YAML artifacts in .decibel/designer/lateral/.
// ============================================================================

import fs from 'fs/promises';
import path from 'path';
import YAML from 'yaml';
import { log } from '../config.js';
import { ensureDir } from '../dataRoot.js';
import { resolveProjectPaths, validateWritePath, type ResolvedProjectPaths } from '../projectRegistry.js';
import { emitCreateProvenance } from './provenance.js';

// ============================================================================
// Types
// ============================================================================

export type Technique =
  | 'six_hats'
  | 'provocation'
  | 'random_entry'
  | 'challenge'
  | 'alternatives'
  | 'reversal';

export const VALID_TECHNIQUES: Technique[] = [
  'six_hats', 'provocation', 'random_entry', 'challenge', 'alternatives', 'reversal',
];

export type HatColor = 'white' | 'red' | 'black' | 'yellow' | 'green' | 'blue';

export const VALID_HATS: HatColor[] = ['white', 'red', 'black', 'yellow', 'green', 'blue'];

export interface LateralError {
  error: string;
  message: string;
  hint?: string;
}

export function isLateralError(result: unknown): result is LateralError {
  return typeof result === 'object' && result !== null && 'error' in result && 'message' in result;
}

// ---- Technique Inputs ----

export interface SixHatsInput {
  hat: HatColor;
  thinking: string;
}

export interface ProvocationInput {
  po_statement: string;
  movement: string;
  insights: string[];
}

export interface RandomEntryInput {
  stimulus?: string;
  connections: string[];
  promising_leads: string[];
}

export interface ChallengeInput {
  assumption: string;
  why_exists: string;
  what_if_false: string;
  alternative_framing: string;
}

export interface AlternativesInput {
  focus: string;
  concept_level: string;
  alternatives: Array<{ idea: string; approach: string }>;
}

export interface ReversalInput {
  original: string;
  reversed: string;
  insights_from_reversal: string[];
}

export type TechniqueInput =
  | SixHatsInput
  | ProvocationInput
  | RandomEntryInput
  | ChallengeInput
  | AlternativesInput
  | ReversalInput;

// ---- Session Structures ----

export interface TechniqueEntry {
  entry_id: string;
  technique: Technique;
  timestamp: string;
  data: TechniqueInput;
}

export interface LateralSession {
  session_id: string;
  project_id: string;
  problem: string;
  context?: string;
  status: 'open' | 'closed';
  created_at: string;
  closed_at?: string;
  entries: TechniqueEntry[];
  synthesis?: string;
  action_items?: string[];
  linked_to?: string[];
}

// ---- Tool I/O ----

export interface StartSessionInput {
  projectId?: string;
  session_id?: string;
  problem?: string;
  context?: string;
}

export interface StartSessionOutput {
  session_id: string;
  problem: string;
  status: 'open' | 'closed';
  techniques_applied: string[];
  path: string;
}

export interface ApplyTechniqueInput {
  projectId?: string;
  session_id: string;
  technique: Technique;
  input: Record<string, unknown>;
}

export interface ApplyTechniqueOutput {
  entry_id: string;
  recorded: boolean;
  guidance: string;
  session_progress: {
    techniques_applied: string[];
    entry_count: number;
  };
}

export interface CloseSessionInput {
  projectId?: string;
  session_id: string;
  synthesis: string;
  action_items?: string[];
  link_to?: string[];
}

export interface CloseSessionOutput {
  session_id: string;
  path: string;
  summary_path: string;
  techniques_applied: number;
}

// ============================================================================
// Constants
// ============================================================================

/** Recommended Six Hats sequence: Blue > White > Red > Black > Yellow > Green > Blue */
export const HAT_ORDER: HatColor[] = ['blue', 'white', 'red', 'black', 'yellow', 'green', 'blue'];

/** Guidance for each hat color (de Bono's parallel thinking) */
export const HAT_GUIDANCE: Record<HatColor, string> = {
  blue: 'PROCESS: Define the focus, set the agenda, summarise, and decide next steps. What are we thinking about? What sequence of hats should we use?',
  white: 'FACTS: State known information and data neutrally. No opinions or interpretations. What do we know? What data is missing? What questions do we need answered?',
  red: 'FEELINGS: Share gut feelings, emotions, and intuitions without justification. What does your instinct say? What feels right or wrong? No need to explain why.',
  black: 'CAUTION: Identify risks, weaknesses, and reasons something may fail. Be specific about dangers. What could go wrong? What are the logical flaws? Where are the vulnerabilities?',
  yellow: 'VALUE: Find benefits, value, and feasibility optimistically but logically. What are the advantages? Why could this work? What is the best-case outcome?',
  green: 'CREATIVITY: Generate new ideas, alternatives, and possibilities. No judgement. Propose modifications, variations, and entirely new approaches. Use "po" provocations freely.',
};

/** ~100 concrete nouns for random entry technique */
export const RANDOM_STIMULI: string[] = [
  'bridge', 'mirror', 'seed', 'clock', 'river', 'ladder', 'envelope', 'compass',
  'anchor', 'lantern', 'thread', 'volcano', 'puzzle', 'telescope', 'mushroom',
  'cathedral', 'iceberg', 'nest', 'waterfall', 'prism', 'anvil', 'lighthouse',
  'fossil', 'tapestry', 'pendulum', 'canyon', 'beehive', 'circuit', 'origami',
  'glacier', 'mosaic', 'windmill', 'coral', 'blueprint', 'hourglass', 'labyrinth',
  'aurora', 'root', 'constellation', 'furnace', 'kaleidoscope', 'membrane',
  'reservoir', 'scaffold', 'tide', 'valve', 'web', 'yeast', 'zipper', 'arch',
  'bamboo', 'canopy', 'delta', 'ember', 'feather', 'gateway', 'hinge', 'island',
  'junction', 'keystone', 'lens', 'magnet', 'nucleus', 'orbit', 'pillar',
  'quarry', 'ripple', 'sieve', 'threshold', 'umbrella', 'vortex', 'wheel',
  'crystal', 'drum', 'echo', 'flame', 'grove', 'harbor', 'inkwell', 'jewel',
  'knot', 'leaf', 'mountain', 'needle', 'oasis', 'parachute', 'quilt', 'rope',
  'satellite', 'tunnel', 'urn', 'vine', 'wave', 'xylophone', 'yarn', 'zenith',
  'bell', 'chimney', 'dome', 'engine', 'fountain',
];

// ============================================================================
// Helpers
// ============================================================================

function makeProjectError(operation: string): LateralError {
  return {
    error: 'PROJECT_NOT_FOUND',
    message: `Cannot ${operation}: No project context available.`,
    hint: 'Specify projectId parameter, set DECIBEL_PROJECT_ROOT env var, or run from a directory with .decibel/',
  };
}

function generateSessionId(): string {
  const now = new Date();
  const ts = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, '');
  return `LAT-${ts}`;
}

function generateEntryId(sessionId: string, technique: Technique, data: TechniqueInput): string {
  const suffix = technique === 'six_hats' ? (data as SixHatsInput).hat : '';
  return suffix ? `${sessionId}-${technique.replace('_', '-')}-${suffix}` : `${sessionId}-${technique.replace('_', '-')}-${Date.now()}`;
}

function lateralDir(resolved: ResolvedProjectPaths): string {
  return resolved.subPath('designer', 'lateral');
}

function sessionFilePath(dir: string, sessionId: string): string {
  return path.join(dir, `${sessionId}.yaml`);
}

function summaryFilePath(dir: string, sessionId: string): string {
  return path.join(dir, `${sessionId}-summary.md`);
}

function pickRandomStimulus(): string {
  return RANDOM_STIMULI[Math.floor(Math.random() * RANDOM_STIMULI.length)];
}

async function loadSession(filePath: string): Promise<LateralSession> {
  const content = await fs.readFile(filePath, 'utf-8');
  return YAML.parse(content) as LateralSession;
}

async function saveSession(filePath: string, session: LateralSession, resolved: ResolvedProjectPaths): Promise<void> {
  validateWritePath(filePath, resolved);
  await fs.writeFile(filePath, YAML.stringify(session, { lineWidth: 0 }), 'utf-8');
}

function techniquesApplied(session: LateralSession): string[] {
  const seen = new Set<string>();
  for (const entry of session.entries) {
    if (entry.technique === 'six_hats') {
      seen.add(`six_hats:${(entry.data as SixHatsInput).hat}`);
    } else {
      seen.add(entry.technique);
    }
  }
  return [...seen];
}

// ============================================================================
// Guidance Generators
// ============================================================================

function guidanceForSixHats(hat: HatColor, session: LateralSession): string {
  const hatsUsed = session.entries
    .filter(e => e.technique === 'six_hats')
    .map(e => (e.data as SixHatsInput).hat);

  const currentIndex = HAT_ORDER.indexOf(hat);
  const nextHats = HAT_ORDER.filter((h, i) => i > currentIndex && !hatsUsed.includes(h));
  const nextSuggestion = nextHats.length > 0
    ? `Suggested next hat: ${nextHats[0]} (${HAT_GUIDANCE[nextHats[0]].split(':')[0]})`
    : 'All hats explored. Consider closing with blue hat summary or applying another technique.';

  return `${HAT_GUIDANCE[hat]}\n\n${nextSuggestion}`;
}

function guidanceForProvocation(): string {
  return 'PROVOCATION recorded. Now apply "movement" — don\'t judge the Po statement, instead extract useful concepts from it. Look for: what principle is operating? What happens at the boundary? What would the world need to look like for this to make sense?';
}

function guidanceForRandomEntry(stimulus: string): string {
  return `Random stimulus: "${stimulus}". Force connections between this word and your problem. What properties does "${stimulus}" have? How do those properties relate to your design challenge? List at least 3 associations, then identify which connections open new avenues.`;
}

function guidanceForChallenge(): string {
  return 'CHALLENGE recorded. You\'ve questioned an assumption. Now explore: What designs become possible if this assumption is removed? What new constraints emerge? Consider using the "alternatives" technique to fan out from this new framing.';
}

function guidanceForAlternatives(): string {
  return 'ALTERNATIVES captured. You\'ve broadened the concept fan. Before narrowing, ask: Are there concepts at a higher abstraction level we haven\'t explored? Can any two ideas be combined? Consider applying "reversal" to your top candidate.';
}

function guidanceForReversal(): string {
  return 'REVERSAL recorded. The flipped perspective often reveals hidden assumptions. Look for insights that wouldn\'t have surfaced from the original framing. Consider: which insights from the reversal can be integrated back into the original direction?';
}

function getGuidance(technique: Technique, data: TechniqueInput, session: LateralSession, stimulus?: string): string {
  switch (technique) {
    case 'six_hats': return guidanceForSixHats((data as SixHatsInput).hat, session);
    case 'provocation': return guidanceForProvocation();
    case 'random_entry': return guidanceForRandomEntry(stimulus || (data as RandomEntryInput).stimulus || 'unknown');
    case 'challenge': return guidanceForChallenge();
    case 'alternatives': return guidanceForAlternatives();
    case 'reversal': return guidanceForReversal();
  }
}

// ============================================================================
// Core Functions
// ============================================================================

export async function startSession(
  input: StartSessionInput
): Promise<StartSessionOutput | LateralError> {
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.projectId);
  } catch {
    return makeProjectError('start lateral session');
  }

  const dir = lateralDir(resolved);
  ensureDir(dir);

  // Resume existing session
  if (input.session_id) {
    const fp = sessionFilePath(dir, input.session_id);
    try {
      const session = await loadSession(fp);
      return {
        session_id: session.session_id,
        problem: session.problem,
        status: session.status,
        techniques_applied: techniquesApplied(session),
        path: fp,
      };
    } catch {
      return {
        error: 'SESSION_NOT_FOUND',
        message: `Session ${input.session_id} not found.`,
        hint: 'Check the session_id or create a new session by providing a problem statement.',
      };
    }
  }

  // New session requires problem
  if (!input.problem) {
    return {
      error: 'MISSING_PROBLEM',
      message: 'A problem statement is required to start a new session.',
      hint: 'Provide the "problem" field describing the design challenge.',
    };
  }

  const sessionId = generateSessionId();
  const now = new Date().toISOString();

  const session: LateralSession = {
    session_id: sessionId,
    project_id: resolved.id,
    problem: input.problem,
    context: input.context,
    status: 'open',
    created_at: now,
    entries: [],
  };

  const fp = sessionFilePath(dir, sessionId);
  await saveSession(fp, session, resolved);
  log(`Lateral: Created session ${sessionId} at ${fp}`);

  return {
    session_id: sessionId,
    problem: input.problem,
    status: 'open',
    techniques_applied: [],
    path: fp,
  };
}

export async function applyTechnique(
  input: ApplyTechniqueInput
): Promise<ApplyTechniqueOutput | LateralError> {
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.projectId);
  } catch {
    return makeProjectError('apply lateral technique');
  }

  const dir = lateralDir(resolved);
  const fp = sessionFilePath(dir, input.session_id);

  let session: LateralSession;
  try {
    session = await loadSession(fp);
  } catch {
    return {
      error: 'SESSION_NOT_FOUND',
      message: `Session ${input.session_id} not found.`,
      hint: 'Start a session first with designer_lateral_session.',
    };
  }

  if (session.status === 'closed') {
    return {
      error: 'SESSION_CLOSED',
      message: `Session ${input.session_id} is already closed.`,
      hint: 'Start a new session to continue lateral thinking.',
    };
  }

  // Build technique-specific data with validation
  let data: TechniqueInput;
  let effectiveStimulus: string | undefined;
  const raw = input.input;

  switch (input.technique) {
    case 'six_hats': {
      const hat = raw.hat as string;
      if (!hat || !VALID_HATS.includes(hat as HatColor)) {
        return { error: 'INVALID_INPUT', message: `Invalid hat color. Must be one of: ${VALID_HATS.join(', ')}` };
      }
      if (!raw.thinking) {
        return { error: 'INVALID_INPUT', message: 'six_hats requires "thinking" field.' };
      }
      data = { hat: hat as HatColor, thinking: raw.thinking as string };
      break;
    }
    case 'provocation': {
      if (!raw.po_statement) return { error: 'INVALID_INPUT', message: 'provocation requires "po_statement" field.' };
      if (!raw.movement) return { error: 'INVALID_INPUT', message: 'provocation requires "movement" field.' };
      data = {
        po_statement: raw.po_statement as string,
        movement: raw.movement as string,
        insights: (raw.insights as string[]) || [],
      };
      break;
    }
    case 'random_entry': {
      effectiveStimulus = (raw.stimulus as string) || pickRandomStimulus();
      data = {
        stimulus: effectiveStimulus,
        connections: (raw.connections as string[]) || [],
        promising_leads: (raw.promising_leads as string[]) || [],
      };
      break;
    }
    case 'challenge': {
      if (!raw.assumption) return { error: 'INVALID_INPUT', message: 'challenge requires "assumption" field.' };
      if (!raw.why_exists) return { error: 'INVALID_INPUT', message: 'challenge requires "why_exists" field.' };
      if (!raw.what_if_false) return { error: 'INVALID_INPUT', message: 'challenge requires "what_if_false" field.' };
      if (!raw.alternative_framing) return { error: 'INVALID_INPUT', message: 'challenge requires "alternative_framing" field.' };
      data = {
        assumption: raw.assumption as string,
        why_exists: raw.why_exists as string,
        what_if_false: raw.what_if_false as string,
        alternative_framing: raw.alternative_framing as string,
      };
      break;
    }
    case 'alternatives': {
      if (!raw.focus) return { error: 'INVALID_INPUT', message: 'alternatives requires "focus" field.' };
      if (!raw.concept_level) return { error: 'INVALID_INPUT', message: 'alternatives requires "concept_level" field.' };
      data = {
        focus: raw.focus as string,
        concept_level: raw.concept_level as string,
        alternatives: (raw.alternatives as Array<{ idea: string; approach: string }>) || [],
      };
      break;
    }
    case 'reversal': {
      if (!raw.original) return { error: 'INVALID_INPUT', message: 'reversal requires "original" field.' };
      if (!raw.reversed) return { error: 'INVALID_INPUT', message: 'reversal requires "reversed" field.' };
      data = {
        original: raw.original as string,
        reversed: raw.reversed as string,
        insights_from_reversal: (raw.insights_from_reversal as string[]) || [],
      };
      break;
    }
  }

  const entryId = generateEntryId(input.session_id, input.technique, data);
  const entry: TechniqueEntry = {
    entry_id: entryId,
    technique: input.technique,
    timestamp: new Date().toISOString(),
    data,
  };

  session.entries.push(entry);
  await saveSession(fp, session, resolved);

  const guidance = getGuidance(input.technique, data, session, effectiveStimulus);
  log(`Lateral: Applied ${input.technique} to session ${input.session_id} (entry ${entryId})`);

  return {
    entry_id: entryId,
    recorded: true,
    guidance,
    session_progress: {
      techniques_applied: techniquesApplied(session),
      entry_count: session.entries.length,
    },
  };
}

export async function closeSession(
  input: CloseSessionInput
): Promise<CloseSessionOutput | LateralError> {
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.projectId);
  } catch {
    return makeProjectError('close lateral session');
  }

  const dir = lateralDir(resolved);
  const fp = sessionFilePath(dir, input.session_id);

  let session: LateralSession;
  try {
    session = await loadSession(fp);
  } catch {
    return {
      error: 'SESSION_NOT_FOUND',
      message: `Session ${input.session_id} not found.`,
    };
  }

  if (session.status === 'closed') {
    return {
      error: 'SESSION_ALREADY_CLOSED',
      message: `Session ${input.session_id} is already closed.`,
    };
  }

  // Update session
  session.status = 'closed';
  session.closed_at = new Date().toISOString();
  session.synthesis = input.synthesis;
  session.action_items = input.action_items;
  session.linked_to = input.link_to;

  await saveSession(fp, session, resolved);

  // Generate markdown summary
  const summaryPath = summaryFilePath(dir, input.session_id);
  const markdown = generateSummaryMarkdown(session);
  validateWritePath(summaryPath, resolved);
  await fs.writeFile(summaryPath, markdown, 'utf-8');

  // Emit provenance
  await emitCreateProvenance(
    `designer:lateral:${input.session_id}`,
    markdown,
    `Closed lateral thinking session: ${session.problem}`,
    input.projectId
  );

  log(`Lateral: Closed session ${input.session_id}, summary at ${summaryPath}`);

  return {
    session_id: input.session_id,
    path: fp,
    summary_path: summaryPath,
    techniques_applied: session.entries.length,
  };
}

// ============================================================================
// Summary Markdown Generator
// ============================================================================

function generateSummaryMarkdown(session: LateralSession): string {
  const lines: string[] = [];

  // Frontmatter
  lines.push('---');
  lines.push(`session_id: ${session.session_id}`);
  lines.push(`project_id: ${session.project_id}`);
  lines.push(`status: ${session.status}`);
  lines.push(`created_at: ${session.created_at}`);
  if (session.closed_at) lines.push(`closed_at: ${session.closed_at}`);
  lines.push(`techniques_count: ${session.entries.length}`);
  if (session.linked_to?.length) lines.push(`linked_to: [${session.linked_to.join(', ')}]`);
  lines.push('---');
  lines.push('');

  // Title
  lines.push(`# Lateral Thinking Session: ${session.session_id}`);
  lines.push('');
  lines.push(`**Problem:** ${session.problem}`);
  if (session.context) {
    lines.push('');
    lines.push(`**Context:** ${session.context}`);
  }
  lines.push('');

  // Group entries by technique
  const grouped = new Map<string, TechniqueEntry[]>();
  for (const entry of session.entries) {
    const key = entry.technique;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(entry);
  }

  for (const [technique, entries] of grouped) {
    lines.push(`## ${formatTechniqueName(technique)}`);
    lines.push('');

    for (const entry of entries) {
      lines.push(`### ${entry.entry_id}`);
      lines.push(`*${entry.timestamp}*`);
      lines.push('');
      lines.push(formatEntryData(entry));
      lines.push('');
    }
  }

  // Synthesis
  if (session.synthesis) {
    lines.push('## Synthesis');
    lines.push('');
    lines.push(session.synthesis);
    lines.push('');
  }

  // Action items
  if (session.action_items?.length) {
    lines.push('## Action Items');
    lines.push('');
    for (const item of session.action_items) {
      lines.push(`- [ ] ${item}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function formatTechniqueName(technique: string): string {
  const names: Record<string, string> = {
    six_hats: 'Six Thinking Hats',
    provocation: 'Provocation (Po)',
    random_entry: 'Random Entry',
    challenge: 'Challenge',
    alternatives: 'Alternatives (Concept Fan)',
    reversal: 'Reversal',
  };
  return names[technique] || technique;
}

function formatEntryData(entry: TechniqueEntry): string {
  const lines: string[] = [];

  switch (entry.technique) {
    case 'six_hats': {
      const d = entry.data as SixHatsInput;
      lines.push(`**Hat:** ${d.hat.toUpperCase()}`);
      lines.push('');
      lines.push(d.thinking);
      break;
    }
    case 'provocation': {
      const d = entry.data as ProvocationInput;
      lines.push(`**Po:** ${d.po_statement}`);
      lines.push('');
      lines.push(`**Movement:** ${d.movement}`);
      if (d.insights.length) {
        lines.push('');
        lines.push('**Insights:**');
        for (const i of d.insights) lines.push(`- ${i}`);
      }
      break;
    }
    case 'random_entry': {
      const d = entry.data as RandomEntryInput;
      lines.push(`**Stimulus:** ${d.stimulus}`);
      if (d.connections.length) {
        lines.push('');
        lines.push('**Connections:**');
        for (const c of d.connections) lines.push(`- ${c}`);
      }
      if (d.promising_leads.length) {
        lines.push('');
        lines.push('**Promising Leads:**');
        for (const l of d.promising_leads) lines.push(`- ${l}`);
      }
      break;
    }
    case 'challenge': {
      const d = entry.data as ChallengeInput;
      lines.push(`**Assumption:** ${d.assumption}`);
      lines.push('');
      lines.push(`**Why it exists:** ${d.why_exists}`);
      lines.push('');
      lines.push(`**What if false:** ${d.what_if_false}`);
      lines.push('');
      lines.push(`**Alternative framing:** ${d.alternative_framing}`);
      break;
    }
    case 'alternatives': {
      const d = entry.data as AlternativesInput;
      lines.push(`**Focus:** ${d.focus}`);
      lines.push(`**Concept level:** ${d.concept_level}`);
      if (d.alternatives.length) {
        lines.push('');
        for (const a of d.alternatives) {
          lines.push(`- **${a.idea}**: ${a.approach}`);
        }
      }
      break;
    }
    case 'reversal': {
      const d = entry.data as ReversalInput;
      lines.push(`**Original:** ${d.original}`);
      lines.push('');
      lines.push(`**Reversed:** ${d.reversed}`);
      if (d.insights_from_reversal.length) {
        lines.push('');
        lines.push('**Insights from reversal:**');
        for (const i of d.insights_from_reversal) lines.push(`- ${i}`);
      }
      break;
    }
  }

  return lines.join('\n');
}
