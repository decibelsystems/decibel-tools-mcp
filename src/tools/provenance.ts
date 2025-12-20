import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { log } from '../config.js';
import { ensureDir } from '../dataRoot.js';
import { resolveProjectPaths, validateWritePath, ResolvedProjectPaths } from '../projectRegistry.js';
import YAML from 'yaml';

// ============================================================================
// Types
// ============================================================================

export type ActorType = 'human' | 'ai' | 'system';
export type ProvenanceAction = 'create' | 'edit' | 'review' | 'approve' | 'reject' | 'link' | 'apply' | 'derive';
export type ReasonCode =
  | 'initial_creation'
  | 'refinement'
  | 'correction'
  | 'clarification'
  | 'implementation'
  | 'graduation'
  | 'rejection'
  | 'linkage';

export interface ProvenanceEvent {
  event_id: string;
  timestamp: string;
  actor_id: string;
  actor_type: ActorType;
  action: ProvenanceAction;
  artifact_refs: string[];
  reason_code: ReasonCode;
  summary?: string;
  fingerprint_before?: string | null;
  fingerprint_after?: string;
}

export interface EmitProvenanceInput {
  actor_id: string;
  action: ProvenanceAction;
  artifact_refs: string[];
  reason_code: ReasonCode;
  summary?: string;
  fingerprint_before?: string | null;
  fingerprint_after?: string;
}

export interface ListProvenanceInput {
  projectId?: string;
  artifact_ref?: string;
  actor_id?: string;
  limit?: number;
}

export interface ListProvenanceOutput {
  events: ProvenanceEvent[];
  total_count: number;
}

export interface ProjectResolutionError {
  error: 'project_resolution_failed';
  message: string;
  hint: string;
}

// ============================================================================
// Helpers
// ============================================================================

function makeProjectResolutionError(operation: string): ProjectResolutionError {
  return {
    error: 'project_resolution_failed',
    message: `Cannot ${operation}: No project context available.`,
    hint:
      'Either specify projectId parameter, set DECIBEL_PROJECT_ROOT env var, or run from a directory containing .decibel/',
  };
}

/**
 * Generate a unique event ID in format PROV-{timestamp}-{ms}
 */
export function generateEventId(): string {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  const timeStr = now.toISOString().slice(11, 19).replace(/:/g, '');
  const ms = now.getMilliseconds().toString().padStart(3, '0');
  return `PROV-${dateStr}T${timeStr}-${ms}`;
}

/**
 * Hash content using SHA-256 and return first 16 characters.
 * Format: sha256:{first16chars}
 */
export function hashContent(content: string): string {
  const hash = crypto.createHash('sha256').update(content, 'utf-8').digest('hex');
  return `sha256:${hash.slice(0, 16)}`;
}

/**
 * Get the default actor ID from environment or fallback.
 * Checks DECIBEL_ACTOR_ID env var, falls back to human:$USER
 */
export function getDefaultActorId(): string {
  if (process.env.DECIBEL_ACTOR_ID) {
    return process.env.DECIBEL_ACTOR_ID;
  }
  const username = process.env.USER || process.env.USERNAME || 'unknown';
  return `human:${username}`;
}

/**
 * Determine actor type from actor ID prefix.
 */
function getActorType(actorId: string): ActorType {
  if (actorId.startsWith('ai:') || actorId.startsWith('agent:') || actorId.startsWith('claude:')) {
    return 'ai';
  }
  if (actorId.startsWith('system:') || actorId.startsWith('hook:') || actorId.startsWith('automation:')) {
    return 'system';
  }
  return 'human';
}

/**
 * Parse a provenance YAML file into a ProvenanceEvent.
 */
async function parseProvenanceFile(filePath: string): Promise<ProvenanceEvent | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const data = YAML.parse(content);

    if (!data.event_id || !data.timestamp || !data.actor_id || !data.action) {
      return null;
    }

    return {
      event_id: data.event_id,
      timestamp: data.timestamp,
      actor_id: data.actor_id,
      actor_type: data.actor_type || getActorType(data.actor_id),
      action: data.action,
      artifact_refs: data.artifact_refs || [],
      reason_code: data.reason_code || 'initial_creation',
      summary: data.summary,
      fingerprint_before: data.fingerprint_before,
      fingerprint_after: data.fingerprint_after,
    };
  } catch {
    return null;
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Emit a provenance event for an artifact action.
 * Stores in .decibel/provenance/events/PROV-*.yml
 *
 * @param input - Event data (actor_id, action, artifact_refs, reason_code, summary, fingerprints)
 * @param projectRoot - Root path of the project (or projectId to resolve)
 * @returns The event_id of the created provenance event
 */
export async function emitProvenance(
  input: EmitProvenanceInput,
  projectId?: string
): Promise<string | ProjectResolutionError> {
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(projectId);
  } catch {
    return makeProjectResolutionError('emit provenance event');
  }

  const eventId = generateEventId();
  const timestamp = new Date().toISOString();
  const actorType = getActorType(input.actor_id);

  const event: ProvenanceEvent = {
    event_id: eventId,
    timestamp,
    actor_id: input.actor_id,
    actor_type: actorType,
    action: input.action,
    artifact_refs: input.artifact_refs,
    reason_code: input.reason_code,
    summary: input.summary,
    fingerprint_before: input.fingerprint_before,
    fingerprint_after: input.fingerprint_after,
  };

  // Store in .decibel/provenance/events/
  const eventsDir = resolved.subPath('provenance', 'events');
  ensureDir(eventsDir);

  const filename = `${eventId}.yml`;
  const filePath = path.join(eventsDir, filename);

  // Build YAML content
  const yamlContent = YAML.stringify(event, { lineWidth: 0 });

  validateWritePath(filePath, resolved);
  await fs.writeFile(filePath, yamlContent, 'utf-8');

  log(`Provenance: Emitted ${eventId} for action "${input.action}" on ${input.artifact_refs.length} artifact(s)`);

  return eventId;
}

/**
 * List provenance events, optionally filtered by artifact_ref or actor_id.
 *
 * @param input - Filter criteria (projectId, artifact_ref, actor_id, limit)
 * @returns List of matching provenance events
 */
export async function listProvenance(
  input: ListProvenanceInput
): Promise<ListProvenanceOutput | ProjectResolutionError> {
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.projectId);
  } catch {
    return makeProjectResolutionError('list provenance events');
  }

  const eventsDir = resolved.subPath('provenance', 'events');
  const limit = input.limit || 50;
  let events: ProvenanceEvent[] = [];

  try {
    const files = await fs.readdir(eventsDir);
    const yamlFiles = files.filter(f => f.endsWith('.yml') && f.startsWith('PROV-'));

    for (const file of yamlFiles) {
      const filePath = path.join(eventsDir, file);
      const event = await parseProvenanceFile(filePath);
      if (!event) continue;

      // Apply filters
      if (input.artifact_ref && !event.artifact_refs.includes(input.artifact_ref)) {
        continue;
      }
      if (input.actor_id && event.actor_id !== input.actor_id) {
        continue;
      }

      events.push(event);
    }
  } catch {
    // Directory doesn't exist yet
  }

  const totalCount = events.length;

  // Sort by timestamp descending (newest first)
  events.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  // Apply limit
  events = events.slice(0, limit);

  return {
    events,
    total_count: totalCount,
  };
}

/**
 * Helper to emit provenance for artifact creation.
 * Convenience wrapper for emitProvenance with 'create' action.
 */
export async function emitCreateProvenance(
  artifactRef: string,
  content: string,
  summary: string,
  projectId?: string
): Promise<string | ProjectResolutionError> {
  const actorId = getDefaultActorId();
  const fingerprint = hashContent(content);

  return emitProvenance(
    {
      actor_id: actorId,
      action: 'create',
      artifact_refs: [artifactRef],
      reason_code: 'initial_creation',
      summary,
      fingerprint_before: null,
      fingerprint_after: fingerprint,
    },
    projectId
  );
}
