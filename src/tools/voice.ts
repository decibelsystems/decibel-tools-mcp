/**
 * Voice MCP Tools - Voice Input for Decibel Commands
 *
 * Provides MCP tools for:
 * - Managing a Voice Inbox (queued transcripts)
 * - Processing voice commands via AI intent parsing
 * - Routing to existing Decibel tools based on intent
 *
 * DOJO-EXP-0001: Voice Input for Decibel Commands
 * Status: Ungraduated experiment - feature flagged
 */

import fs from 'fs/promises';
import path from 'path';
import YAML from 'yaml';
import { log } from '../config.js';
import { ensureDir } from '../dataRoot.js';
import { resolveProjectRoot } from '../projectPaths.js';
import { getDefaultProject } from '../projectRegistry.js';
import { getSupabaseServiceClient, isSupabaseConfigured } from '../lib/supabase.js';

// ============================================================================
// Types
// ============================================================================

export type VoiceInboxStatus = 'queued' | 'processing' | 'completed' | 'failed';
export type VoiceInboxSource = 'voice_cli' | 'text_input' | 'share_extension' | 'api' | 'mobile_app';
export type VoiceIntent =
  | 'add_wish'
  | 'log_issue'
  | 'create_epic'
  | 'search'
  | 'ask_oracle'
  | 'log_crit'
  | 'log_friction'
  | 'record_learning'
  | 'unknown';

export interface VoiceInboxItem {
  id: string;
  transcript: string;
  source: VoiceInboxSource;
  created_at: string;
  status: VoiceInboxStatus;
  intent?: VoiceIntent;
  intent_confidence?: number;
  parsed_params?: Record<string, unknown>;
  result?: {
    tool_called: string;
    tool_result: unknown;
    completed_at: string;
  };
  error?: string;
  tags?: string[];
  project_id: string;
}

export interface VoiceBaseInput {
  project_id?: string;
}

// ============================================================================
// Voice Inbox Store Operations
// ============================================================================

interface VoiceRootResult {
  projectId: string;
  voiceRoot: string | null;  // null = use Supabase (remote mode)
  isRemote: boolean;
}

async function resolveVoiceRoot(projectId?: string): Promise<VoiceRootResult> {
  const targetProjectId = projectId || getDefaultProject()?.id;

  if (!targetProjectId) {
    // No project specified and no default - use Supabase with 'default' project
    if (isSupabaseConfigured()) {
      log('voice: No project specified, using Supabase with project_id="default"');
      return { projectId: 'default', voiceRoot: null, isRemote: true };
    }
    throw new Error('No project specified and no default project found.');
  }

  // Try to resolve local project
  try {
    const project = await resolveProjectRoot(targetProjectId);
    const voiceRoot = path.join(project.root, '.decibel', 'voice');
    return { projectId: targetProjectId, voiceRoot, isRemote: false };
  } catch (err) {
    // Local project not found - use Supabase if configured
    if (isSupabaseConfigured()) {
      log(`voice: Project "${targetProjectId}" not found locally, using Supabase`);
      return { projectId: targetProjectId, voiceRoot: null, isRemote: true };
    }
    // Re-throw original error if Supabase not available
    throw err;
  }
}

// Write inbox item to Supabase
async function writeToSupabase(item: VoiceInboxItem): Promise<void> {
  const supabase = getSupabaseServiceClient();

  const { error } = await supabase.from('voice_inbox').insert({
    id: item.id,
    project_id: item.project_id,
    transcript: item.transcript,
    source: item.source,
    intent: item.intent || 'unknown',
    intent_confidence: item.intent_confidence || 0,
    parsed_params: item.parsed_params || {},
    status: item.status,
    device: item.tags?.find(t => t.startsWith('device:'))?.replace('device:', '') || null,
    tags: item.tags || [],
    created_at: item.created_at,
  });

  if (error) {
    log(`voice: Supabase insert error: ${error.message}`);
    throw new Error(`Failed to write to Supabase: ${error.message}`);
  }

  log(`voice: Wrote inbox item ${item.id} to Supabase for project "${item.project_id}"`);
}

function generateInboxId(): string {
  const now = new Date();
  const timestamp = now.toISOString().replace(/[-:]/g, '').slice(0, 15).replace('T', '-');
  const random = Math.random().toString(36).substring(2, 6);
  return `voice-${timestamp}-${random}`;
}

// ============================================================================
// Intent Parsing
// ============================================================================

/**
 * Parse intent from a voice transcript.
 * Uses pattern matching for now - can be upgraded to AI-powered later.
 */
export function parseIntent(transcript: string): { intent: VoiceIntent; confidence: number; params: Record<string, unknown> } {
  const lower = transcript.toLowerCase().trim();

  // Wish patterns
  if (lower.match(/^(add|create|log|make)\s+(a\s+)?wish\s+(for|about|to)\s+/i) ||
      lower.match(/^i\s+wish\s+(we\s+)?(had|could|can)\s+/i) ||
      lower.match(/^wish\s*:\s*/i)) {
    const content = transcript
      .replace(/^(add|create|log|make)\s+(a\s+)?wish\s+(for|about|to)\s+/i, '')
      .replace(/^i\s+wish\s+(we\s+)?(had|could|can)\s+/i, '')
      .replace(/^wish\s*:\s*/i, '')
      .trim();
    return {
      intent: 'add_wish',
      confidence: 0.9,
      params: { capability: content, reason: 'Voice-captured wish' }
    };
  }

  // Issue patterns
  if (lower.match(/^(log|create|add|file)\s+(an?\s+)?issue\s+(about|for|with)\s+/i) ||
      lower.match(/^there\s+(is\s+)?(a\s+)?(bug|problem|issue)\s+(with|in)\s+/i) ||
      lower.match(/^(there'?s?\s+)?(a\s+)?(bug|problem|issue)\s+(with|in)\s+/i) ||
      lower.match(/^issue\s*:\s*/i)) {
    const content = transcript
      .replace(/^(log|create|add|file)\s+(an?\s+)?issue\s+(about|for|with)\s+/i, '')
      .replace(/^(there'?s?\s+)?(a\s+)?(bug|problem|issue)\s+(with|in)\s+/i, '')
      .replace(/^issue\s*:\s*/i, '')
      .trim();
    return {
      intent: 'log_issue',
      confidence: 0.85,
      params: { title: content, description: `Voice-logged: ${content}` }
    };
  }

  // Search patterns
  if (lower.match(/^(find|search|look\s+for|where\s+is|what\s+is|show\s+me)\s+/i) ||
      lower.match(/\?$/)) {
    const query = transcript
      .replace(/^(find|search|look\s+for|where\s+is|what\s+is|show\s+me)\s+/i, '')
      .replace(/\?$/, '')
      .trim();
    return {
      intent: 'search',
      confidence: 0.8,
      params: { query }
    };
  }

  // Oracle/roadmap patterns
  if (lower.match(/^(what'?s?\s+)?(the\s+)?(roadmap|status|progress|health)/i) ||
      lower.match(/^(how\s+are\s+we\s+doing|project\s+status)/i)) {
    return {
      intent: 'ask_oracle',
      confidence: 0.85,
      params: { query: transcript }
    };
  }

  // Crit patterns
  if (lower.match(/^(crit|critique|feedback|observation)\s*:\s*/i) ||
      lower.match(/^i\s+(noticed|think|feel|observe)/i)) {
    const content = transcript
      .replace(/^(crit|critique|feedback|observation)\s*:\s*/i, '')
      .replace(/^i\s+(noticed|think|feel|observe)\s+/i, '')
      .trim();
    return {
      intent: 'log_crit',
      confidence: 0.75,
      params: { observation: content, area: 'voice-captured' }
    };
  }

  // Friction patterns
  if (lower.match(/^(friction|pain\s+point|annoying|frustrating)\s*:\s*/i) ||
      lower.match(/^it\s+is\s+(really\s+)?(annoying|frustrating|painful)\s+(that|when)/i) ||
      lower.match(/^(it'?s?\s+)?(really\s+)?(annoying|frustrating|painful)\s+(that|when)/i)) {
    const content = transcript
      .replace(/^(friction|pain\s+point|annoying|frustrating)\s*:\s*/i, '')
      .replace(/^(it'?s?\s+)?(really\s+)?(annoying|frustrating|painful)\s+(that|when)\s*/i, '')
      .trim();
    return {
      intent: 'log_friction',
      confidence: 0.8,
      params: { description: content, context: 'voice-captured' }
    };
  }

  // Learning patterns
  if (lower.match(/^(learned|til|today\s+i\s+learned|lesson)\s*:\s*/i) ||
      lower.match(/^i\s+(just\s+)?(learned|discovered|figured\s+out)/i)) {
    const content = transcript
      .replace(/^(learned|til|today\s+i\s+learned|lesson)\s*:\s*/i, '')
      .replace(/^i\s+(just\s+)?(learned|discovered|figured\s+out)\s+(that\s+)?/i, '')
      .trim();
    return {
      intent: 'record_learning',
      confidence: 0.75,
      params: { title: content.slice(0, 50), content, category: 'other' }
    };
  }

  // Unknown - but still capture it
  return {
    intent: 'unknown',
    confidence: 0.3,
    params: { raw_transcript: transcript }
  };
}

// ============================================================================
// MCP Tool: Add to Voice Inbox
// ============================================================================

export interface VoiceInboxAddInput extends VoiceBaseInput {
  transcript: string;
  source?: VoiceInboxSource;
  tags?: string[];
  process_immediately?: boolean;
  explicit_intent?: string; // Human-labeled intent from button tap (bypasses pattern detection)
}

export interface VoiceInboxAddOutput {
  inbox_id: string;
  transcript: string;
  intent: VoiceIntent;
  intent_confidence: number;
  status: VoiceInboxStatus;
  immediate_result?: unknown;
}

export async function voiceInboxAdd(input: VoiceInboxAddInput): Promise<VoiceInboxAddOutput> {
  const { projectId, voiceRoot, isRemote } = await resolveVoiceRoot(input.project_id);

  const inboxId = generateInboxId();
  const timestamp = new Date().toISOString();

  // Use explicit intent if provided (human-labeled from button tap), otherwise parse
  let intent: VoiceIntent;
  let confidence: number;
  let params: Record<string, unknown>;

  if (input.explicit_intent) {
    // Human-labeled intent - use as-is with 100% confidence
    intent = input.explicit_intent as VoiceIntent;
    confidence = 1.0;
    params = { raw_transcript: input.transcript };
    log(`voice: Using explicit intent "${intent}" (human-labeled)`);
  } else {
    // Parse intent from transcript patterns
    const parsed = parseIntent(input.transcript);
    intent = parsed.intent;
    confidence = parsed.confidence;
    params = parsed.params;
  }

  const item: VoiceInboxItem = {
    id: inboxId,
    transcript: input.transcript,
    source: input.source || 'text_input',
    created_at: timestamp,
    status: 'queued',
    intent,
    intent_confidence: confidence,
    parsed_params: params,
    tags: input.tags,
    project_id: projectId,
  };

  // Write to storage (Supabase for remote, local files otherwise)
  if (isRemote) {
    await writeToSupabase(item);
  } else {
    const inboxDir = path.join(voiceRoot!, 'inbox');
    ensureDir(inboxDir);
    const itemPath = path.join(inboxDir, `${inboxId}.yaml`);
    await fs.writeFile(itemPath, YAML.stringify(item), 'utf-8');
    log(`voice: Added inbox item ${inboxId} with intent "${intent}" (${(confidence * 100).toFixed(0)}%)`);
  }

  // Process immediately if requested, confidence is high enough, and running locally
  // (Remote mode skips processing - messages are just stored for later sync)
  let immediateResult: unknown;
  if (input.process_immediately && confidence >= 0.7 && !isRemote) {
    const inboxDir = path.join(voiceRoot!, 'inbox');
    const itemPath = path.join(inboxDir, `${inboxId}.yaml`);
    try {
      immediateResult = await processVoiceItem(item, voiceRoot!);
      item.status = 'completed';
      item.result = {
        tool_called: intent,
        tool_result: immediateResult,
        completed_at: new Date().toISOString(),
      };
      await fs.writeFile(itemPath, YAML.stringify(item), 'utf-8');
    } catch (err) {
      item.status = 'failed';
      item.error = err instanceof Error ? err.message : String(err);
      await fs.writeFile(itemPath, YAML.stringify(item), 'utf-8');
    }
  }

  return {
    inbox_id: inboxId,
    transcript: input.transcript,
    intent,
    intent_confidence: confidence,
    status: item.status,
    immediate_result: immediateResult,
    // Include remote flag in output so caller knows message was stored remotely
    ...(isRemote && { stored_in: 'supabase' as const }),
  };
}

// ============================================================================
// MCP Tool: List Voice Inbox
// ============================================================================

export interface VoiceInboxListInput extends VoiceBaseInput {
  status?: VoiceInboxStatus;
  limit?: number;
}

export interface VoiceInboxListOutput {
  items: VoiceInboxItem[];
  total: number;
  by_status: Record<VoiceInboxStatus, number>;
}

export async function voiceInboxList(input: VoiceInboxListInput): Promise<VoiceInboxListOutput> {
  const { projectId, voiceRoot, isRemote } = await resolveVoiceRoot(input.project_id);

  const items: VoiceInboxItem[] = [];
  const byStatus: Record<VoiceInboxStatus, number> = {
    queued: 0,
    processing: 0,
    completed: 0,
    failed: 0,
  };

  if (isRemote) {
    // Query Supabase for remote mode
    const supabase = getSupabaseServiceClient();
    let query = supabase
      .from('voice_inbox')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });

    if (input.status) {
      query = query.eq('status', input.status);
    }
    if (input.limit) {
      query = query.limit(input.limit);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`Failed to query Supabase: ${error.message}`);
    }

    for (const row of data || []) {
      byStatus[row.status as VoiceInboxStatus]++;
      items.push({
        id: row.id,
        transcript: row.transcript,
        source: row.source as VoiceInboxSource,
        created_at: row.created_at,
        status: row.status as VoiceInboxStatus,
        intent: row.intent as VoiceIntent,
        intent_confidence: row.intent_confidence,
        parsed_params: row.parsed_params || {},
        result: row.result || undefined,
        error: row.error || undefined,
        tags: row.tags || [],
        project_id: row.project_id,
      });
    }
  } else {
    // Read from local filesystem
    const inboxDir = path.join(voiceRoot!, 'inbox');

    try {
      const files = await fs.readdir(inboxDir);
      for (const file of files) {
        if (!file.endsWith('.yaml')) continue;
        try {
          const content = await fs.readFile(path.join(inboxDir, file), 'utf-8');
          const item = YAML.parse(content) as VoiceInboxItem;
          byStatus[item.status]++;

          // Apply filters
          if (input.status && item.status !== input.status) continue;

          items.push(item);
        } catch {
          // Skip malformed files
        }
      }
    } catch {
      // Directory doesn't exist yet
    }

    // Sort by created_at descending (newest first)
    items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    // Apply limit
    if (input.limit) {
      items.splice(input.limit);
    }
  }

  return {
    items,
    total: items.length,
    by_status: byStatus,
  };
}

// ============================================================================
// MCP Tool: Process Voice Inbox Item
// ============================================================================

export interface VoiceInboxProcessInput extends VoiceBaseInput {
  inbox_id: string;
  override_intent?: VoiceIntent;
  override_params?: Record<string, unknown>;
}

export interface VoiceInboxProcessOutput {
  inbox_id: string;
  intent: VoiceIntent;
  tool_called: string;
  result: unknown;
  success: boolean;
}

/**
 * Process a voice inbox item by routing to the appropriate tool
 */
async function processVoiceItem(item: VoiceInboxItem, voiceRoot: string): Promise<unknown> {
  const intent = item.intent || 'unknown';
  const params = item.parsed_params || {};

  log(`voice: Processing item ${item.id} with intent "${intent}"`);

  // Import tools dynamically to avoid circular dependencies
  switch (intent) {
    case 'add_wish': {
      const { addWish } = await import('./dojo.js');
      const result = await addWish({
        project_id: item.project_id,
        capability: params.capability as string || item.transcript,
        reason: params.reason as string || 'Voice-captured wish',
        inputs: ['voice_transcript'],
        outputs: { captured_from: 'voice' },
      });
      return result;
    }

    case 'log_issue': {
      const { createIssue } = await import('./sentinel.js');
      const result = await createIssue({
        projectId: item.project_id,
        severity: 'med',
        title: params.title as string || item.transcript.slice(0, 80),
        details: params.description as string || `Voice-logged: ${item.transcript}`,
      });
      return result;
    }

    case 'log_crit': {
      const { logCrit } = await import('./crit.js');
      const result = await logCrit({
        projectId: item.project_id,
        area: params.area as string || 'general',
        observation: params.observation as string || item.transcript,
        sentiment: 'neutral',
        context: 'Voice-captured crit',
      });
      return result;
    }

    case 'log_friction': {
      const { logFriction } = await import('./friction.js');
      const result = await logFriction({
        projectId: item.project_id,
        context: params.context as string || 'voice-captured',
        description: params.description as string || item.transcript,
        source: 'human',
      });
      return result;
    }

    case 'record_learning': {
      const { appendLearning } = await import('./learnings.js');
      const result = await appendLearning({
        projectId: item.project_id,
        category: 'other' as const,
        title: params.title as string || item.transcript.slice(0, 50),
        content: params.content as string || item.transcript,
        tags: ['voice-captured'],
      });
      return result;
    }

    case 'search':
    case 'ask_oracle':
      // These require more complex handling - queue for now
      return {
        status: 'queued_for_ai',
        message: 'Search and oracle queries require AI processing - queued for later',
        query: params.query || item.transcript,
      };

    case 'unknown':
    default:
      return {
        status: 'needs_clarification',
        message: 'Could not determine intent from transcript',
        transcript: item.transcript,
        suggestion: 'Try starting with "wish:", "issue:", or "crit:" for clearer intent',
      };
  }
}

export async function voiceInboxProcess(input: VoiceInboxProcessInput): Promise<VoiceInboxProcessOutput> {
  const { voiceRoot, isRemote } = await resolveVoiceRoot(input.project_id);

  // Processing requires local project - sync first if running remotely
  if (isRemote) {
    throw new Error('Cannot process voice items in remote mode. Use voice_inbox_sync to pull messages to local first.');
  }

  const inboxDir = path.join(voiceRoot!, 'inbox');
  const itemPath = path.join(inboxDir, `${input.inbox_id}.yaml`);

  // Read item
  let item: VoiceInboxItem;
  try {
    const content = await fs.readFile(itemPath, 'utf-8');
    item = YAML.parse(content) as VoiceInboxItem;
  } catch {
    throw new Error(`Inbox item not found: ${input.inbox_id}`);
  }

  // Apply overrides
  if (input.override_intent) {
    item.intent = input.override_intent;
  }
  if (input.override_params) {
    item.parsed_params = { ...item.parsed_params, ...input.override_params };
  }

  // Mark as processing
  item.status = 'processing';
  await fs.writeFile(itemPath, YAML.stringify(item), 'utf-8');

  try {
    const result = await processVoiceItem(item, voiceRoot!);

    // Mark as completed
    item.status = 'completed';
    item.result = {
      tool_called: item.intent || 'unknown',
      tool_result: result,
      completed_at: new Date().toISOString(),
    };
    await fs.writeFile(itemPath, YAML.stringify(item), 'utf-8');

    return {
      inbox_id: input.inbox_id,
      intent: item.intent || 'unknown',
      tool_called: item.intent || 'unknown',
      result,
      success: true,
    };
  } catch (err) {
    // Mark as failed
    item.status = 'failed';
    item.error = err instanceof Error ? err.message : String(err);
    await fs.writeFile(itemPath, YAML.stringify(item), 'utf-8');

    return {
      inbox_id: input.inbox_id,
      intent: item.intent || 'unknown',
      tool_called: item.intent || 'unknown',
      result: { error: item.error },
      success: false,
    };
  }
}

// ============================================================================
// MCP Tool: Quick Voice Command (no inbox, direct processing)
// ============================================================================

export interface VoiceCommandInput extends VoiceBaseInput {
  transcript: string;
}

export interface VoiceCommandOutput {
  transcript: string;
  intent: VoiceIntent;
  intent_confidence: number;
  tool_called: string;
  result: unknown;
  success: boolean;
}

/**
 * Process a voice command directly without storing in inbox.
 * Use for real-time voice interactions.
 */
export async function voiceCommand(input: VoiceCommandInput): Promise<VoiceCommandOutput> {
  const { projectId, voiceRoot, isRemote } = await resolveVoiceRoot(input.project_id);

  // Direct processing requires local project
  if (isRemote) {
    throw new Error('Cannot process voice commands in remote mode. Use voice_inbox_add to queue, then sync locally.');
  }

  // Parse intent
  const { intent, confidence, params } = parseIntent(input.transcript);

  log(`voice: Direct command with intent "${intent}" (${(confidence * 100).toFixed(0)}%)`);

  // Create ephemeral item for processing
  const item: VoiceInboxItem = {
    id: 'ephemeral',
    transcript: input.transcript,
    source: 'text_input',
    created_at: new Date().toISOString(),
    status: 'processing',
    intent,
    intent_confidence: confidence,
    parsed_params: params,
    project_id: projectId,
  };

  try {
    const result = await processVoiceItem(item, voiceRoot!);
    return {
      transcript: input.transcript,
      intent,
      intent_confidence: confidence,
      tool_called: intent,
      result,
      success: true,
    };
  } catch (err) {
    return {
      transcript: input.transcript,
      intent,
      intent_confidence: confidence,
      tool_called: intent,
      result: { error: err instanceof Error ? err.message : String(err) },
      success: false,
    };
  }
}

// ============================================================================
// MCP Tool: Sync Voice Inbox from Supabase
// ============================================================================

export interface VoiceInboxSyncInput extends VoiceBaseInput {
  /** Only sync unsynced messages (default: true) */
  unsynced_only?: boolean;
  /** Maximum messages to sync (default: 50) */
  limit?: number;
  /** If true, also process synced messages immediately */
  process_after_sync?: boolean;
}

export interface VoiceInboxSyncOutput {
  synced: number;
  skipped: number;
  errors: number;
  items: Array<{
    id: string;
    transcript: string;
    intent: VoiceIntent;
    status: 'synced' | 'already_exists' | 'error';
    error?: string;
  }>;
}

/**
 * Sync voice inbox messages from Supabase to local project.
 * This is the "pull" operation - projects can call this to get pending messages.
 */
export async function voiceInboxSync(input: VoiceInboxSyncInput): Promise<VoiceInboxSyncOutput> {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase is not configured. Cannot sync from remote.');
  }

  // Must have a local project to sync to
  const targetProjectId = input.project_id || getDefaultProject()?.id;
  if (!targetProjectId) {
    throw new Error('No project specified and no default project found.');
  }

  // Verify local project exists
  let voiceRoot: string;
  try {
    const project = await resolveProjectRoot(targetProjectId);
    voiceRoot = path.join(project.root, '.decibel', 'voice');
  } catch (err) {
    throw new Error(`Cannot sync: local project "${targetProjectId}" not found.`);
  }

  const supabase = getSupabaseServiceClient();
  const unsyncedOnly = input.unsynced_only !== false; // default true
  const limit = input.limit || 50;

  // Query Supabase for messages
  let query = supabase
    .from('voice_inbox')
    .select('*')
    .eq('project_id', targetProjectId)
    .order('created_at', { ascending: true })
    .limit(limit);

  if (unsyncedOnly) {
    query = query.is('synced_at', null);
  }

  const { data: messages, error: queryError } = await query;

  if (queryError) {
    throw new Error(`Failed to query Supabase: ${queryError.message}`);
  }

  if (!messages || messages.length === 0) {
    log(`voice: No messages to sync for project "${targetProjectId}"`);
    return { synced: 0, skipped: 0, errors: 0, items: [] };
  }

  log(`voice: Found ${messages.length} messages to sync for project "${targetProjectId}"`);

  const inboxDir = path.join(voiceRoot, 'inbox');
  ensureDir(inboxDir);

  const results: VoiceInboxSyncOutput['items'] = [];
  const syncedIds: string[] = [];

  for (const msg of messages) {
    const itemPath = path.join(inboxDir, `${msg.id}.yaml`);

    // Check if already exists locally
    try {
      await fs.access(itemPath);
      // File exists - skip
      results.push({
        id: msg.id,
        transcript: msg.transcript,
        intent: msg.intent as VoiceIntent,
        status: 'already_exists',
      });
      continue;
    } catch {
      // File doesn't exist - good, we'll create it
    }

    // Convert Supabase row to VoiceInboxItem
    const item: VoiceInboxItem = {
      id: msg.id,
      transcript: msg.transcript,
      source: msg.source as VoiceInboxSource,
      created_at: msg.created_at,
      status: msg.status as VoiceInboxStatus,
      intent: msg.intent as VoiceIntent,
      intent_confidence: msg.intent_confidence,
      parsed_params: msg.parsed_params || {},
      result: msg.result || undefined,
      error: msg.error || undefined,
      tags: msg.tags || [],
      project_id: msg.project_id,
    };

    try {
      await fs.writeFile(itemPath, YAML.stringify(item), 'utf-8');
      syncedIds.push(msg.id);
      results.push({
        id: msg.id,
        transcript: msg.transcript,
        intent: msg.intent as VoiceIntent,
        status: 'synced',
      });
      log(`voice: Synced message ${msg.id}`);
    } catch (err) {
      results.push({
        id: msg.id,
        transcript: msg.transcript,
        intent: msg.intent as VoiceIntent,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Update synced_at in Supabase for successfully synced messages
  if (syncedIds.length > 0) {
    const { error: updateError } = await supabase
      .from('voice_inbox')
      .update({ synced_at: new Date().toISOString() })
      .in('id', syncedIds);

    if (updateError) {
      log(`voice: Warning - failed to update synced_at: ${updateError.message}`);
    }
  }

  const summary = {
    synced: results.filter(r => r.status === 'synced').length,
    skipped: results.filter(r => r.status === 'already_exists').length,
    errors: results.filter(r => r.status === 'error').length,
    items: results,
  };

  log(`voice: Sync complete - ${summary.synced} synced, ${summary.skipped} skipped, ${summary.errors} errors`);

  return summary;
}

// ============================================================================
// Exported Tool Definitions for MCP Registration
// ============================================================================

export const voiceToolDefinitions = [
  {
    name: 'voice_inbox_add',
    description: 'Add a voice transcript to the inbox for processing. Parses intent automatically. Use process_immediately=true for instant execution.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'Project ID (optional, uses default)' },
        transcript: { type: 'string', description: 'The voice transcript text' },
        source: {
          type: 'string',
          enum: ['voice_cli', 'text_input', 'share_extension', 'api'],
          description: 'Source of the transcript (default: text_input)'
        },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags' },
        process_immediately: { type: 'boolean', description: 'Process now instead of queuing (default: false)' },
      },
      required: ['transcript'],
    },
  },
  {
    name: 'voice_inbox_list',
    description: 'List voice inbox items, optionally filtered by status.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'Project ID (optional, uses default)' },
        status: {
          type: 'string',
          enum: ['queued', 'processing', 'completed', 'failed'],
          description: 'Filter by status'
        },
        limit: { type: 'number', description: 'Max items to return' },
      },
    },
  },
  {
    name: 'voice_inbox_process',
    description: 'Process a queued voice inbox item by routing to the appropriate tool.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'Project ID (optional, uses default)' },
        inbox_id: { type: 'string', description: 'The inbox item ID to process' },
        override_intent: {
          type: 'string',
          enum: ['add_wish', 'log_issue', 'create_epic', 'search', 'ask_oracle', 'log_crit', 'log_friction', 'record_learning'],
          description: 'Override the auto-detected intent'
        },
        override_params: { type: 'object', description: 'Override parsed parameters' },
      },
      required: ['inbox_id'],
    },
  },
  {
    name: 'voice_command',
    description: 'Process a voice command directly without storing in inbox. For real-time interactions.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'Project ID (optional, uses default)' },
        transcript: { type: 'string', description: 'The voice transcript to process' },
      },
      required: ['transcript'],
    },
  },
  {
    name: 'voice_inbox_sync',
    description: 'Sync voice inbox messages from Supabase to local project. Call this to pull down pending messages that were captured remotely (e.g., from iOS app). Like checking email.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'Project ID to sync messages for (required)' },
        unsynced_only: { type: 'boolean', description: 'Only sync messages not yet synced (default: true)' },
        limit: { type: 'number', description: 'Maximum messages to sync (default: 50)' },
        process_after_sync: { type: 'boolean', description: 'Process synced messages immediately (default: false)' },
      },
      required: ['project_id'],
    },
  },
];
