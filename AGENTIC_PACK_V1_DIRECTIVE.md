# Agentic Pack v1 — Implementation Directive

**ADR Reference:** ADR-0004  
**Date:** 2024-12-22  
**Owner:** Ben  
**Implementer:** Claude Code  

---

## Executive Summary

Implement a portable **Render Module** system in `decibel-tools-mcp` that transforms canonical agent payloads into human-parseable outputs via deterministic dialects. This is the foundation for Senken's Mother/Oracle/Avatars and future projects (Studio Max).

**Core principle:** Payload is truth. Renderer is voice. Never conflate them.

---

## Phase 1: Core Render Module (decibel-tools-mcp)

### 1.1 File Structure

Create in `decibel-tools-mcp/src/agentic/`:

```
src/agentic/
├── index.ts              # Public exports
├── payload.ts            # Canonical payload schema + validation
├── render.ts             # render(payload, dialectId) → string
├── lint.ts               # lint(text, dialectId) → LintResult
├── dialects/
│   ├── index.ts          # Dialect registry
│   ├── base.ts           # BaseDialect interface
│   ├── sensor.ts         # Sensor dialect (terse KEY=VALUE)
│   ├── analyst.ts        # Analyst dialect (hypotheses + options)
│   ├── overmind.ts       # Overmind dialect (decision + guardrails + dissent)
│   └── specialist.ts     # Specialist dialect (verdict, no emoji)
├── styles/
│   ├── ansi.ts           # ANSI color palette + channel semantics
│   └── markdown.ts       # Markdown formatting helpers
└── __tests__/
    ├── payload.test.ts
    ├── render.test.ts
    └── lint.test.ts
```

### 1.2 Canonical Payload Schema

**File:** `src/agentic/payload.ts`

```typescript
import { z } from 'zod';

// Capability roles (non-letter naming to avoid acronym collision)
export const CapabilityRole = z.enum(['Sensor', 'Analyst', 'Overmind', 'Specialist']);
export type CapabilityRole = z.infer<typeof CapabilityRole>;

// System status
export const SystemStatus = z.enum(['OK', 'DEGRADED', 'BLOCKED', 'ALERT']);
export type SystemStatus = z.infer<typeof SystemStatus>;

// System load (maps to header emoji: ✅ ⚠️ 🛑)
export const SystemLoad = z.enum(['GREEN', 'YELLOW', 'RED']);
export type SystemLoad = z.infer<typeof SystemLoad>;

// Confidence level
export const ConfidenceLevel = z.enum(['Low', 'Medium', 'High']);
export type ConfidenceLevel = z.infer<typeof ConfidenceLevel>;

// Evidence item
export const Evidence = z.object({
  key: z.string(),
  value: z.string(),
  source: z.string().optional(),
});

// Option (for Analyst role)
export const Option = z.object({
  name: z.string(),
  tradeoffs: z.string(),
  steps: z.string().optional(),
});

// Specialist IDs (extensible per project)
export const SpecialistId = z.string().regex(/^avatar\.[a-z_]+$/);

// Pack metadata
export const PackMetadata = z.object({
  pack_id: z.string(),
  pack_hash: z.string().optional(),
  renderer_id: z.string(),
  specialist_id: SpecialistId.optional(),
  time_budget_ms: z.number().optional(),
});

// Canonical Agent Payload
export const AgentPayload = z.object({
  // Identity
  role: CapabilityRole,
  title: z.string(),
  
  // Status
  status: SystemStatus,
  load: SystemLoad,
  
  // Evidence & gaps
  evidence: z.array(Evidence),
  missing_data: z.array(z.string()),
  confidence: ConfidenceLevel,
  
  // Analyst fields (optional)
  observation: z.string().optional(),
  hypotheses: z.array(z.string()).optional(),
  options: z.array(Option).optional(),
  
  // Overmind/Specialist fields (optional)
  decision: z.string().optional(),
  guardrails: z.array(z.string()).optional(),
  risks: z.array(z.string()).optional(),
  next_steps: z.array(z.string()).optional(),
  dissent_summary: z.array(z.string()).optional(),
  
  // Specialist verdict (for Guardian/Advisor/Strategist)
  verdict: z.enum(['SUPPORT', 'OPPOSE', 'NEEDS_DATA', 'DEFER']).optional(),
  kill_switch_conditions: z.array(z.string()).optional(),
  required_telemetry: z.array(z.string()).optional(),
  minimal_safe_next_step: z.string().optional(),
  
  // Metadata
  metadata: PackMetadata,
});

export type AgentPayload = z.infer<typeof AgentPayload>;

// Validation helper
export function validatePayload(data: unknown): { success: true; payload: AgentPayload } | { success: false; errors: z.ZodError } {
  const result = AgentPayload.safeParse(data);
  if (result.success) {
    return { success: true, payload: result.data };
  }
  return { success: false, errors: result.error };
}

// Role-specific validation (ensure required fields for role)
export function validateRoleRequirements(payload: AgentPayload): string[] {
  const errors: string[] = [];
  
  switch (payload.role) {
    case 'Overmind':
      if (!payload.decision) errors.push('Overmind requires decision');
      if (!payload.guardrails?.length) errors.push('Overmind requires guardrails');
      if (!payload.dissent_summary?.length) errors.push('Overmind requires dissent_summary');
      break;
    case 'Analyst':
      if (!payload.observation) errors.push('Analyst requires observation');
      break;
    case 'Specialist':
      if (!payload.verdict) errors.push('Specialist requires verdict');
      if (!payload.metadata.specialist_id) errors.push('Specialist requires metadata.specialist_id');
      if (payload.verdict === 'OPPOSE') {
        if (!payload.kill_switch_conditions?.length) errors.push('OPPOSE verdict requires kill_switch_conditions');
        if (!payload.minimal_safe_next_step) errors.push('OPPOSE verdict requires minimal_safe_next_step');
      }
      break;
  }
  
  return errors;
}
```

### 1.3 ANSI Style Spec

**File:** `src/agentic/styles/ansi.ts`

```typescript
// ANSI color codes
export const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  
  // Foreground
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  
  // Bright foreground
  brightRed: '\x1b[91m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightCyan: '\x1b[96m',
  
  // Background
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
} as const;

/**
 * Channel semantics — colors indicate meaning, not emotion.
 * Design rule: palette is small, channels are consistent.
 */
export const Channel = {
  // Instrumented facts / tool output
  TOOL: `${ANSI.yellow}`,         // AMBER — matches existing tool output convention
  
  // Evidence blocks
  EVIDENCE: `${ANSI.cyan}`,       // CYAN — data, facts
  
  // Decision / action
  DECISION: `${ANSI.green}`,      // GREEN — go signal
  ACTION: `${ANSI.brightGreen}`,  // BRIGHT GREEN — active step
  
  // Block / veto / unsafe
  BLOCK: `${ANSI.red}`,           // RED — stop
  VETO: `${ANSI.bgRed}${ANSI.white}`, // RED BG — critical block
  
  // Missing / uncertainty
  MISSING: `${ANSI.dim}${ANSI.yellow}`, // DIM YELLOW — gaps
  UNCERTAINTY: `${ANSI.dim}`,     // DIM — low confidence
  
  // Metadata / signature
  META: `${ANSI.dim}`,            // DIM/GRAY — de-emphasized
  
  // Headers by load
  LOAD_GREEN: `${ANSI.green}`,
  LOAD_YELLOW: `${ANSI.yellow}`,
  LOAD_RED: `${ANSI.red}`,
} as const;

// Load emoji (header only, max 1)
export const LoadEmoji = {
  GREEN: '✅',
  YELLOW: '⚠️',
  RED: '🛑',
} as const;

// Apply channel styling
export function styled(text: string, channel: keyof typeof Channel): string {
  return `${Channel[channel]}${text}${ANSI.reset}`;
}

// Get load indicator
export function loadIndicator(load: 'GREEN' | 'YELLOW' | 'RED', useAnsi: boolean = true): string {
  if (useAnsi) {
    return styled(LoadEmoji[load], `LOAD_${load}` as keyof typeof Channel);
  }
  return LoadEmoji[load];
}
```

### 1.4 Base Dialect Interface

**File:** `src/agentic/dialects/base.ts`

```typescript
import { AgentPayload, SystemLoad } from '../payload';

export interface RenderOptions {
  ansi: boolean;           // Apply ANSI colors
  maxWidth: number;        // Max line width (for wrapping)
  compression: 'minimal' | 'standard' | 'verbose';
}

export const defaultRenderOptions: RenderOptions = {
  ansi: true,
  maxWidth: 100,
  compression: 'standard',
};

export interface LintRule {
  id: string;
  description: string;
  check: (text: string, payload?: AgentPayload) => boolean;
  severity: 'error' | 'warning';
}

export interface LintResult {
  valid: boolean;
  errors: Array<{ rule: string; message: string }>;
  warnings: Array<{ rule: string; message: string }>;
}

/**
 * Base dialect interface.
 * 
 * Dialects are deterministic formatters that:
 * - Enforce compression limits
 * - Define typography (telemetry blocks, checklists, structured markdown)
 * - Define permitted emoji usage
 * - Enforce required sections/fields
 * - Optionally strip hype (especially under RED/BLOCKED)
 * 
 * CRITICAL: Dialects change semiotics, never meaning.
 */
export interface Dialect {
  id: string;
  role: 'Sensor' | 'Analyst' | 'Overmind' | 'Specialist';
  version: string;
  
  /**
   * Render payload to formatted text.
   * Pure function: same payload + options = same output.
   */
  render(payload: AgentPayload, options?: Partial<RenderOptions>): string;
  
  /**
   * Lint rules for this dialect.
   */
  lintRules: LintRule[];
  
  /**
   * Validate rendered output against dialect rules.
   */
  lint(text: string, payload?: AgentPayload): LintResult;
}

/**
 * Abstract base with common functionality.
 */
export abstract class BaseDialect implements Dialect {
  abstract id: string;
  abstract role: 'Sensor' | 'Analyst' | 'Overmind' | 'Specialist';
  abstract version: string;
  abstract lintRules: LintRule[];
  
  abstract render(payload: AgentPayload, options?: Partial<RenderOptions>): string;
  
  lint(text: string, payload?: AgentPayload): LintResult {
    const errors: Array<{ rule: string; message: string }> = [];
    const warnings: Array<{ rule: string; message: string }> = [];
    
    for (const rule of this.lintRules) {
      const passed = rule.check(text, payload);
      if (!passed) {
        const entry = { rule: rule.id, message: rule.description };
        if (rule.severity === 'error') {
          errors.push(entry);
        } else {
          warnings.push(entry);
        }
      }
    }
    
    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }
  
  // Shared helpers
  protected formatEvidence(evidence: AgentPayload['evidence'], ansi: boolean): string {
    return evidence
      .map(e => {
        const line = `${e.key}=${e.value}`;
        return ansi ? styled(line, 'EVIDENCE') : line;
      })
      .join('\n');
  }
  
  protected formatMissingData(missing: string[], ansi: boolean): string {
    if (!missing.length) return '';
    const lines = missing.map(m => `  • ${m}`).join('\n');
    const block = `MISSING:\n${lines}`;
    return ansi ? styled(block, 'MISSING') : block;
  }
  
  protected formatMetaSignature(metadata: AgentPayload['metadata'], ansi: boolean): string {
    const sig = `[${metadata.pack_id} | ${metadata.renderer_id}]`;
    return ansi ? styled(sig, 'META') : sig;
  }
}

// Import styled from ansi
import { styled } from '../styles/ansi';
```

### 1.5 Sensor Dialect

**File:** `src/agentic/dialects/sensor.ts`

```typescript
import { BaseDialect, RenderOptions, LintRule, defaultRenderOptions } from './base';
import { AgentPayload } from '../payload';
import { loadIndicator, styled } from '../styles/ansi';

/**
 * Sensor Dialect: Detection/flagging/triage.
 * 
 * Characteristics:
 * - Terse KEY=VALUE evidence lines
 * - Minimal narrative
 * - NEXT action always present
 * - Fast parsing for operators
 */
export class SensorDialect extends BaseDialect {
  id = 'sensor_v1';
  role = 'Sensor' as const;
  version = '1.0.0';
  
  lintRules: LintRule[] = [
    {
      id: 'sensor-has-next',
      description: 'Sensor output must include NEXT action',
      severity: 'error',
      check: (text) => /NEXT[:=]/i.test(text),
    },
    {
      id: 'sensor-no-narrative',
      description: 'Sensor should avoid narrative prose (max 1 sentence observation)',
      severity: 'warning',
      check: (text) => {
        const lines = text.split('\n').filter(l => !l.startsWith('#') && l.trim());
        const proseLines = lines.filter(l => !l.includes('=') && l.length > 80);
        return proseLines.length <= 1;
      },
    },
    {
      id: 'sensor-max-emoji',
      description: 'Sensor allows max 1 emoji (load indicator only)',
      severity: 'error',
      check: (text) => {
        const emojiCount = (text.match(/[\u{1F300}-\u{1F9FF}]/gu) || []).length;
        return emojiCount <= 1;
      },
    },
  ];
  
  render(payload: AgentPayload, options?: Partial<RenderOptions>): string {
    const opts = { ...defaultRenderOptions, ...options };
    const lines: string[] = [];
    
    // Header with load indicator
    const indicator = loadIndicator(payload.load, opts.ansi);
    lines.push(`${indicator} ${payload.title}`);
    lines.push('');
    
    // Status line
    const statusLine = `STATUS=${payload.status} LOAD=${payload.load} CONF=${payload.confidence}`;
    lines.push(opts.ansi ? styled(statusLine, 'TOOL') : statusLine);
    lines.push('');
    
    // Evidence as KEY=VALUE
    if (payload.evidence.length) {
      lines.push(this.formatEvidence(payload.evidence, opts.ansi));
      lines.push('');
    }
    
    // Missing data
    if (payload.missing_data.length) {
      lines.push(this.formatMissingData(payload.missing_data, opts.ansi));
      lines.push('');
    }
    
    // Observation (brief)
    if (payload.observation) {
      lines.push(payload.observation);
      lines.push('');
    }
    
    // NEXT action (required)
    const nextAction = payload.next_steps?.[0] || 'AWAIT_OPERATOR';
    const nextLine = `NEXT=${nextAction}`;
    lines.push(opts.ansi ? styled(nextLine, 'ACTION') : nextLine);
    
    // Meta signature
    lines.push('');
    lines.push(this.formatMetaSignature(payload.metadata, opts.ansi));
    
    return lines.join('\n');
  }
}
```

### 1.6 Overmind Dialect

**File:** `src/agentic/dialects/overmind.ts`

```typescript
import { BaseDialect, RenderOptions, LintRule, defaultRenderOptions } from './base';
import { AgentPayload } from '../payload';
import { loadIndicator, styled, ANSI } from '../styles/ansi';

/**
 * Overmind Dialect: Orchestrates Specialists, decides with guardrails.
 * 
 * Required outputs:
 * - Decision
 * - Guardrails (stop conditions + monitoring)
 * - Dissent summary (1-3 bullets)
 */
export class OvermindDialect extends BaseDialect {
  id = 'overmind_decision_v1';
  role = 'Overmind' as const;
  version = '1.0.0';
  
  lintRules: LintRule[] = [
    {
      id: 'overmind-has-decision',
      description: 'Overmind must include DECISION section',
      severity: 'error',
      check: (text) => /DECISION|Decision:/i.test(text),
    },
    {
      id: 'overmind-has-guardrails',
      description: 'Overmind must include GUARDRAILS section',
      severity: 'error',
      check: (text) => /GUARDRAILS|Guardrails:/i.test(text),
    },
    {
      id: 'overmind-has-dissent',
      description: 'Overmind must include DISSENT section',
      severity: 'error',
      check: (text) => /DISSENT|Dissent:/i.test(text),
    },
    {
      id: 'overmind-max-emoji',
      description: 'Overmind allows max 1 emoji (load indicator only)',
      severity: 'error',
      check: (text) => {
        const emojiCount = (text.match(/[\u{1F300}-\u{1F9FF}]/gu) || []).length;
        return emojiCount <= 1;
      },
    },
    {
      id: 'overmind-no-hype',
      description: 'Overmind should avoid hype words under YELLOW/RED',
      severity: 'warning',
      check: (text, payload) => {
        if (!payload || payload.load === 'GREEN') return true;
        const hypeWords = /amazing|incredible|fantastic|awesome|perfect|absolutely/i;
        return !hypeWords.test(text);
      },
    },
  ];
  
  render(payload: AgentPayload, options?: Partial<RenderOptions>): string {
    const opts = { ...defaultRenderOptions, ...options };
    const lines: string[] = [];
    
    // Header with load indicator
    const indicator = loadIndicator(payload.load, opts.ansi);
    lines.push(`${indicator} ${payload.title}`);
    lines.push(`Status: ${payload.status} | Confidence: ${payload.confidence}`);
    lines.push('');
    
    // Observation
    if (payload.observation) {
      lines.push(payload.observation);
      lines.push('');
    }
    
    // Evidence summary (condensed for Overmind)
    if (payload.evidence.length && opts.compression !== 'minimal') {
      lines.push('Evidence:');
      for (const e of payload.evidence.slice(0, 5)) {
        const line = `  ${e.key}: ${e.value}`;
        lines.push(opts.ansi ? styled(line, 'EVIDENCE') : line);
      }
      lines.push('');
    }
    
    // DECISION (required, prominent)
    if (payload.decision) {
      const decisionHeader = 'DECISION:';
      lines.push(opts.ansi ? styled(decisionHeader, 'DECISION') : decisionHeader);
      lines.push(payload.decision);
      lines.push('');
    }
    
    // GUARDRAILS (required)
    if (payload.guardrails?.length) {
      lines.push('GUARDRAILS:');
      for (const g of payload.guardrails) {
        lines.push(`  • ${g}`);
      }
      lines.push('');
    }
    
    // RISKS
    if (payload.risks?.length) {
      lines.push('Risks:');
      for (const r of payload.risks) {
        const line = `  • ${r}`;
        lines.push(opts.ansi ? styled(line, 'MISSING') : line);
      }
      lines.push('');
    }
    
    // Missing data
    if (payload.missing_data.length) {
      lines.push(this.formatMissingData(payload.missing_data, opts.ansi));
      lines.push('');
    }
    
    // DISSENT (required, 1-3 bullets)
    if (payload.dissent_summary?.length) {
      lines.push('DISSENT:');
      for (const d of payload.dissent_summary.slice(0, 3)) {
        lines.push(`  → ${d}`);
      }
      lines.push('');
    }
    
    // Meta signature
    lines.push(this.formatMetaSignature(payload.metadata, opts.ansi));
    
    return lines.join('\n');
  }
}
```

### 1.7 Specialist Dialect

**File:** `src/agentic/dialects/specialist.ts`

```typescript
import { BaseDialect, RenderOptions, LintRule, defaultRenderOptions } from './base';
import { AgentPayload } from '../payload';
import { styled } from '../styles/ansi';

/**
 * Specialist Dialect: Domain lens outputs (Guardian/Advisor/Strategist).
 * 
 * Characteristics:
 * - NO EMOJI (ever)
 * - Begins with verdict-like header
 * - Guardian OPPOSE triggers kill_switch output
 */
export class SpecialistDialect extends BaseDialect {
  id = 'specialist_v1';
  role = 'Specialist' as const;
  version = '1.0.0';
  
  lintRules: LintRule[] = [
    {
      id: 'specialist-no-emoji',
      description: 'Specialists must not use emoji',
      severity: 'error',
      check: (text) => {
        const emojiCount = (text.match(/[\u{1F300}-\u{1F9FF}]/gu) || []).length;
        return emojiCount === 0;
      },
    },
    {
      id: 'specialist-has-verdict',
      description: 'Specialist must begin with verdict',
      severity: 'error',
      check: (text) => /^(SUPPORT|OPPOSE|NEEDS_DATA|DEFER)/i.test(text.trim()),
    },
    {
      id: 'specialist-oppose-has-killswitch',
      description: 'OPPOSE verdict must include kill_switch_conditions',
      severity: 'error',
      check: (text, payload) => {
        if (!payload || payload.verdict !== 'OPPOSE') return true;
        return /kill.?switch|KILL_SWITCH/i.test(text);
      },
    },
  ];
  
  render(payload: AgentPayload, options?: Partial<RenderOptions>): string {
    const opts = { ...defaultRenderOptions, ...options };
    const lines: string[] = [];
    
    // Extract specialist name from ID (avatar.guardian → Guardian)
    const specialistName = payload.metadata.specialist_id
      ?.replace('avatar.', '')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase()) || 'Specialist';
    
    // Verdict header (no emoji!)
    const verdict = payload.verdict || 'DEFER';
    const verdictLine = `${verdict} — ${specialistName}: ${payload.title}`;
    
    if (opts.ansi) {
      const channel = verdict === 'OPPOSE' ? 'VETO' : 
                      verdict === 'SUPPORT' ? 'DECISION' :
                      verdict === 'NEEDS_DATA' ? 'MISSING' : 'META';
      lines.push(styled(verdictLine, channel));
    } else {
      lines.push(verdictLine);
    }
    lines.push('');
    
    // Observation/rationale
    if (payload.observation) {
      lines.push(payload.observation);
      lines.push('');
    }
    
    // For OPPOSE: Kill switch conditions (required)
    if (verdict === 'OPPOSE') {
      lines.push('KILL_SWITCH_CONDITIONS:');
      for (const k of payload.kill_switch_conditions || []) {
        const line = `  ✗ ${k}`;
        lines.push(opts.ansi ? styled(line, 'BLOCK') : line);
      }
      lines.push('');
      
      if (payload.required_telemetry?.length) {
        lines.push('REQUIRED_TELEMETRY:');
        for (const t of payload.required_telemetry) {
          lines.push(`  • ${t}`);
        }
        lines.push('');
      }
      
      if (payload.minimal_safe_next_step) {
        const safeLine = `MINIMAL_SAFE_STEP: ${payload.minimal_safe_next_step}`;
        lines.push(opts.ansi ? styled(safeLine, 'ACTION') : safeLine);
        lines.push('');
      }
    }
    
    // For NEEDS_DATA: Missing data
    if (verdict === 'NEEDS_DATA' && payload.missing_data.length) {
      lines.push('REQUIRED_DATA:');
      for (const m of payload.missing_data) {
        lines.push(`  ? ${m}`);
      }
      lines.push('');
    }
    
    // Evidence (brief)
    if (payload.evidence.length && opts.compression === 'verbose') {
      lines.push('Evidence:');
      lines.push(this.formatEvidence(payload.evidence, opts.ansi));
      lines.push('');
    }
    
    // Guardrails (if SUPPORT)
    if (verdict === 'SUPPORT' && payload.guardrails?.length) {
      lines.push('Conditions:');
      for (const g of payload.guardrails) {
        lines.push(`  • ${g}`);
      }
      lines.push('');
    }
    
    // Meta signature
    lines.push(this.formatMetaSignature(payload.metadata, opts.ansi));
    
    return lines.join('\n');
  }
}
```

### 1.8 Dialect Registry & Render Function

**File:** `src/agentic/dialects/index.ts`

```typescript
import { Dialect } from './base';
import { SensorDialect } from './sensor';
import { OvermindDialect } from './overmind';
import { SpecialistDialect } from './specialist';
// import { AnalystDialect } from './analyst'; // TODO: implement

// Built-in dialects
const builtInDialects: Record<string, Dialect> = {
  sensor_v1: new SensorDialect(),
  overmind_decision_v1: new OvermindDialect(),
  specialist_v1: new SpecialistDialect(),
};

// Custom dialect registry (for project-specific dialects)
const customDialects: Record<string, Dialect> = {};

export function registerDialect(dialect: Dialect): void {
  customDialects[dialect.id] = dialect;
}

export function getDialect(id: string): Dialect | undefined {
  return customDialects[id] || builtInDialects[id];
}

export function listDialects(): string[] {
  return [...Object.keys(builtInDialects), ...Object.keys(customDialects)];
}

// Resolve dialect from payload
export function resolveDialect(payload: { role: string; metadata: { renderer_id?: string; specialist_id?: string } }): Dialect | undefined {
  // Explicit renderer_id takes precedence
  if (payload.metadata.renderer_id) {
    const explicit = getDialect(payload.metadata.renderer_id);
    if (explicit) return explicit;
  }
  
  // Specialist with specialist_id → specialist dialect
  if (payload.role === 'Specialist' && payload.metadata.specialist_id) {
    return getDialect('specialist_v1');
  }
  
  // Fall back to role-based default
  const roleDefaults: Record<string, string> = {
    Sensor: 'sensor_v1',
    Analyst: 'analyst_v1',
    Overmind: 'overmind_decision_v1',
    Specialist: 'specialist_v1',
  };
  
  return getDialect(roleDefaults[payload.role]);
}
```

**File:** `src/agentic/render.ts`

```typescript
import { AgentPayload, validatePayload, validateRoleRequirements } from './payload';
import { resolveDialect, getDialect } from './dialects';
import { RenderOptions, defaultRenderOptions, LintResult } from './dialects/base';

export interface RenderResult {
  success: boolean;
  output?: string;
  dialectId?: string;
  errors?: string[];
}

/**
 * Render a canonical payload using the appropriate dialect.
 * 
 * Pure function: same payload + options = same output.
 */
export function render(
  payload: AgentPayload,
  options?: Partial<RenderOptions> & { dialectId?: string }
): RenderResult {
  // Validate payload
  const validation = validatePayload(payload);
  if (!validation.success) {
    return {
      success: false,
      errors: validation.errors.issues.map(i => `${i.path.join('.')}: ${i.message}`),
    };
  }
  
  // Validate role requirements
  const roleErrors = validateRoleRequirements(payload);
  if (roleErrors.length) {
    return {
      success: false,
      errors: roleErrors,
    };
  }
  
  // Resolve dialect
  const dialect = options?.dialectId 
    ? getDialect(options.dialectId)
    : resolveDialect(payload);
    
  if (!dialect) {
    return {
      success: false,
      errors: [`No dialect found for role=${payload.role}, renderer_id=${payload.metadata.renderer_id}`],
    };
  }
  
  // Render
  const output = dialect.render(payload, options);
  
  return {
    success: true,
    output,
    dialectId: dialect.id,
  };
}

/**
 * Render and lint in one step.
 */
export function renderAndLint(
  payload: AgentPayload,
  options?: Partial<RenderOptions> & { dialectId?: string }
): RenderResult & { lint?: LintResult } {
  const result = render(payload, options);
  
  if (!result.success || !result.output) {
    return result;
  }
  
  const dialect = options?.dialectId 
    ? getDialect(options.dialectId)
    : resolveDialect(payload);
    
  if (!dialect) {
    return result;
  }
  
  const lint = dialect.lint(result.output, payload);
  
  return {
    ...result,
    lint,
    success: result.success && lint.valid,
    errors: [...(result.errors || []), ...lint.errors.map(e => `lint:${e.rule}: ${e.message}`)],
  };
}
```

### 1.9 Public Exports

**File:** `src/agentic/index.ts`

```typescript
// Payload schema
export {
  AgentPayload,
  CapabilityRole,
  SystemStatus,
  SystemLoad,
  ConfidenceLevel,
  Evidence,
  Option,
  PackMetadata,
  validatePayload,
  validateRoleRequirements,
} from './payload';

// Render
export { render, renderAndLint, RenderResult } from './render';

// Dialects
export { Dialect, BaseDialect, RenderOptions, LintRule, LintResult } from './dialects/base';
export { registerDialect, getDialect, listDialects, resolveDialect } from './dialects';
export { SensorDialect } from './dialects/sensor';
export { OvermindDialect } from './dialects/overmind';
export { SpecialistDialect } from './dialects/specialist';

// Styles
export { ANSI, Channel, styled, loadIndicator, LoadEmoji } from './styles/ansi';
```

---

## Phase 2: MCP Tool Integration

### 2.1 Add Render Tool

**File:** `src/tools/agentic.ts`

Add an MCP tool for rendering payloads:

```typescript
import { z } from 'zod';
import { AgentPayload, render, renderAndLint, listDialects } from '../agentic';

export const agenticTools = {
  agentic_render: {
    description: 'Render an agent payload using the appropriate dialect. Returns formatted text output.',
    parameters: z.object({
      payload: z.any().describe('Canonical agent payload (JSON)'),
      dialectId: z.string().optional().describe('Override dialect (e.g., "overmind_decision_v1")'),
      ansi: z.boolean().default(true).describe('Apply ANSI colors'),
      lint: z.boolean().default(true).describe('Run lint validation'),
    }),
    handler: async ({ payload, dialectId, ansi, lint }) => {
      if (lint) {
        return renderAndLint(payload as AgentPayload, { dialectId, ansi });
      }
      return render(payload as AgentPayload, { dialectId, ansi });
    },
  },
  
  agentic_list_dialects: {
    description: 'List available render dialects.',
    parameters: z.object({}),
    handler: async () => {
      return { dialects: listDialects() };
    },
  },
};
```

---

## Phase 3: Golden Eval Harness

### 3.1 Golden Test Structure

Create `src/agentic/__tests__/golden/`:

```
__tests__/golden/
├── weekend_trap.payload.json    # Canonical payload
├── weekend_trap.sensor.txt      # Expected Sensor output
├── weekend_trap.overmind.txt    # Expected Overmind output
├── weekend_trap.guardian.txt    # Expected Guardian output
└── runGolden.ts                 # Test runner
```

### 3.2 Golden Payload Example

**File:** `__tests__/golden/weekend_trap.payload.json`

```json
{
  "role": "Overmind",
  "title": "Weekend Regime Blindness (Cache Strategies)",
  "status": "DEGRADED",
  "load": "YELLOW",
  "evidence": [
    {"key": "entries_last_24h_short", "value": "50"},
    {"key": "entries_last_24h_long", "value": "0"},
    {"key": "is_weekend", "value": "true"},
    {"key": "cache_context_bundle", "value": "missing"}
  ],
  "missing_data": [
    "Weekend vs weekday P&L by strategy",
    "Entry burst-rate distribution by hour",
    "Recent-failure cache hit rate"
  ],
  "confidence": "Medium",
  "observation": "Cache-based strategies are firing without session/regime context, causing repeated one-sided weekend traps.",
  "decision": "Block cache-only entries unless context_bundle.present=true; degrade to safer mode on weekends.",
  "guardrails": [
    "If is_weekend==true AND context_bundle missing → no new entries",
    "Max entries per symbol per hour = 2",
    "Require recent_failed_level=false for entries"
  ],
  "risks": [
    "Reduced trade frequency short-term",
    "Possible under-trading during true breakouts"
  ],
  "dissent_summary": [
    "Strategist wants regime classifier before hard blocks",
    "Advisor prefers incremental gating"
  ],
  "metadata": {
    "pack_id": "pack.senken.operator.v1",
    "renderer_id": "overmind_decision_v1"
  }
}
```

### 3.3 Golden Test Runner

**File:** `__tests__/golden/runGolden.ts`

```typescript
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { render, getDialect } from '../../agentic';

const goldenDir = __dirname;

interface GoldenResult {
  name: string;
  dialect: string;
  passed: boolean;
  diff?: string;
}

export function runGoldenTests(): GoldenResult[] {
  const results: GoldenResult[] = [];
  
  // Find all .payload.json files
  const payloadFiles = readdirSync(goldenDir).filter(f => f.endsWith('.payload.json'));
  
  for (const payloadFile of payloadFiles) {
    const baseName = payloadFile.replace('.payload.json', '');
    const payload = JSON.parse(readFileSync(join(goldenDir, payloadFile), 'utf-8'));
    
    // Find corresponding expected outputs
    const expectedFiles = readdirSync(goldenDir).filter(
      f => f.startsWith(baseName) && f.endsWith('.txt')
    );
    
    for (const expectedFile of expectedFiles) {
      // Extract dialect from filename: weekend_trap.overmind.txt → overmind
      const dialectName = expectedFile.replace(`${baseName}.`, '').replace('.txt', '');
      const dialectId = `${dialectName}_v1`;
      
      const expected = readFileSync(join(goldenDir, expectedFile), 'utf-8').trim();
      
      // Render with ANSI disabled for comparison
      const result = render(payload, { dialectId, ansi: false });
      const actual = result.output?.trim() || '';
      
      const passed = actual === expected;
      
      results.push({
        name: baseName,
        dialect: dialectId,
        passed,
        diff: passed ? undefined : `Expected:\n${expected}\n\nActual:\n${actual}`,
      });
    }
  }
  
  return results;
}

// CLI runner
if (require.main === module) {
  const results = runGoldenTests();
  const failed = results.filter(r => !r.passed);
  
  console.log(`\nGolden Tests: ${results.length - failed.length}/${results.length} passed\n`);
  
  for (const f of failed) {
    console.log(`❌ ${f.name} (${f.dialect})`);
    console.log(f.diff);
    console.log('---');
  }
  
  process.exit(failed.length > 0 ? 1 : 0);
}
```

---

## Phase 4: Senken Integration

After core module is complete, create Senken-specific configuration:

### 4.1 Senken Agents Directory

```
senken-trading-agent/
└── .decibel/
    └── agents/
        ├── taxonomy/
        │   └── capability_roles.yaml    # Role definitions for Senken
        ├── renderers.yaml               # Senken-specific dialect config
        ├── avatars/
        │   ├── guardian.yaml            # Risk veto specialist
        │   ├── advisor.yaml             # Rollout/timing specialist  
        │   └── strategist.yaml          # Systemic strategy specialist
        ├── policies/
        │   └── consensus_policy.yaml    # Mother coordination rules
        └── evals/
            └── golden/                  # Senken-specific golden tests
```

### 4.2 Consensus Policy (Senken)

**File:** `.decibel/agents/policies/consensus_policy.yaml`

```yaml
# Consensus Policy for Mother (Overmind) coordinating Avatars (Specialists)
version: 1
overmind: mother
specialists:
  - id: avatar.guardian
    role: Risk veto authority
    weight: 0.45
    veto_power: true
  - id: avatar.advisor
    role: Rollout and timing
    weight: 0.30
    veto_power: false
  - id: avatar.strategist
    role: Systemic strategy lens
    weight: 0.25
    veto_power: false

resolution:
  # Guardian veto overrides all
  - if: guardian.verdict == OPPOSE
    then:
      status: BLOCKED
      required_outputs:
        - kill_switch_conditions
        - required_telemetry
        - minimal_safe_next_step

  # Majority NEEDS_DATA → degraded
  - if: count(verdict == NEEDS_DATA) >= 2
    then:
      status: DEGRADED
      action: COLLECT_DATA_FIRST

  # Otherwise weighted vote
  - else:
      method: weighted_sum
      threshold: 0.6  # 60% support to proceed
```

---

## Success Criteria

1. **Core module builds and passes tests** in decibel-tools-mcp
2. **Golden eval passes** for weekend_trap payload across dialects
3. **Lint catches violations**: no-emoji for Specialist, required sections for Overmind
4. **MCP tool works**: `agentic_render` callable from Claude
5. **ANSI output is readable** in terminal
6. **Non-ANSI output** (ansi: false) is clean markdown

---

## Notes for CC

- **Do not modify existing tools/oracle.ts or tools/sentinel.ts** — this is additive
- **Zod for validation** — already a dependency
- **Test with real Mother output** once base is working
- **Start with Sensor and Overmind** — Analyst can come later
- **Keep dialects pure** — no side effects, no async

Questions? Tag Ben.
