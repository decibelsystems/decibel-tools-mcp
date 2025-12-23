/**
 * Agentic Pack Linter
 *
 * Validates rendered output against dialect constraints.
 * Ensures semiotic clarity and consistency.
 */

import { log } from '../config.js';
import {
  LintResult,
  LintViolation,
  LintSeverity,
  RendererConfig,
  CanonicalPayload,
  CompiledPack,
  LintInput,
  LintOutputResult,
} from './types.js';
import { resolveProjectPaths } from '../projectRegistry.js';
import { getOrCompilePack } from './compiler.js';

// ============================================================================
// Lint Rules
// ============================================================================

interface LintRule {
  id: string;
  severity: LintSeverity;
  check: (
    rendered: string,
    renderer: RendererConfig,
    payload?: CanonicalPayload
  ) => LintViolation | null;
}

/**
 * Count emojis in text
 */
function countEmojis(text: string): number {
  const emojiRegex =
    /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]/gu;
  const matches = text.match(emojiRegex);
  return matches ? matches.length : 0;
}

/**
 * Find emoji positions in text
 */
function findEmojiPositions(text: string): Array<{ index: number; line: number; column: number }> {
  const positions: Array<{ index: number; line: number; column: number }> = [];
  const emojiRegex =
    /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]/gu;

  let match;
  while ((match = emojiRegex.exec(text)) !== null) {
    const beforeMatch = text.substring(0, match.index);
    const lines = beforeMatch.split('\n');
    positions.push({
      index: match.index,
      line: lines.length,
      column: lines[lines.length - 1].length + 1,
    });
  }

  return positions;
}

const LINT_RULES: LintRule[] = [
  // Emoji count rule
  {
    id: 'max-emoji-count',
    severity: 'error',
    check: (rendered, renderer) => {
      const max = renderer.constraints.max_emoji_count;
      if (max === undefined) return null;

      const count = countEmojis(rendered);
      if (count > max) {
        return {
          rule: 'max-emoji-count',
          severity: 'error',
          message: `Emoji count (${count}) exceeds maximum (${max})`,
          suggestion: `Reduce emoji usage to ${max} or fewer`,
        };
      }
      return null;
    },
  },

  // Emoji position rule
  {
    id: 'emoji-position',
    severity: 'warning',
    check: (rendered, renderer) => {
      const position = renderer.constraints.emoji_position;
      if (!position || position === 'anywhere') return null;

      const emojiPositions = findEmojiPositions(rendered);
      if (emojiPositions.length === 0) return null;

      if (position === 'none') {
        return {
          rule: 'emoji-position',
          severity: 'warning',
          message: 'Emojis are not allowed in this renderer',
          line: emojiPositions[0].line,
          column: emojiPositions[0].column,
          suggestion: 'Remove all emojis from output',
        };
      }

      if (position === 'header-only') {
        // Emojis should only be on the first line
        const nonHeaderEmojis = emojiPositions.filter((p) => p.line > 1);
        if (nonHeaderEmojis.length > 0) {
          return {
            rule: 'emoji-position',
            severity: 'warning',
            message: 'Emojis found outside header (first line)',
            line: nonHeaderEmojis[0].line,
            column: nonHeaderEmojis[0].column,
            suggestion: 'Move emojis to the header line only',
          };
        }
      }

      return null;
    },
  },

  // Max lines rule
  {
    id: 'max-lines',
    severity: 'warning',
    check: (rendered, renderer) => {
      const max = renderer.constraints.max_lines;
      if (max === undefined) return null;

      const lineCount = rendered.split('\n').length;
      if (lineCount > max) {
        return {
          rule: 'max-lines',
          severity: 'warning',
          message: `Line count (${lineCount}) exceeds maximum (${max})`,
          suggestion: `Condense output to ${max} lines or fewer`,
        };
      }
      return null;
    },
  },

  // Banned words rule
  {
    id: 'banned-words',
    severity: 'error',
    check: (rendered, renderer) => {
      const banned = renderer.constraints.banned_words;
      if (!banned || banned.length === 0) return null;

      const lowerRendered = rendered.toLowerCase();
      for (const word of banned) {
        const index = lowerRendered.indexOf(word.toLowerCase());
        if (index !== -1) {
          const beforeMatch = rendered.substring(0, index);
          const lines = beforeMatch.split('\n');
          return {
            rule: 'banned-words',
            severity: 'error',
            message: `Banned word "${word}" found in output`,
            line: lines.length,
            column: lines[lines.length - 1].length + 1,
            suggestion: `Remove or replace the word "${word}"`,
          };
        }
      }
      return null;
    },
  },

  // Banned punctuation rule
  {
    id: 'banned-punctuation',
    severity: 'warning',
    check: (rendered, renderer) => {
      const banned = renderer.constraints.banned_punctuation;
      if (!banned || banned.length === 0) return null;

      for (const punct of banned) {
        const index = rendered.indexOf(punct);
        if (index !== -1) {
          const beforeMatch = rendered.substring(0, index);
          const lines = beforeMatch.split('\n');
          return {
            rule: 'banned-punctuation',
            severity: 'warning',
            message: `Banned punctuation "${punct}" found in output`,
            line: lines.length,
            column: lines[lines.length - 1].length + 1,
            suggestion: `Remove or replace "${punct}"`,
          };
        }
      }
      return null;
    },
  },

  // Required sections rule
  {
    id: 'required-sections',
    severity: 'error',
    check: (rendered, renderer) => {
      const required = renderer.constraints.required_sections;
      if (!required || required.length === 0) return null;

      for (const section of required) {
        // Look for section headers in various formats
        const patterns = [
          new RegExp(`^##?\\s*${section}`, 'im'), // Markdown headers
          new RegExp(`^${section}:`, 'im'), // Key: format
          new RegExp(`\\[${section}\\]`, 'i'), // [Section] format
        ];

        const found = patterns.some((p) => p.test(rendered));
        if (!found) {
          return {
            rule: 'required-sections',
            severity: 'error',
            message: `Required section "${section}" not found`,
            suggestion: `Add a "${section}" section to the output`,
          };
        }
      }
      return null;
    },
  },

  // Max section lines rule
  {
    id: 'max-section-lines',
    severity: 'info',
    check: (rendered, renderer) => {
      const max = renderer.constraints.max_section_lines;
      if (max === undefined) return null;

      // Split by section headers and check each
      const sections = rendered.split(/^(?=##?\s|\[)/m);
      for (let i = 0; i < sections.length; i++) {
        const section = sections[i];
        const lineCount = section.split('\n').length;
        if (lineCount > max) {
          return {
            rule: 'max-section-lines',
            severity: 'info',
            message: `Section ${i + 1} has ${lineCount} lines (max: ${max})`,
            suggestion: 'Consider condensing this section',
          };
        }
      }
      return null;
    },
  },

  // Payload consistency checks
  {
    id: 'missing-decision',
    severity: 'warning',
    check: (rendered, _renderer, payload) => {
      if (!payload) return null;
      if (payload.role !== 'Overmind') return null;
      if (!payload.decision) return null;

      // Check if decision is reflected in output
      const hasDecision =
        rendered.toLowerCase().includes('decision') ||
        rendered.includes(payload.decision.toLowerCase());

      if (!hasDecision) {
        return {
          rule: 'missing-decision',
          severity: 'warning',
          message: 'Overmind payload has decision but output may not reflect it',
          suggestion: 'Ensure the decision is visible in the rendered output',
        };
      }
      return null;
    },
  },

  // Evidence check
  {
    id: 'missing-evidence',
    severity: 'info',
    check: (rendered, _renderer, payload) => {
      if (!payload) return null;
      if (payload.evidence.length === 0) return null;

      const hasEvidence =
        rendered.toLowerCase().includes('evidence') ||
        payload.evidence.some((e) =>
          rendered.toLowerCase().includes(e.source.toLowerCase())
        );

      if (!hasEvidence) {
        return {
          rule: 'missing-evidence',
          severity: 'info',
          message: 'Payload has evidence but output may not include it',
          suggestion: 'Consider including evidence sources in output',
        };
      }
      return null;
    },
  },
];

// ============================================================================
// Core Lint Function
// ============================================================================

/**
 * Lint rendered output against renderer constraints.
 */
export function lint(
  rendered: string,
  renderer: RendererConfig,
  payload?: CanonicalPayload
): LintResult {
  const violations: LintViolation[] = [];

  for (const rule of LINT_RULES) {
    const violation = rule.check(rendered, renderer, payload);
    if (violation) {
      violations.push(violation);
    }
  }

  return {
    valid: violations.filter((v) => v.severity === 'error').length === 0,
    violations,
    renderer_id: renderer.id,
    checked_at: new Date().toISOString(),
  };
}

/**
 * Lint with just the renderer ID (loads from pack)
 */
export function lintWithPack(
  rendered: string,
  rendererId: string,
  pack: CompiledPack,
  payload?: CanonicalPayload
): LintResult {
  const renderer = pack.renderers[rendererId] || pack.renderers['default'];
  if (!renderer) {
    return {
      valid: false,
      violations: [
        {
          rule: 'renderer-not-found',
          severity: 'error',
          message: `Renderer '${rendererId}' not found`,
        },
      ],
      renderer_id: rendererId,
      checked_at: new Date().toISOString(),
    };
  }

  return lint(rendered, renderer, payload);
}

// ============================================================================
// MCP Tool Handler
// ============================================================================

/**
 * MCP tool handler for linting rendered output
 */
export async function lintOutput(input: LintInput): Promise<LintOutputResult> {
  try {
    const resolved = resolveProjectPaths(input.projectId);
    const pack = await getOrCompilePack(resolved);

    log(`agentic-linter: Linting output for renderer '${input.renderer_id}'`);

    const result = lintWithPack(
      input.rendered,
      input.renderer_id,
      pack.content,
      input.payload
    );

    const errorCount = result.violations.filter((v) => v.severity === 'error').length;
    const warnCount = result.violations.filter((v) => v.severity === 'warning').length;

    log(
      `agentic-linter: ${result.valid ? 'PASS' : 'FAIL'} - ${errorCount} errors, ${warnCount} warnings`
    );

    return {
      status: 'linted',
      result,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`agentic-linter: Error: ${message}`);
    return {
      status: 'error',
      error: message,
    };
  }
}
