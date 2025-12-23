/**
 * Agentic Pack Renderer
 *
 * Transforms canonical payloads into rendered text using pack templates.
 * Core invariant: Renderers NEVER change meaning. They change compression, typography, and stance.
 */

import { log } from '../config.js';
import {
  CanonicalPayload,
  CompiledPack,
  RenderOutput,
  RenderTarget,
  RendererConfig,
  RenderInput,
  RenderOutputResult,
} from './types.js';
import { resolveProjectPaths } from '../projectRegistry.js';
import { getOrCompilePack } from './compiler.js';

// ============================================================================
// Template Engine
// ============================================================================

/**
 * Simple Mustache-like template engine
 * Supports: {{variable}}, {{#section}}...{{/section}}, {{^section}}...{{/section}}
 */
function renderTemplate(template: string, context: Record<string, unknown>): string {
  let result = template;

  // Handle sections: {{#section}}...{{/section}} (truthy) and {{^section}}...{{/section}} (falsy)
  const sectionRegex = /\{\{([#^])(\w+)\}\}([\s\S]*?)\{\{\/\2\}\}/g;
  result = result.replace(sectionRegex, (_, type, key, content) => {
    const value = context[key];
    const isTruthy = Array.isArray(value) ? value.length > 0 : Boolean(value);

    if (type === '#') {
      // Truthy section
      if (!isTruthy) return '';
      if (Array.isArray(value)) {
        // Iterate over array
        return value
          .map((item) => {
            const itemContext =
              typeof item === 'object' ? { ...context, ...item } : { ...context, item };
            return renderTemplate(content, itemContext);
          })
          .join('');
      }
      return renderTemplate(content, context);
    } else {
      // Falsy section (^)
      return isTruthy ? '' : renderTemplate(content, context);
    }
  });

  // Handle nested items: {{#items}}...{{/items}}
  const itemsRegex = /\{\{#items\}\}([\s\S]*?)\{\{\/items\}\}/g;
  result = result.replace(itemsRegex, (_, content) => {
    const items = context['items'] as unknown[];
    if (!Array.isArray(items)) return '';
    return items
      .map((item) => {
        const itemContext =
          typeof item === 'object' ? { ...context, ...item } : { ...context, item };
        return renderTemplate(content, itemContext);
      })
      .join('');
  });

  // Handle simple variables: {{variable}}
  const varRegex = /\{\{(\w+)\}\}/g;
  result = result.replace(varRegex, (_, key) => {
    const value = context[key];
    if (value === undefined || value === null) return '';
    return String(value);
  });

  return result;
}

// ============================================================================
// Context Building
// ============================================================================

function buildRenderContext(
  payload: CanonicalPayload,
  pack: CompiledPack
): Record<string, unknown> {
  const taxonomy = pack.taxonomy;

  // Get role info
  const roleInfo = taxonomy.roles[payload.role] || { emoji: '?', description: '' };
  const statusInfo = taxonomy.statuses[payload.status] || { emoji: '?', color: 'white' };
  const loadInfo = taxonomy.loads[payload.load] || { emoji: '?', color: 'white' };

  // Build context object
  const context: Record<string, unknown> = {
    // Core fields
    role: payload.role,
    status: payload.status,
    load: payload.load,
    summary: payload.summary,

    // Taxonomy lookups
    role_emoji: roleInfo.emoji,
    role_description: roleInfo.description,
    status_emoji: statusInfo.emoji,
    status_color: statusInfo.color,
    load_emoji: loadInfo.emoji,
    load_color: loadInfo.color,

    // Evidence
    evidence: payload.evidence.length > 0,
    evidence_items: payload.evidence,

    // Missing data
    missing_data: payload.missing_data.length > 0,
    missing_data_items: payload.missing_data,

    // Overmind fields
    decision: payload.decision,
    guardrails: payload.guardrails,
    dissent_summary: payload.dissent_summary,

    // Specialist fields
    specialist_id: payload.specialist_id,
    specialist_name: payload.specialist_name,

    // Metadata
    pack_id: payload.metadata.pack_id,
    pack_hash: payload.metadata.pack_hash,
    created_at: payload.metadata.created_at,
  };

  // Flatten nested arrays for template iteration
  if (payload.evidence.length > 0) {
    context['evidence'] = { items: payload.evidence };
  }
  if (payload.missing_data.length > 0) {
    context['missing_data'] = { items: payload.missing_data };
  }

  return context;
}

// ============================================================================
// ANSI Styling
// ============================================================================

const ANSI_CODES: Record<string, string> = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',
  // Colors
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  // Bright colors
  brightBlack: '\x1b[90m',
  brightRed: '\x1b[91m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightBlue: '\x1b[94m',
  brightMagenta: '\x1b[95m',
  brightCyan: '\x1b[96m',
  brightWhite: '\x1b[97m',
  // Background colors
  bgBlack: '\x1b[40m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
  bgWhite: '\x1b[47m',
};

function applyAnsiStyles(
  text: string,
  styles?: Record<string, string>
): string {
  if (!styles) return text;

  let result = text;

  // Apply custom style rules
  for (const [pattern, style] of Object.entries(styles)) {
    const codes = style
      .split(' ')
      .map((s) => ANSI_CODES[s] || '')
      .join('');
    if (codes) {
      const regex = new RegExp(`(${pattern})`, 'g');
      result = result.replace(regex, `${codes}$1${ANSI_CODES.reset}`);
    }
  }

  return result;
}

// ============================================================================
// Output Metrics
// ============================================================================

function countEmojis(text: string): number {
  // Unicode emoji regex (simplified)
  const emojiRegex =
    /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]/gu;
  const matches = text.match(emojiRegex);
  return matches ? matches.length : 0;
}

function computeMetrics(text: string): { line_count: number; char_count: number; emoji_count: number } {
  return {
    line_count: text.split('\n').length,
    char_count: text.length,
    emoji_count: countEmojis(text),
  };
}

// ============================================================================
// Renderer Selection
// ============================================================================

function selectRenderer(
  rendererId: string,
  payload: CanonicalPayload,
  pack: CompiledPack
): RendererConfig {
  // If payload has specialist_id, check for specialist-specific renderer
  if (payload.specialist_id) {
    const specialistRendererId = `${payload.specialist_id}-${rendererId}`;
    if (pack.renderers[specialistRendererId]) {
      return pack.renderers[specialistRendererId];
    }
  }

  // Use specified renderer or default
  const renderer = pack.renderers[rendererId] || pack.renderers['default'];
  if (!renderer) {
    throw new Error(`Renderer '${rendererId}' not found and no default renderer available`);
  }

  return renderer;
}

// ============================================================================
// Core Render Function
// ============================================================================

/**
 * Render a canonical payload to text using the specified renderer.
 * Pure function - no side effects.
 */
export function render(
  payload: CanonicalPayload,
  rendererId: string,
  pack: CompiledPack,
  target: RenderTarget = 'plain'
): RenderOutput {
  const warnings: string[] = [];

  // Select renderer
  const renderer = selectRenderer(rendererId, payload, pack);

  // Build context
  const context = buildRenderContext(payload, pack);

  // Render template
  let rendered = renderTemplate(renderer.template, context);

  // Apply ANSI styles if target is ansi
  if (target === 'ansi') {
    const styles = renderer.ansi_styles || pack.ansi_styles;
    rendered = applyAnsiStyles(rendered, styles);
  }

  // Clean up extra whitespace
  rendered = rendered
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // Compute metrics
  const metrics = computeMetrics(rendered);

  // Check constraints and add warnings
  const constraints = renderer.constraints;
  if (constraints.max_emoji_count && metrics.emoji_count > constraints.max_emoji_count) {
    warnings.push(
      `Emoji count (${metrics.emoji_count}) exceeds max (${constraints.max_emoji_count})`
    );
  }
  if (constraints.max_lines && metrics.line_count > constraints.max_lines) {
    warnings.push(
      `Line count (${metrics.line_count}) exceeds max (${constraints.max_lines})`
    );
  }

  return {
    rendered,
    renderer_id: renderer.id,
    target,
    warnings,
    metadata: metrics,
  };
}

// ============================================================================
// MCP Tool Handler
// ============================================================================

/**
 * MCP tool handler for rendering payloads
 */
export async function renderPayload(input: RenderInput): Promise<RenderOutputResult> {
  try {
    const resolved = resolveProjectPaths(input.projectId);
    const pack = await getOrCompilePack(resolved);

    log(`agentic-renderer: Rendering with renderer '${input.renderer_id}'`);

    const result = render(
      input.payload,
      input.renderer_id,
      pack.content,
      input.target || 'plain'
    );

    log(`agentic-renderer: Rendered ${result.metadata.line_count} lines`);

    return {
      status: 'rendered',
      result,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`agentic-renderer: Error: ${message}`);
    return {
      status: 'error',
      error: message,
    };
  }
}
