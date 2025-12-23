/**
 * Agentic Pack Compiler
 *
 * Compiles agentic configuration files into a versioned, hashed pack.
 * Reads from .decibel/architect/agentic/ and outputs compiled_agentic_pack.json
 */

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import yaml from 'yaml';
import { log } from '../config.js';
import { resolveProjectPaths, ResolvedProjectPaths } from '../projectRegistry.js';
import { ensureDir } from '../dataRoot.js';
import {
  CompiledPack,
  CompileResult,
  TaxonomyConfig,
  RendererConfig,
  ConsensusConfig,
  AvatarConfig,
  CompilePackInput,
  CompilePackOutput,
} from './types.js';

// ============================================================================
// Default Configurations
// ============================================================================

const DEFAULT_TAXONOMY: TaxonomyConfig = {
  roles: {
    Sensor: { emoji: '👁️', description: 'Data collection and observation' },
    Analyst: { emoji: '🧠', description: 'Pattern recognition and analysis' },
    Overmind: { emoji: '🎯', description: 'Decision making and coordination' },
    Specialist: { emoji: '🔧', description: 'Domain-specific expertise' },
  },
  statuses: {
    OK: { emoji: '✓', color: 'green' },
    DEGRADED: { emoji: '⚠️', color: 'yellow' },
    BLOCKED: { emoji: '🛑', color: 'red' },
    ALERT: { emoji: '🚨', color: 'magenta' },
  },
  loads: {
    GREEN: { emoji: '🟢', color: 'green' },
    YELLOW: { emoji: '🟡', color: 'yellow' },
    RED: { emoji: '🔴', color: 'red' },
  },
};

const DEFAULT_RENDERER: RendererConfig = {
  id: 'default',
  name: 'Default Renderer',
  description: 'Basic text output with minimal formatting',
  template: `{{role_emoji}} {{role}} | {{status}} | Load: {{load}}

{{summary}}

{{#evidence}}
Evidence:
{{#items}}
- {{source}}: {{value}}
{{/items}}
{{/evidence}}

{{#missing_data}}
Missing Data:
{{#items}}
- {{field}}: {{reason}}
{{/items}}
{{/missing_data}}

{{#decision}}
Decision: {{decision}}
{{/decision}}`,
  constraints: {
    max_emoji_count: 5,
    emoji_position: 'header-only',
    max_lines: 50,
    banned_words: ['amazing', 'incredible', 'revolutionary', 'game-changing'],
    banned_punctuation: ['!'],
  },
};

const DEFAULT_CONSENSUS: ConsensusConfig = {
  quorum_threshold: 0.67,
  dissent_highlight_threshold: 0.3,
  max_pending_decisions: 10,
};

// ============================================================================
// YAML Loading Helpers
// ============================================================================

async function loadYamlFile<T>(filePath: string): Promise<T | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return yaml.parse(content) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function loadYamlDir<T>(dirPath: string): Promise<Record<string, T>> {
  const result: Record<string, T> = {};
  try {
    const files = await fs.readdir(dirPath);
    for (const file of files) {
      if (file.endsWith('.yaml') || file.endsWith('.yml')) {
        const filePath = path.join(dirPath, file);
        const content = await loadYamlFile<T>(filePath);
        if (content) {
          const id = path.basename(file, path.extname(file));
          result[id] = content;
        }
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
  return result;
}

// ============================================================================
// Pack Compiler
// ============================================================================

async function loadPackConfigs(
  agenticDir: string
): Promise<{ pack: CompiledPack; sourceFiles: string[] }> {
  const sourceFiles: string[] = [];

  // Load taxonomy
  const taxonomyPath = path.join(agenticDir, 'taxonomy.yaml');
  const taxonomy = (await loadYamlFile<TaxonomyConfig>(taxonomyPath)) || DEFAULT_TAXONOMY;
  if (await fileExists(taxonomyPath)) sourceFiles.push(taxonomyPath);

  // Load renderers
  const renderersPath = path.join(agenticDir, 'renderers.yaml');
  let renderers: Record<string, RendererConfig> = { default: DEFAULT_RENDERER };
  const loadedRenderers = await loadYamlFile<Record<string, RendererConfig>>(renderersPath);
  if (loadedRenderers) {
    renderers = { ...renderers, ...loadedRenderers };
    sourceFiles.push(renderersPath);
  }

  // Also load from renderers/ directory
  const renderersDir = path.join(agenticDir, 'renderers');
  const dirRenderers = await loadYamlDir<RendererConfig>(renderersDir);
  for (const [id, config] of Object.entries(dirRenderers)) {
    renderers[id] = { ...config, id };
    sourceFiles.push(path.join(renderersDir, `${id}.yaml`));
  }

  // Load consensus
  const consensusPath = path.join(agenticDir, 'consensus.yaml');
  const consensus = (await loadYamlFile<ConsensusConfig>(consensusPath)) || DEFAULT_CONSENSUS;
  if (await fileExists(consensusPath)) sourceFiles.push(consensusPath);

  // Load ANSI styles
  const ansiStylesPath = path.join(agenticDir, 'ansi_styles.yaml');
  const ansiStyles = await loadYamlFile<Record<string, string>>(ansiStylesPath);
  if (await fileExists(ansiStylesPath)) sourceFiles.push(ansiStylesPath);

  // Load avatars
  const avatarsDir = path.join(agenticDir, 'avatars');
  const avatars = await loadYamlDir<AvatarConfig>(avatarsDir);
  for (const file of Object.keys(avatars)) {
    sourceFiles.push(path.join(avatarsDir, `${file}.yaml`));
  }

  // Load pack overrides
  const packsDir = path.join(agenticDir, 'packs');
  const packs = await loadYamlDir<Partial<CompiledPack>>(packsDir);
  for (const [packId, packConfig] of Object.entries(packs)) {
    // Merge pack-specific overrides
    if (packConfig.renderers) {
      renderers = { ...renderers, ...packConfig.renderers };
    }
    if (packConfig.avatars) {
      Object.assign(avatars, packConfig.avatars);
    }
    sourceFiles.push(path.join(packsDir, `${packId}.yaml`));
  }

  return {
    pack: {
      taxonomy,
      renderers,
      consensus,
      avatars,
      ansi_styles: ansiStyles || undefined,
    },
    sourceFiles,
  };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function computePackHash(pack: CompiledPack): string {
  const content = JSON.stringify(pack, Object.keys(pack).sort());
  return crypto.createHash('sha256').update(content).digest('hex').substring(0, 12);
}

function generatePackId(): string {
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0];
  const random = Math.random().toString(36).substring(2, 6);
  return `pack-${timestamp}-${random}`;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Compile agentic pack from project configuration
 */
export async function compilePack(input: CompilePackInput): Promise<CompilePackOutput> {
  try {
    const resolved = resolveProjectPaths(input.projectId);
    const agenticDir = resolved.subPath('architect', 'agentic');

    log(`agentic-compiler: Compiling pack from ${agenticDir}`);

    // Load all configs
    const { pack, sourceFiles } = await loadPackConfigs(agenticDir);

    // Generate pack ID and hash
    const packId = generatePackId();
    const packHash = computePackHash(pack);

    const result: CompileResult = {
      pack_id: packId,
      pack_hash: packHash,
      compiled_at: new Date().toISOString(),
      content: pack,
      source_files: sourceFiles,
    };

    // Write compiled pack to output
    const outputDir = resolved.subPath('architect', 'agentic', 'compiled');
    ensureDir(outputDir);
    const outputPath = path.join(outputDir, 'compiled_agentic_pack.json');
    await fs.writeFile(outputPath, JSON.stringify(result, null, 2), 'utf-8');

    log(`agentic-compiler: Pack compiled successfully (${packHash})`);
    log(`agentic-compiler: Output written to ${outputPath}`);

    return {
      status: 'compiled',
      result,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`agentic-compiler: Error compiling pack: ${message}`);
    return {
      status: 'error',
      error: message,
    };
  }
}

/**
 * Load a previously compiled pack
 */
export async function loadCompiledPack(resolved: ResolvedProjectPaths): Promise<CompileResult | null> {
  const outputPath = resolved.subPath('architect', 'agentic', 'compiled', 'compiled_agentic_pack.json');
  try {
    const content = await fs.readFile(outputPath, 'utf-8');
    return JSON.parse(content) as CompileResult;
  } catch {
    return null;
  }
}

/**
 * Get or compile pack (compile if not exists or outdated)
 */
export async function getOrCompilePack(
  resolved: ResolvedProjectPaths
): Promise<CompileResult> {
  // Try to load existing
  const existing = await loadCompiledPack(resolved);
  if (existing) {
    return existing;
  }

  // Compile new
  const result = await compilePack({ projectId: resolved.id });
  if (result.status === 'error' || !result.result) {
    throw new Error(result.error || 'Failed to compile pack');
  }

  return result.result;
}
