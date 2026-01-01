/**
 * Supabase Client
 *
 * Connects to senken.pro Supabase for Decibel Studio Cloud Spine.
 * Uses environment variables for configuration.
 *
 * Environment:
 *   SUPABASE_URL - Supabase project URL
 *   SUPABASE_ANON_KEY - Supabase anon/public key
 *   SUPABASE_SERVICE_KEY - Optional service role key for admin operations
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { log } from '../config.js';

// ============================================================================
// Types (Runtime types - not strict DB generics)
// ============================================================================

export interface Project {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface Artifact {
  id: string;
  project_id: string;
  schema_version: string;
  type: 'image' | 'video' | '3d' | 'audio' | 'text';
  status: 'generating' | 'partial' | 'complete' | 'failed';
  progress: number | null;
  platform: 'ios' | 'web' | 'claude-code' | 'macos' | 'android';
  app_version: string;
  package_url: string | null;
  package_sha256: string | null;
  prompt: string | null;
  model: string | null;
  provider: string | null;
  parent_artifact_id: string | null;
  workflow_id: string | null;
  workflow_step_id: string | null;
  tags: string[];
  is_pinned: boolean;
  rating: number | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface ArtifactFile {
  id: string;
  artifact_id: string;
  path: string;
  role: 'preview' | 'render' | 'variant' | 'thumbnail';
  mime_type: string;
  bytes: number;
  sha256: string;
  width: number | null;
  height: number | null;
  storage_url: string | null;
  created_at: string;
}

export interface Device {
  id: string;
  user_id: string;
  name: string;
  platform: 'ios' | 'web' | 'claude-code' | 'macos' | 'android';
  capabilities: Record<string, unknown>;
  push_token: string | null;
  last_seen_at: string;
  created_at: string;
}

export interface Event {
  seq: number;
  project_id: string;
  type: string;
  payload: Record<string, unknown>;
  device_id: string | null;
  created_at: string;
}

export interface Job {
  id: string;
  owner_id: string;
  target_device_id: string | null;
  claimed_by_device_id: string | null;
  workflow_id: string | null;
  project_id: string | null;
  inputs: Record<string, unknown>;
  status: 'pending' | 'claimed' | 'running' | 'complete' | 'failed' | 'cancelled';
  progress: number | null;
  error_message: string | null;
  result_artifact_id: string | null;
  created_at: string;
  updated_at: string;
  claimed_at: string | null;
  completed_at: string | null;
  expires_at: string | null;
}

// ============================================================================
// Client Singleton
// ============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _client: SupabaseClient<any> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _serviceClient: SupabaseClient<any> | null = null;

/**
 * Get the Supabase client (anon key - respects RLS)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getSupabaseClient(): SupabaseClient<any> {
  if (_client) return _client;

  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      'Supabase not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY environment variables.'
    );
  }

  log('[Supabase] Initializing client');
  _client = createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return _client;
}

/**
 * Get the Supabase service client (service role key - bypasses RLS)
 * Use only for admin operations that require elevated privileges.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getSupabaseServiceClient(): SupabaseClient<any> {
  if (_serviceClient) return _serviceClient;

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      'Supabase service client not configured. Set SUPABASE_URL and SUPABASE_SERVICE_KEY.'
    );
  }

  log('[Supabase] Initializing service client');
  _serviceClient = createClient(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return _serviceClient;
}

/**
 * Check if Supabase is configured
 */
export function isSupabaseConfigured(): boolean {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);
}

/**
 * Set access token for user-scoped requests
 */
export async function setAccessToken(token: string): Promise<void> {
  const client = getSupabaseClient();
  await client.auth.setSession({
    access_token: token,
    refresh_token: '',
  });
}

// ============================================================================
// Error Helpers
// ============================================================================

export interface SupabaseError {
  error: string;
  code: string;
  details?: string;
}

export function isSupabaseError(result: unknown): result is SupabaseError {
  return typeof result === 'object' && result !== null && 'error' in result && 'code' in result;
}

export function formatSupabaseError(error: { message: string; code?: string }): SupabaseError {
  return {
    error: error.message,
    code: error.code || 'SUPABASE_ERROR',
    details: JSON.stringify(error),
  };
}
