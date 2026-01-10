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
