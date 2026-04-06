import fs from 'fs/promises';
import path from 'path';
import YAML from 'yaml';
import { log } from '../config.js';
import { ensureDir } from '../dataRoot.js';
import { resolveProjectPaths, validateWritePath, ResolvedProjectPaths } from '../projectRegistry.js';
import { emitCreateProvenance } from './provenance.js';

// ============================================================================
// Figma API Configuration
// ============================================================================

const FIGMA_API_BASE = 'https://api.figma.com/v1';

function getFigmaToken(): string | null {
  return process.env.FIGMA_ACCESS_TOKEN || null;
}

// ============================================================================
// Project Resolution Error
// ============================================================================

export interface DesignerError {
  error: string;
  message: string;
  hint?: string;
}

function makeProjectError(operation: string): DesignerError {
  return {
    error: 'PROJECT_NOT_FOUND',
    message: `Cannot ${operation}: No project context available.`,
    hint: 'Specify projectId parameter, set DECIBEL_PROJECT_ROOT env var, or run from a directory with .decibel/',
  };
}

export function isDesignerError(result: unknown): result is DesignerError {
  return (
    typeof result === 'object' &&
    result !== null &&
    'error' in result &&
    'message' in result
  );
}

export interface RecordDesignDecisionInput {
  projectId?: string;  // optional, uses project resolution
  area: string;
  summary: string;
  details?: string;
}

export interface RecordDesignDecisionOutput {
  id: string;
  timestamp: string;
  path: string;
  location: 'project';
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50);
}

function formatTimestampForFilename(date: Date): string {
  // Format: YYYY-MM-DDTHH-mm-ssZ
  const iso = date.toISOString();
  return iso
    .replace(/:/g, '-')
    .replace(/\.\d{3}Z$/, 'Z');
}

export async function recordDesignDecision(
  input: RecordDesignDecisionInput
): Promise<RecordDesignDecisionOutput | DesignerError> {
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.projectId);
  } catch {
    return makeProjectError('record design decision');
  }

  const now = new Date();
  const timestamp = now.toISOString();
  const fileTimestamp = formatTimestampForFilename(now);
  const slug = slugify(input.summary);
  const filename = `${fileTimestamp}-${slug}.md`;

  // Store in .decibel/designer/<area>/
  const dirPath = resolved.subPath('designer', input.area);
  ensureDir(dirPath);

  const filePath = path.join(dirPath, filename);

  // Build markdown content
  const frontmatter = [
    '---',
    `project_id: ${resolved.id}`,
    `area: ${input.area}`,
    `summary: ${input.summary}`,
    `timestamp: ${timestamp}`,
    `location: project`,
    '---',
  ].join('\n');

  const body = input.details || input.summary;
  const content = `${frontmatter}\n\n# ${input.summary}\n\n${body}\n`;

  validateWritePath(filePath, resolved);
  await fs.writeFile(filePath, content, 'utf-8');
  log(`Designer: Recorded design decision to ${filePath} (project: ${resolved.id})`);

  // Emit provenance event for this creation
  await emitCreateProvenance(
    `designer:decision:${filename}`,
    content,
    `Created design decision: ${input.summary}`,
    input.projectId
  );

  return {
    id: filename,
    timestamp,
    path: filePath,
    location: 'project',
  };
}

// ============================================================================
// Sync Tokens from Figma
// ============================================================================

export interface SyncTokensInput {
  projectId?: string;
  fileKey: string;          // Figma file key (from URL)
  forceRefresh?: boolean;   // Bypass cache
}

export interface DesignToken {
  name: string;
  type: 'color' | 'number' | 'string' | 'boolean' | 'float';
  value: unknown;
  description?: string;
  collection?: string;
  mode?: string;
}

export interface SyncTokensOutput {
  path: string;
  tokens: {
    colors: number;
    numbers: number;
    strings: number;
    total: number;
  };
  timestamp: string;
  source: string;
}

async function figmaFetch(endpoint: string, token: string): Promise<unknown> {
  const response = await fetch(`${FIGMA_API_BASE}${endpoint}`, {
    headers: {
      'X-Figma-Token': token,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Figma API error (${response.status}): ${errorText}`);
  }

  return response.json();
}

export async function syncTokens(
  input: SyncTokensInput
): Promise<SyncTokensOutput | DesignerError> {
  const token = getFigmaToken();
  if (!token) {
    return {
      error: 'FIGMA_TOKEN_MISSING',
      message: 'FIGMA_ACCESS_TOKEN environment variable is not set.',
      hint: 'Set FIGMA_ACCESS_TOKEN to your Figma personal access token.',
    };
  }

  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.projectId);
  } catch {
    return makeProjectError('sync tokens');
  }

  const now = new Date();
  const timestamp = now.toISOString();

  // Fetch variables from Figma
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let variablesData: any;
  try {
    variablesData = await figmaFetch(`/files/${input.fileKey}/variables/local`, token);
  } catch (err) {
    return {
      error: 'FIGMA_API_ERROR',
      message: err instanceof Error ? err.message : 'Failed to fetch Figma variables',
      hint: 'Check your file key and token permissions.',
    };
  }

  // Parse variables into tokens
  const tokens: DesignToken[] = [];
  const variables = variablesData?.meta?.variables || {};
  const collections = variablesData?.meta?.variableCollections || {};

  for (const [, variable] of Object.entries(variables) as [string, any][]) {
    const collectionId = variable.variableCollectionId;
    const collection = collections[collectionId];
    const collectionName = collection?.name || 'Unknown';

    // Get the first mode's value (simplified - could expand for multi-mode)
    const modeId = collection?.modes?.[0]?.modeId;
    const value = modeId ? variable.valuesByMode?.[modeId] : null;

    tokens.push({
      name: variable.name,
      type: variable.resolvedType?.toLowerCase() || 'string',
      value: value,
      description: variable.description,
      collection: collectionName,
    });
  }

  // Count by type
  const counts = {
    colors: tokens.filter(t => t.type === 'color').length,
    numbers: tokens.filter(t => t.type === 'number' || t.type === 'float').length,
    strings: tokens.filter(t => t.type === 'string').length,
    total: tokens.length,
  };

  // Save to .decibel/designer/tokens/
  const tokensDir = resolved.subPath('designer', 'tokens');
  ensureDir(tokensDir);

  const tokensFile = path.join(tokensDir, 'tokens.yaml');
  const tokensData = {
    source: `figma:${input.fileKey}`,
    synced_at: timestamp,
    project_id: resolved.id,
    tokens: tokens,
  };

  validateWritePath(tokensFile, resolved);
  await fs.writeFile(tokensFile, YAML.stringify(tokensData), 'utf-8');
  log(`Designer: Synced ${counts.total} tokens from Figma to ${tokensFile}`);

  return {
    path: tokensFile,
    tokens: counts,
    timestamp,
    source: `figma:${input.fileKey}`,
  };
}

// ============================================================================
// Review Figma Component
// ============================================================================

export interface ReviewFigmaInput {
  projectId?: string;
  fileKey: string;          // Figma file key
  nodeId: string;           // Component node ID
  scope?: 'full' | 'accessibility' | 'consistency';
}

export interface ReviewFinding {
  severity: 'info' | 'warning' | 'error';
  category: string;
  message: string;
  principle?: string;
}

export interface ReviewFigmaOutput {
  component: {
    name: string;
    type: string;
    id: string;
  };
  findings: ReviewFinding[];
  principlesChecked: number;
  timestamp: string;
}

interface DesignPrinciple {
  id: string;
  title: string;
  description: string;
  category: string;
  checks?: string[];
}

async function loadPrinciples(resolved: ResolvedProjectPaths): Promise<DesignPrinciple[]> {
  const principlesDir = resolved.subPath('designer', 'principles');

  try {
    await fs.access(principlesDir);
  } catch {
    return [];
  }

  const files = await fs.readdir(principlesDir);
  const principles: DesignPrinciple[] = [];

  for (const file of files) {
    if (!file.endsWith('.yaml') && !file.endsWith('.yml')) continue;

    const filePath = path.join(principlesDir, file);
    const content = await fs.readFile(filePath, 'utf-8');
    const data = YAML.parse(content);

    if (data && data.id && data.title) {
      principles.push(data as DesignPrinciple);
    }
  }

  return principles;
}

export async function reviewFigma(
  input: ReviewFigmaInput
): Promise<ReviewFigmaOutput | DesignerError> {
  const token = getFigmaToken();
  if (!token) {
    return {
      error: 'FIGMA_TOKEN_MISSING',
      message: 'FIGMA_ACCESS_TOKEN environment variable is not set.',
      hint: 'Set FIGMA_ACCESS_TOKEN to your Figma personal access token.',
    };
  }

  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.projectId);
  } catch {
    return makeProjectError('review Figma component');
  }

  const now = new Date();
  const timestamp = now.toISOString();
  const scope = input.scope || 'full';

  // Fetch component from Figma
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let nodeData: any;
  try {
    nodeData = await figmaFetch(`/files/${input.fileKey}/nodes?ids=${input.nodeId}`, token);
  } catch (err) {
    return {
      error: 'FIGMA_API_ERROR',
      message: err instanceof Error ? err.message : 'Failed to fetch Figma node',
      hint: 'Check your file key, node ID, and token permissions.',
    };
  }

  const node = nodeData?.nodes?.[input.nodeId]?.document;
  if (!node) {
    return {
      error: 'NODE_NOT_FOUND',
      message: `Node ${input.nodeId} not found in file ${input.fileKey}`,
      hint: 'Check the node ID - you can find it in the Figma URL after selecting a component.',
    };
  }

  // Load project design principles
  const principles = await loadPrinciples(resolved);
  const findings: ReviewFinding[] = [];

  // Built-in checks
  if (scope === 'full' || scope === 'accessibility') {
    // Check for text contrast (simplified heuristic)
    if (node.type === 'TEXT' && node.fills?.length > 0) {
      const fill = node.fills[0];
      if (fill.type === 'SOLID' && fill.color) {
        const { r, g, b } = fill.color;
        const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
        if (luminance > 0.4 && luminance < 0.6) {
          findings.push({
            severity: 'warning',
            category: 'accessibility',
            message: 'Text color may have low contrast - verify against background.',
          });
        }
      }
    }

    // Check for missing alt text on images
    if (node.type === 'RECTANGLE' && node.fills?.some((f: any) => f.type === 'IMAGE')) {
      if (!node.name || node.name.startsWith('Rectangle') || node.name.startsWith('Image')) {
        findings.push({
          severity: 'warning',
          category: 'accessibility',
          message: 'Image element has generic name - add descriptive name for accessibility.',
        });
      }
    }
  }

  if (scope === 'full' || scope === 'consistency') {
    // Check for non-standard sizes
    if (node.absoluteBoundingBox) {
      const { width, height } = node.absoluteBoundingBox;
      if (width % 4 !== 0 || height % 4 !== 0) {
        findings.push({
          severity: 'info',
          category: 'consistency',
          message: `Dimensions (${width}x${height}) not on 4px grid.`,
        });
      }
    }

    // Check against stored principles
    for (const principle of principles) {
      if (principle.checks) {
        for (const check of principle.checks) {
          // Simple keyword matching (could be more sophisticated)
          if (check.toLowerCase().includes('spacing') && node.itemSpacing !== undefined) {
            if (node.itemSpacing % 4 !== 0) {
              findings.push({
                severity: 'warning',
                category: 'consistency',
                message: `Item spacing (${node.itemSpacing}) violates grid.`,
                principle: principle.title,
              });
            }
          }
        }
      }
    }
  }

  // If no findings, add a success note
  if (findings.length === 0) {
    findings.push({
      severity: 'info',
      category: 'review',
      message: 'No issues found. Component passes all checks.',
    });
  }

  log(`Designer: Reviewed component ${node.name} (${findings.length} findings)`);

  return {
    component: {
      name: node.name,
      type: node.type,
      id: input.nodeId,
    },
    findings,
    principlesChecked: principles.length,
    timestamp,
  };
}

// ============================================================================
// Upsert Design Principle
// ============================================================================

export interface UpsertPrincipleInput {
  projectId?: string;
  id?: string;              // If provided, updates existing
  title: string;
  description: string;
  category: string;         // e.g., "spacing", "color", "typography", "accessibility"
  checks?: string[];        // Things to verify against this principle
}

export interface UpsertPrincipleOutput {
  id: string;
  path: string;
  action: 'created' | 'updated';
  timestamp: string;
}

export async function upsertPrinciple(
  input: UpsertPrincipleInput
): Promise<UpsertPrincipleOutput | DesignerError> {
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.projectId);
  } catch {
    return makeProjectError('upsert design principle');
  }

  const now = new Date();
  const timestamp = now.toISOString();

  const principlesDir = resolved.subPath('designer', 'principles');
  ensureDir(principlesDir);

  // Generate or use provided ID
  const id = input.id || `PRIN-${Date.now()}`;
  const filename = `${id}.yaml`;
  const filePath = path.join(principlesDir, filename);

  // Check if updating existing
  let action: 'created' | 'updated' = 'created';
  try {
    await fs.access(filePath);
    action = 'updated';
  } catch {
    // File doesn't exist, will create
  }

  const principleData = {
    id,
    title: input.title,
    description: input.description,
    category: input.category,
    checks: input.checks || [],
    created_at: action === 'created' ? timestamp : undefined,
    updated_at: timestamp,
  };

  validateWritePath(filePath, resolved);
  await fs.writeFile(filePath, YAML.stringify(principleData), 'utf-8');
  log(`Designer: ${action} principle ${id} at ${filePath}`);

  return {
    id,
    path: filePath,
    action,
    timestamp,
  };
}

// ============================================================================
// List Design Principles
// ============================================================================

export interface ListPrinciplesInput {
  projectId?: string;
  category?: string;
}

export interface ListPrinciplesOutput {
  principles: DesignPrinciple[];
  total: number;
  path: string;
}

// ============================================================================
// Check Token Parity (Figma drift detection)
// ============================================================================

export interface CheckParityInput {
  projectId?: string;
  fileKey: string;
}

export interface TokenDiff {
  name: string;
  collection?: string;
  type?: string;
  oldValue?: unknown;
  newValue?: unknown;
}

export interface CheckParityOutput {
  added: TokenDiff[];
  removed: TokenDiff[];
  changed: TokenDiff[];
  unchanged_count: number;
  drift_detected: boolean;
  timestamp: string;
  source: string;
}

export async function checkParity(
  input: CheckParityInput
): Promise<CheckParityOutput | DesignerError> {
  const token = getFigmaToken();
  if (!token) {
    return {
      error: 'FIGMA_TOKEN_MISSING',
      message: 'FIGMA_ACCESS_TOKEN environment variable is not set.',
      hint: 'Set FIGMA_ACCESS_TOKEN to your Figma personal access token.',
    };
  }

  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.projectId);
  } catch {
    return makeProjectError('check token parity');
  }

  const now = new Date();
  const timestamp = now.toISOString();

  // Load existing tokens.yaml
  const tokensFile = path.join(resolved.subPath('designer', 'tokens'), 'tokens.yaml');
  let existingTokens: DesignToken[];
  try {
    const content = await fs.readFile(tokensFile, 'utf-8');
    const data = YAML.parse(content);
    existingTokens = data?.tokens || [];
  } catch {
    return {
      error: 'NO_SYNCED_TOKENS',
      message: 'No tokens.yaml found. Run sync_tokens first to establish a baseline.',
      hint: `Use designer sync_tokens with fileKey: "${input.fileKey}" to create the initial snapshot.`,
    };
  }

  // Fetch fresh variables from Figma
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let variablesData: any;
  try {
    variablesData = await figmaFetch(`/files/${input.fileKey}/variables/local`, token);
  } catch (err) {
    return {
      error: 'FIGMA_API_ERROR',
      message: err instanceof Error ? err.message : 'Failed to fetch Figma variables',
      hint: 'Check your file key and token permissions.',
    };
  }

  // Parse fresh variables
  const freshTokens: DesignToken[] = [];
  const variables = variablesData?.meta?.variables || {};
  const collections = variablesData?.meta?.variableCollections || {};

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const [, variable] of Object.entries(variables) as [string, any][]) {
    const collectionId = variable.variableCollectionId;
    const collection = collections[collectionId];
    const collectionName = collection?.name || 'Unknown';
    const modeId = collection?.modes?.[0]?.modeId;
    const value = modeId ? variable.valuesByMode?.[modeId] : null;

    freshTokens.push({
      name: variable.name,
      type: variable.resolvedType?.toLowerCase() || 'string',
      value: value,
      description: variable.description,
      collection: collectionName,
    });
  }

  // Build lookup maps by name
  const existingMap = new Map(existingTokens.map(t => [t.name, t]));
  const freshMap = new Map(freshTokens.map(t => [t.name, t]));

  const added: TokenDiff[] = [];
  const removed: TokenDiff[] = [];
  const changed: TokenDiff[] = [];
  let unchanged_count = 0;

  // Find added and changed tokens
  for (const [name, fresh] of freshMap) {
    const existing = existingMap.get(name);
    if (!existing) {
      added.push({ name, collection: fresh.collection, type: fresh.type, newValue: fresh.value });
    } else {
      const valueChanged = JSON.stringify(existing.value) !== JSON.stringify(fresh.value);
      const typeChanged = existing.type !== fresh.type;
      if (valueChanged || typeChanged) {
        changed.push({
          name,
          collection: fresh.collection,
          type: fresh.type,
          oldValue: existing.value,
          newValue: fresh.value,
        });
      } else {
        unchanged_count++;
      }
    }
  }

  // Find removed tokens
  for (const [name, existing] of existingMap) {
    if (!freshMap.has(name)) {
      removed.push({ name, collection: existing.collection, type: existing.type, oldValue: existing.value });
    }
  }

  const drift_detected = added.length > 0 || removed.length > 0 || changed.length > 0;

  log(`Designer: Parity check — ${added.length} added, ${removed.length} removed, ${changed.length} changed, ${unchanged_count} unchanged`);

  return {
    added,
    removed,
    changed,
    unchanged_count,
    drift_detected,
    timestamp,
    source: `figma:${input.fileKey}`,
  };
}

// ============================================================================
// List Design Principles
// ============================================================================

// ============================================================================
// Tokens Registry Lookup
// ============================================================================

export interface TokensLookupInput {
  projectId?: string;
  category?: string;  // e.g., 'color', 'spacing', 'typography'
}

export interface TokensLookupOutput {
  tokens: DesignToken[];
  total: number;
  categories: string[];
  source: string | null;
  synced_at: string | null;
  path: string;
}

export async function tokensLookup(
  input: TokensLookupInput
): Promise<TokensLookupOutput | DesignerError> {
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.projectId);
  } catch {
    return makeProjectError('look up tokens');
  }

  const tokensFile = path.join(resolved.subPath('designer', 'tokens'), 'tokens.yaml');
  let tokens: DesignToken[];
  let source: string | null = null;
  let synced_at: string | null = null;

  try {
    const content = await fs.readFile(tokensFile, 'utf-8');
    const data = YAML.parse(content);
    tokens = data?.tokens || [];
    source = data?.source || null;
    synced_at = data?.synced_at || null;
  } catch {
    return {
      error: 'NO_TOKENS',
      message: 'No tokens.yaml found. Sync tokens from Figma first or create a tokens file manually.',
      hint: 'Use designer sync_tokens with a Figma fileKey, or place a tokens.yaml in .decibel/designer/tokens/',
    };
  }

  // Derive categories from token types + collections
  const categorySet = new Set<string>();
  for (const t of tokens) {
    if (t.type) categorySet.add(t.type);
    if (t.collection) categorySet.add(t.collection.toLowerCase());
  }

  // Filter by category if specified
  if (input.category) {
    const cat = input.category.toLowerCase();
    tokens = tokens.filter(t =>
      t.type === cat ||
      (t.collection && t.collection.toLowerCase() === cat)
    );
  }

  log(`Designer: Tokens lookup — ${tokens.length} tokens${input.category ? ` (category: ${input.category})` : ''}`);

  return {
    tokens,
    total: tokens.length,
    categories: Array.from(categorySet).sort(),
    source,
    synced_at,
    path: tokensFile,
  };
}

// ============================================================================
// Drift Detection (Token Registry vs Source Files)
// ============================================================================

export interface DriftDetectionInput {
  projectId?: string;
}

export interface DriftEntry {
  token_name: string;
  expected: string;
  actual: string;
  file: string;
  format: 'css' | 'tailwind' | 'swift' | 'json';
}

export interface DriftDetectionOutput {
  drifted: DriftEntry[];
  scanned_files: number;
  total_tokens_checked: number;
  drift_detected: boolean;
  timestamp: string;
}

// Format-aware value normalizer: convert various color/value formats to comparable form
function normalizeColorValue(value: unknown): string | null {
  if (typeof value === 'string') return value.toLowerCase().replace(/\s/g, '');
  // Figma RGBA object → hex
  if (typeof value === 'object' && value !== null && 'r' in value) {
    const v = value as { r: number; g: number; b: number; a?: number };
    const toHex = (n: number) => Math.round(n * 255).toString(16).padStart(2, '0');
    return `#${toHex(v.r)}${toHex(v.g)}${toHex(v.b)}`.toLowerCase();
  }
  if (typeof value === 'number') return String(value);
  return null;
}

// Parsers for different source file formats
const FORMAT_PARSERS: Record<string, { glob: string; extract: (content: string) => Map<string, string> }> = {
  css: {
    glob: '**/*.css',
    extract(content: string): Map<string, string> {
      const map = new Map<string, string>();
      const re = /--([a-zA-Z0-9_-]+)\s*:\s*([^;]+)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) {
        map.set(m[1].toLowerCase(), m[2].trim().toLowerCase());
      }
      return map;
    },
  },
  tailwind: {
    glob: '**/tailwind.config.{js,ts,cjs,mjs}',
    extract(content: string): Map<string, string> {
      const map = new Map<string, string>();
      // Match hex/rgb values in tailwind config
      const re = /['"]([a-zA-Z0-9_-]+)['"]\s*:\s*['"](#[0-9a-fA-F]{3,8}|rgb[a]?\([^)]+\))['"]/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) {
        map.set(m[1].toLowerCase(), m[2].toLowerCase());
      }
      return map;
    },
  },
  swift: {
    glob: '**/*.swift',
    extract(content: string): Map<string, string> {
      const map = new Map<string, string>();
      // Match Color(hex: 0xRRGGBB) or Color(hex: "RRGGBB")
      const re = /(?:let|var|static)\s+(\w+)\s*.*?Color\(\s*hex\s*:\s*(?:0x|"|')([0-9a-fA-F]{6,8})/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) {
        map.set(m[1].toLowerCase(), `#${m[2].toLowerCase()}`);
      }
      return map;
    },
  },
  json: {
    glob: '**/tokens.json',
    extract(content: string): Map<string, string> {
      const map = new Map<string, string>();
      try {
        const data = JSON.parse(content);
        // Flatten nested token objects
        function walk(obj: Record<string, unknown>, prefix: string) {
          for (const [k, v] of Object.entries(obj)) {
            const key = prefix ? `${prefix}/${k}` : k;
            if (typeof v === 'object' && v !== null && 'value' in v) {
              map.set(key.toLowerCase(), String((v as { value: unknown }).value).toLowerCase());
            } else if (typeof v === 'object' && v !== null) {
              walk(v as Record<string, unknown>, key);
            }
          }
        }
        walk(data, '');
      } catch { /* not valid JSON, skip */ }
      return map;
    },
  },
};

export async function driftDetection(
  input: DriftDetectionInput
): Promise<DriftDetectionOutput | DesignerError> {
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.projectId);
  } catch {
    return makeProjectError('detect drift');
  }

  const now = new Date();

  // Load token registry
  const tokensFile = path.join(resolved.subPath('designer', 'tokens'), 'tokens.yaml');
  let registryTokens: DesignToken[];
  try {
    const content = await fs.readFile(tokensFile, 'utf-8');
    const data = YAML.parse(content);
    registryTokens = data?.tokens || [];
  } catch {
    return {
      error: 'NO_TOKENS',
      message: 'No tokens.yaml found. Sync or create tokens first.',
      hint: 'Use designer sync_tokens or manually place tokens.yaml in .decibel/designer/tokens/',
    };
  }

  // Build a lookup from token name → normalized expected value
  const expectedMap = new Map<string, string>();
  for (const t of registryTokens) {
    const norm = normalizeColorValue(t.value);
    if (norm) {
      // Use the last segment of slash-separated names for matching
      const shortName = t.name.split('/').pop()!.toLowerCase();
      expectedMap.set(shortName, norm);
      expectedMap.set(t.name.toLowerCase(), norm);
    }
  }

  const drifted: DriftEntry[] = [];
  let scannedFiles = 0;

  // Scan source files using each format parser
  for (const [format, parser] of Object.entries(FORMAT_PARSERS)) {
    // Use the project root to find source files
    const projectRoot = resolved.projectPath.replace(/\/.decibel$/, '');
    let files: string[];
    try {
      const { glob } = await import('glob');
      files = await glob(parser.glob, {
        cwd: projectRoot,
        absolute: true,
        ignore: ['**/node_modules/**', '**/dist/**', '**/.decibel/**'],
      });
    } catch {
      continue; // glob not available or no matches
    }

    for (const file of files) {
      scannedFiles++;
      const content = await fs.readFile(file, 'utf-8');
      const sourceValues = parser.extract(content);

      for (const [name, actual] of sourceValues) {
        const expected = expectedMap.get(name);
        if (expected && expected !== actual.replace(/\s/g, '')) {
          drifted.push({
            token_name: name,
            expected,
            actual,
            file: path.relative(projectRoot, file),
            format: format as DriftEntry['format'],
          });
        }
      }
    }
  }

  log(`Designer: Drift detection — ${drifted.length} drifted tokens across ${scannedFiles} files`);

  return {
    drifted,
    scanned_files: scannedFiles,
    total_tokens_checked: expectedMap.size,
    drift_detected: drifted.length > 0,
    timestamp: now.toISOString(),
  };
}

// ============================================================================
// Figma Parity Diff (Component Implementation vs Figma Source)
// ============================================================================

export interface FigmaParityInput {
  projectId?: string;
  component: string;       // Component name or path in the codebase
  figma_node_id?: string;  // Figma node ID for comparison (Phase 2)
}

export interface FigmaParityOutput {
  component: string;
  status: 'pending_figma_integration' | 'compared';
  figma_node_id: string | null;
  message: string;
  timestamp: string;
}

export async function figmaParity(
  input: FigmaParityInput
): Promise<FigmaParityOutput | DesignerError> {
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.projectId);
  } catch {
    return makeProjectError('check Figma parity');
  }

  // Input validation
  if (!input.component || input.component.trim().length === 0) {
    return {
      error: 'INVALID_INPUT',
      message: 'component parameter is required and must be non-empty.',
      hint: 'Provide the component name or file path (e.g., "Button", "src/components/Button.tsx").',
    };
  }

  const now = new Date();

  // Phase 1: skeleton — real Figma MCP integration is pending
  log(`Designer: Figma parity check requested for component "${input.component}" (Phase 2 integration pending)`);

  return {
    component: input.component,
    status: 'pending_figma_integration',
    figma_node_id: input.figma_node_id || null,
    message: `Figma parity diff for "${input.component}" is registered. Real comparison requires Phase 2 Figma MCP integration. Node ID ${input.figma_node_id ? `"${input.figma_node_id}" saved for` : 'not provided — will need it for'} automated comparison.`,
    timestamp: now.toISOString(),
  };
}

// ============================================================================
// List Design Principles
// ============================================================================

export async function listPrinciples(
  input: ListPrinciplesInput
): Promise<ListPrinciplesOutput | DesignerError> {
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.projectId);
  } catch {
    return makeProjectError('list design principles');
  }

  const principlesDir = resolved.subPath('designer', 'principles');
  let principles = await loadPrinciples(resolved);

  if (input.category) {
    principles = principles.filter(p =>
      p.category.toLowerCase() === input.category!.toLowerCase()
    );
  }

  return {
    principles,
    total: principles.length,
    path: principlesDir,
  };
}
