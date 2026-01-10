/**
 * Studio Cloud Spine Tools
 *
 * Supabase-backed tools for Decibel Studio cloud sync.
 * Integrates with senken.pro Supabase for:
 *   - Project management
 *   - Artifact sync
 *   - Event streaming
 *   - Device registration
 *
 * EPIC-0002: Cloud Spine (Supabase Backend)
 */

import { ToolSpec } from '../types.js';
import { toolSuccess, toolError, requireFields } from '../shared/index.js';
import {
  getSupabaseClient,
  isSupabaseConfigured,
  formatSupabaseError,
  Project,
  Artifact,
  Device,
  Event,
  Job,
} from '../../lib/supabase.js';
import { log } from '../../config.js';

// ============================================================================
// Project Tools
// ============================================================================

export const studioListProjectsTool: ToolSpec = {
  definition: {
    name: 'studio_list_projects',
    description: 'List all Decibel Studio projects for the authenticated user.',
    annotations: {
      title: 'List Projects',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        include_deleted: {
          type: 'boolean',
          description: 'Include soft-deleted projects (default: false)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of projects to return (default: 50)',
        },
      },
    },
  },
  handler: async (args) => {
    try {
      if (!isSupabaseConfigured()) {
        return toolError('Supabase not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY.');
      }

      const client = getSupabaseClient();
      const includeDeleted = args.include_deleted ?? false;
      const limit = args.limit ?? 50;

      log(`[Studio] Listing projects (includeDeleted=${includeDeleted}, limit=${limit})`);

      let query = client
        .from('projects')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(limit);

      if (!includeDeleted) {
        query = query.is('deleted_at', null);
      }

      const { data, error } = await query;

      if (error) {
        return toolError(formatSupabaseError(error).error);
      }

      return toolSuccess({
        projects: data,
        count: data?.length ?? 0,
      });
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

export const studioCreateProjectTool: ToolSpec = {
  definition: {
    name: 'studio_create_project',
    description: 'Create a new Decibel Studio project.',
    annotations: {
      title: 'Create Project',
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Project name',
        },
        description: {
          type: 'string',
          description: 'Optional project description',
        },
      },
      required: ['name'],
    },
  },
  handler: async (args) => {
    try {
      requireFields(args, 'name');

      if (!isSupabaseConfigured()) {
        return toolError('Supabase not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY.');
      }

      const client = getSupabaseClient();

      // Get current user
      const { data: { user }, error: authError } = await client.auth.getUser();
      if (authError || !user) {
        return toolError('Not authenticated. Please sign in first.');
      }

      log(`[Studio] Creating project: ${args.name}`);

      const insert = {
        owner_id: user.id,
        name: args.name,
        description: args.description ?? null,
      };

      const { data, error } = await client
        .from('projects')
        .insert(insert)
        .select()
        .single();

      if (error) {
        return toolError(formatSupabaseError(error).error);
      }

      return toolSuccess({
        project: data,
        message: `Project "${args.name}" created successfully`,
      });
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

export const studioGetProjectTool: ToolSpec = {
  definition: {
    name: 'studio_get_project',
    description: 'Get details of a specific Decibel Studio project.',
    annotations: {
      title: 'Get Project',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'Project UUID',
        },
      },
      required: ['project_id'],
    },
  },
  handler: async (args) => {
    try {
      requireFields(args, 'project_id');

      if (!isSupabaseConfigured()) {
        return toolError('Supabase not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY.');
      }

      const client = getSupabaseClient();

      const { data, error } = await client
        .from('projects')
        .select('*')
        .eq('id', args.project_id)
        .single();

      if (error) {
        return toolError(formatSupabaseError(error).error);
      }

      return toolSuccess({ project: data });
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// Artifact Tools
// ============================================================================

export const studioListArtifactsTool: ToolSpec = {
  definition: {
    name: 'studio_list_artifacts',
    description: 'List artifacts in a Decibel Studio project.',
    annotations: {
      title: 'List Artifacts',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'Project UUID',
        },
        type: {
          type: 'string',
          enum: ['image', 'video', '3d', 'audio', 'text'],
          description: 'Filter by artifact type',
        },
        status: {
          type: 'string',
          enum: ['generating', 'partial', 'complete', 'failed'],
          description: 'Filter by status',
        },
        is_pinned: {
          type: 'boolean',
          description: 'Filter by pinned status',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of artifacts to return (default: 50)',
        },
      },
      required: ['project_id'],
    },
  },
  handler: async (args) => {
    try {
      requireFields(args, 'project_id');

      if (!isSupabaseConfigured()) {
        return toolError('Supabase not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY.');
      }

      const client = getSupabaseClient();
      const limit = args.limit ?? 50;

      log(`[Studio] Listing artifacts for project ${args.project_id}`);

      let query = client
        .from('artifacts')
        .select('*')
        .eq('project_id', args.project_id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (args.type) {
        query = query.eq('type', args.type);
      }
      if (args.status) {
        query = query.eq('status', args.status);
      }
      if (args.is_pinned !== undefined) {
        query = query.eq('is_pinned', args.is_pinned);
      }

      const { data, error } = await query;

      if (error) {
        return toolError(formatSupabaseError(error).error);
      }

      return toolSuccess({
        artifacts: data,
        count: data?.length ?? 0,
      });
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

export const studioCreateArtifactTool: ToolSpec = {
  definition: {
    name: 'studio_create_artifact',
    description: 'Create a new artifact record in a Decibel Studio project. Use this to register an artifact before uploading files.',
    annotations: {
      title: 'Create Artifact',
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'Project UUID',
        },
        type: {
          type: 'string',
          enum: ['image', 'video', '3d', 'audio', 'text'],
          description: 'Artifact type',
        },
        prompt: {
          type: 'string',
          description: 'Generation prompt',
        },
        model: {
          type: 'string',
          description: 'Model used for generation',
        },
        provider: {
          type: 'string',
          description: 'Provider (e.g., openai, anthropic)',
        },
        parent_artifact_id: {
          type: 'string',
          description: 'Parent artifact UUID for lineage tracking',
        },
        workflow_id: {
          type: 'string',
          description: 'Workflow ID if part of a workflow run',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags for organization',
        },
      },
      required: ['project_id', 'type'],
    },
  },
  handler: async (args) => {
    try {
      requireFields(args, 'project_id', 'type');

      if (!isSupabaseConfigured()) {
        return toolError('Supabase not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY.');
      }

      const client = getSupabaseClient();

      log(`[Studio] Creating artifact in project ${args.project_id}`);

      const insert = {
        project_id: args.project_id,
        type: args.type,
        status: 'generating',
        platform: 'claude-code',
        app_version: '1.0.0',
        prompt: args.prompt ?? null,
        model: args.model ?? null,
        provider: args.provider ?? null,
        parent_artifact_id: args.parent_artifact_id ?? null,
        workflow_id: args.workflow_id ?? null,
        tags: args.tags ?? [],
      };

      const { data, error } = await client
        .from('artifacts')
        .insert(insert)
        .select()
        .single();

      if (error) {
        return toolError(formatSupabaseError(error).error);
      }

      return toolSuccess({
        artifact: data,
        message: 'Artifact created successfully',
      });
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

export const studioUpdateArtifactTool: ToolSpec = {
  definition: {
    name: 'studio_update_artifact',
    description: 'Update an artifact record (status, rating, pinned, etc).',
    annotations: {
      title: 'Update Artifact',
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        artifact_id: {
          type: 'string',
          description: 'Artifact UUID',
        },
        status: {
          type: 'string',
          enum: ['generating', 'partial', 'complete', 'failed'],
          description: 'New status',
        },
        progress: {
          type: 'number',
          description: 'Progress 0.0-1.0',
        },
        package_url: {
          type: 'string',
          description: 'URL to .studio.zip in storage',
        },
        package_sha256: {
          type: 'string',
          description: 'SHA256 hash of the package',
        },
        is_pinned: {
          type: 'boolean',
          description: 'Pin/unpin the artifact',
        },
        rating: {
          type: 'number',
          description: 'Rating 1-5',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Replace tags',
        },
      },
      required: ['artifact_id'],
    },
  },
  handler: async (args) => {
    try {
      requireFields(args, 'artifact_id');

      if (!isSupabaseConfigured()) {
        return toolError('Supabase not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY.');
      }

      const client = getSupabaseClient();

      log(`[Studio] Updating artifact ${args.artifact_id}`);

      const update: Record<string, unknown> = {};
      if (args.status !== undefined) update.status = args.status;
      if (args.progress !== undefined) update.progress = args.progress;
      if (args.package_url !== undefined) update.package_url = args.package_url;
      if (args.package_sha256 !== undefined) update.package_sha256 = args.package_sha256;
      if (args.is_pinned !== undefined) update.is_pinned = args.is_pinned;
      if (args.rating !== undefined) update.rating = args.rating;
      if (args.tags !== undefined) update.tags = args.tags;

      const { data, error } = await client
        .from('artifacts')
        .update(update)
        .eq('id', args.artifact_id)
        .select()
        .single();

      if (error) {
        return toolError(formatSupabaseError(error).error);
      }

      return toolSuccess({
        artifact: data,
        message: 'Artifact updated successfully',
      });
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// Event Sync Tools
// ============================================================================

export const studioSyncEventsTool: ToolSpec = {
  definition: {
    name: 'studio_sync_events',
    description: 'Get events for a project since a given sequence number. Use for incremental sync.',
    annotations: {
      title: 'Sync Events',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'Project UUID',
        },
        since_seq: {
          type: 'number',
          description: 'Return events after this sequence number (exclusive). Use 0 for initial sync.',
        },
        limit: {
          type: 'number',
          description: 'Maximum events to return (default: 100)',
        },
      },
      required: ['project_id'],
    },
  },
  handler: async (args) => {
    try {
      requireFields(args, 'project_id');

      if (!isSupabaseConfigured()) {
        return toolError('Supabase not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY.');
      }

      const client = getSupabaseClient();
      const sinceSeq = args.since_seq ?? 0;
      const limit = args.limit ?? 100;

      log(`[Studio] Syncing events for project ${args.project_id} since seq ${sinceSeq}`);

      const { data, error } = await client
        .from('events')
        .select('*')
        .eq('project_id', args.project_id)
        .gt('seq', sinceSeq)
        .order('seq', { ascending: true })
        .limit(limit);

      if (error) {
        return toolError(formatSupabaseError(error).error);
      }

      const events = data ?? [];
      const lastSeq = events.length > 0 ? events[events.length - 1].seq : sinceSeq;

      return toolSuccess({
        events,
        count: events.length,
        last_seq: lastSeq,
        has_more: events.length === limit,
      });
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// Device Registration Tools
// ============================================================================

export const studioRegisterDeviceTool: ToolSpec = {
  definition: {
    name: 'studio_register_device',
    description: 'Register this device for Decibel Studio sync and job routing.',
    annotations: {
      title: 'Register Device',
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Device name (e.g., "Ben\'s MacBook Pro")',
        },
        capabilities: {
          type: 'object',
          description: 'Device capabilities (e.g., { "gpu": true, "local_generation": true })',
        },
      },
      required: ['name'],
    },
  },
  handler: async (args) => {
    try {
      requireFields(args, 'name');

      if (!isSupabaseConfigured()) {
        return toolError('Supabase not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY.');
      }

      const client = getSupabaseClient();

      // Get current user
      const { data: { user }, error: authError } = await client.auth.getUser();
      if (authError || !user) {
        return toolError('Not authenticated. Please sign in first.');
      }

      log(`[Studio] Registering device: ${args.name}`);

      const deviceData = {
        user_id: user.id,
        name: args.name,
        platform: 'claude-code' as const,
        capabilities: args.capabilities ?? { claude_code: true },
        last_seen_at: new Date().toISOString(),
      };

      // Upsert: insert or update existing device with same user_id + name
      const { data, error } = await client
        .from('devices')
        .upsert(deviceData, {
          onConflict: 'user_id,name',
          ignoreDuplicates: false,
        })
        .select()
        .single();

      if (error) {
        return toolError(formatSupabaseError(error).error);
      }

      return toolSuccess({
        device: data,
        message: 'Device registered successfully',
      });
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

export const studioHeartbeatTool: ToolSpec = {
  definition: {
    name: 'studio_heartbeat',
    description: 'Update device last_seen_at timestamp. Call periodically to keep device active.',
    annotations: {
      title: 'Device Heartbeat',
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        device_id: {
          type: 'string',
          description: 'Device UUID',
        },
      },
      required: ['device_id'],
    },
  },
  handler: async (args) => {
    try {
      requireFields(args, 'device_id');

      if (!isSupabaseConfigured()) {
        return toolError('Supabase not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY.');
      }

      const client = getSupabaseClient();

      const { error } = await client
        .from('devices')
        .update({ last_seen_at: new Date().toISOString() })
        .eq('id', args.device_id);

      if (error) {
        return toolError(formatSupabaseError(error).error);
      }

      return toolSuccess({ message: 'Heartbeat recorded' });
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// Job Tools
// ============================================================================

export const studioListJobsTool: ToolSpec = {
  definition: {
    name: 'studio_list_jobs',
    description: 'List pending jobs that can be claimed by this device.',
    annotations: {
      title: 'List Jobs',
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        device_id: {
          type: 'string',
          description: 'This device\'s UUID (to find targeted jobs)',
        },
        status: {
          type: 'string',
          enum: ['pending', 'claimed', 'running', 'complete', 'failed', 'cancelled'],
          description: 'Filter by status (default: pending)',
        },
        limit: {
          type: 'number',
          description: 'Maximum jobs to return (default: 20)',
        },
      },
    },
  },
  handler: async (args) => {
    try {
      if (!isSupabaseConfigured()) {
        return toolError('Supabase not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY.');
      }

      const client = getSupabaseClient();
      const status = args.status ?? 'pending';
      const limit = args.limit ?? 20;

      log(`[Studio] Listing jobs (status=${status})`);

      let query = client
        .from('jobs')
        .select('*')
        .eq('status', status)
        .order('created_at', { ascending: true })
        .limit(limit);

      // If device_id provided, also include jobs targeted at this device
      if (args.device_id) {
        query = query.or(`target_device_id.is.null,target_device_id.eq.${args.device_id}`);
      }

      const { data, error } = await query;

      if (error) {
        return toolError(formatSupabaseError(error).error);
      }

      return toolSuccess({
        jobs: data,
        count: data?.length ?? 0,
      });
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

export const studioClaimJobTool: ToolSpec = {
  definition: {
    name: 'studio_claim_job',
    description: 'Claim a pending job for this device to execute.',
    annotations: {
      title: 'Claim Job',
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        job_id: {
          type: 'string',
          description: 'Job UUID to claim',
        },
        device_id: {
          type: 'string',
          description: 'This device\'s UUID',
        },
      },
      required: ['job_id', 'device_id'],
    },
  },
  handler: async (args) => {
    try {
      requireFields(args, 'job_id', 'device_id');

      if (!isSupabaseConfigured()) {
        return toolError('Supabase not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY.');
      }

      const client = getSupabaseClient();

      log(`[Studio] Claiming job ${args.job_id} for device ${args.device_id}`);

      // Atomic claim: only update if still pending
      const { data, error } = await client
        .from('jobs')
        .update({
          status: 'claimed',
          claimed_by_device_id: args.device_id,
          claimed_at: new Date().toISOString(),
        })
        .eq('id', args.job_id)
        .eq('status', 'pending')
        .select()
        .single();

      if (error) {
        return toolError(formatSupabaseError(error).error);
      }

      if (!data) {
        return toolError('Job not found or already claimed');
      }

      return toolSuccess({
        job: data,
        message: 'Job claimed successfully',
      });
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

export const studioUpdateJobTool: ToolSpec = {
  definition: {
    name: 'studio_update_job',
    description: 'Update job progress or complete/fail the job.',
    annotations: {
      title: 'Update Job',
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        job_id: {
          type: 'string',
          description: 'Job UUID',
        },
        status: {
          type: 'string',
          enum: ['running', 'complete', 'failed', 'cancelled'],
          description: 'New status',
        },
        progress: {
          type: 'number',
          description: 'Progress 0.0-1.0',
        },
        error_message: {
          type: 'string',
          description: 'Error message if failed',
        },
        result_artifact_id: {
          type: 'string',
          description: 'Result artifact UUID if complete',
        },
      },
      required: ['job_id'],
    },
  },
  handler: async (args) => {
    try {
      requireFields(args, 'job_id');

      if (!isSupabaseConfigured()) {
        return toolError('Supabase not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY.');
      }

      const client = getSupabaseClient();

      log(`[Studio] Updating job ${args.job_id}`);

      const update: Record<string, unknown> = {};
      if (args.status !== undefined) update.status = args.status;
      if (args.progress !== undefined) update.progress = args.progress;
      if (args.error_message !== undefined) update.error_message = args.error_message;
      if (args.result_artifact_id !== undefined) update.result_artifact_id = args.result_artifact_id;

      if (args.status === 'complete' || args.status === 'failed') {
        update.completed_at = new Date().toISOString();
      }

      const { data, error } = await client
        .from('jobs')
        .update(update)
        .eq('id', args.job_id)
        .select()
        .single();

      if (error) {
        return toolError(formatSupabaseError(error).error);
      }

      return toolSuccess({
        job: data,
        message: 'Job updated successfully',
      });
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// Domain Export
// ============================================================================

export const studioCloudSpineTools: ToolSpec[] = [
  // Projects
  studioListProjectsTool,
  studioCreateProjectTool,
  studioGetProjectTool,
  // Artifacts
  studioListArtifactsTool,
  studioCreateArtifactTool,
  studioUpdateArtifactTool,
  // Events
  studioSyncEventsTool,
  // Devices
  studioRegisterDeviceTool,
  studioHeartbeatTool,
  // Jobs
  studioListJobsTool,
  studioClaimJobTool,
  studioUpdateJobTool,
];
