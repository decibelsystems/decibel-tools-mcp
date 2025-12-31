/**
 * Studio Tools - Generation Middleware
 *
 * Provides Studio-compatible API endpoints backed by OpenAI/TogetherAI.
 * Matches the interface expected by Rich's frontend (frontend_v0.2).
 *
 * Endpoints:
 *   Image Generation:
 *     POST /api/generate-flux-kontext-image
 *     GET  /api/flux-kontext-status/:taskId
 *
 *   3D Generation (Meshy-compatible):
 *     POST /api/meshy/generate
 *     GET  /api/meshy/status/:taskId
 *     POST /api/meshy/download
 *
 *   3D Generation (Tripo-compatible):
 *     POST /api/tripo/generate
 *     GET  /api/tripo/task/:taskId
 *     POST /api/tripo/download/:taskId
 *
 *   Video Generation (Kling-compatible):
 *     POST /api/generate-kling-video
 *     POST /api/generate-kling-text-video
 *     POST /api/generate-kling-avatar
 *     GET  /api/kling-video-status/:taskId
 */

import { log } from '../../config.js';

// ============================================================================
// Types
// ============================================================================

// --- Image Generation ---
export interface GenerateImageInput {
  asset_id: string;
  user_id: string;
  prompt: string;
  input_image?: string | null;
  aspect_ratio?: '16:9' | '9:16' | '1:1';
  model?: string;
}

export interface GenerateImageResult {
  task_id: string;
  asset_id: string;
  user_id: string;
  mode: 'generate' | 'edit';
  status: 'processing';
  estimated_time: number;
}

// --- 3D Generation (Meshy) ---
export interface MeshyGenerateInput {
  mode: 'text-to-3d-preview' | 'text-to-3d-refine' | 'image-to-3d' | 'multi-image-to-3d' | 'retexture';
  prompt?: string;
  image_url?: string;
  image_urls?: string[];
  preview_task_id?: string;
  model_input?: { input_task_id?: string; model_url?: string };
  parameters?: Record<string, unknown>;
  asset_id?: string;
  user_id?: string;
}

export interface MeshyGenerateResult {
  task_id: string;
  mode: string;
  status: 'PENDING';
  estimated_time: number;
}

// --- 3D Generation (Tripo) ---
export interface TripoGenerateInput {
  type: 'text_to_model' | 'image_to_model' | 'multiview_to_model';
  prompt?: string;
  image_url?: string;
  image_urls?: { front: string; left: string; back: string; right: string };
  parameters?: Record<string, unknown>;
  asset_id?: string;
  user_id?: string;
}

export interface TripoGenerateResult {
  task_id: string;
  type: string;
  status: 'queued';
  estimated_time: number;
}

// --- Video Generation (Kling) ---
export interface KlingVideoInput {
  asset_id: string;
  image_url?: string;
  prompt: string;
  negative_prompt?: string;
  duration?: 5 | 10;
  aspect_ratio?: '16:9' | '9:16' | '1:1';
  cfg_scale?: number;
  seed?: number;
  user_id?: string;
  model?: string;
  sound?: boolean;
}

export interface KlingAvatarInput {
  asset_id: string;
  image_url: string;
  audio_url: string;
  prompt?: string;
  user_id?: string;
  model?: string;
}

export interface KlingVideoResult {
  task_id: string;
  asset_id: string;
  status: 'processing';
  estimated_time: number;
  cost: number;
}

// --- Common ---
export interface TaskStatus {
  status: 'queued' | 'processing' | 'completed' | 'error' | 'failed' | 'PENDING' | 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED';
  progress: number;
  message: string;
  image_url?: string;
  video_url?: string;
  model_url?: string;
  thumbnail_url?: string;
  error?: string;
  task_error?: { message: string };
}

interface TaskRecord {
  task_id: string;
  task_type: 'image' | 'meshy' | 'tripo' | 'kling';
  asset_id: string;
  user_id: string;
  input: Record<string, unknown>;
  status: TaskStatus;
  created_at: Date;
  completed_at?: Date;
}

// ============================================================================
// Task Store (in-memory)
// ============================================================================

const taskStore = new Map<string, TaskRecord>();

function generateTaskId(prefix: string = 'task'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

// ============================================================================
// OpenAI Image Generation
// ============================================================================

async function callOpenAI(prompt: string, size: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable not set');
  }

  let dalleSize: '1024x1024' | '1792x1024' | '1024x1792' = '1024x1024';
  if (size === '16:9') dalleSize = '1792x1024';
  else if (size === '9:16') dalleSize = '1024x1792';

  log(`[Studio] Calling OpenAI DALL-E 3 with size ${dalleSize}`);

  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'dall-e-3',
      prompt: prompt,
      n: 1,
      size: dalleSize,
      quality: 'hd',
      response_format: 'url',
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || `OpenAI API error: ${response.status}`);
  }

  const result = await response.json();
  return result.data[0].url;
}

// ============================================================================
// TogetherAI Image Generation (FLUX)
// ============================================================================

async function callTogetherAI(prompt: string, size: string): Promise<string> {
  const apiKey = process.env.TOGETHER_API_KEY;
  if (!apiKey) {
    throw new Error('TOGETHER_API_KEY environment variable not set');
  }

  let width = 1024;
  let height = 1024;
  if (size === '16:9') { width = 1792; height = 1024; }
  else if (size === '9:16') { width = 1024; height = 1792; }

  log(`[Studio] Calling TogetherAI FLUX with size ${width}x${height}`);

  const response = await fetch('https://api.together.xyz/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'black-forest-labs/FLUX.1-schnell-Free',
      prompt: prompt,
      width: width,
      height: height,
      steps: 4,
      n: 1,
      response_format: 'url',
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || `TogetherAI API error: ${response.status}`);
  }

  const result = await response.json();
  return result.data[0].url;
}

// ============================================================================
// Background Processing
// ============================================================================

async function processImageTask(taskId: string): Promise<void> {
  const task = taskStore.get(taskId);
  if (!task) return;

  try {
    task.status = { status: 'processing', progress: 10, message: 'Starting image generation...' };

    const useTogetherAI = process.env.TOGETHER_API_KEY && !process.env.OPENAI_API_KEY;
    task.status.progress = 30;
    task.status.message = useTogetherAI ? 'Generating with TogetherAI FLUX...' : 'Generating with OpenAI DALL-E 3...';

    const prompt = task.input.prompt as string;
    const aspectRatio = (task.input.aspect_ratio as string) || '16:9';

    let imageUrl: string;
    if (useTogetherAI) {
      imageUrl = await callTogetherAI(prompt, aspectRatio);
    } else {
      imageUrl = await callOpenAI(prompt, aspectRatio);
    }

    task.status = { status: 'completed', progress: 100, message: 'Image generation complete', image_url: imageUrl };
    task.completed_at = new Date();
    log(`[Studio] Image task ${taskId} completed`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`[Studio] Image task ${taskId} failed: ${message}`);
    task.status = { status: 'error', progress: 0, message, error: message };
  }
}

async function process3DTask(taskId: string): Promise<void> {
  const task = taskStore.get(taskId);
  if (!task) return;

  // Simulate 3D generation (stub - no real API yet)
  try {
    task.status = { status: 'IN_PROGRESS', progress: 0, message: 'Queued for 3D generation...' };

    // Simulate progress over time
    for (let i = 1; i <= 10; i++) {
      await new Promise(r => setTimeout(r, 500));
      task.status.progress = i * 10;
      task.status.message = `Generating 3D model... ${i * 10}%`;
    }

    // Return a placeholder model URL
    task.status = {
      status: 'SUCCEEDED',
      progress: 100,
      message: '3D generation complete (stub)',
      model_url: 'https://placeholder.studio/model.glb',
      thumbnail_url: 'https://placeholder.studio/thumbnail.png',
    };
    task.completed_at = new Date();
    log(`[Studio] 3D task ${taskId} completed (stub)`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    task.status = { status: 'FAILED', progress: 0, message, task_error: { message } };
  }
}

async function processVideoTask(taskId: string): Promise<void> {
  const task = taskStore.get(taskId);
  if (!task) return;

  // Simulate video generation (stub - no real API yet)
  try {
    task.status = { status: 'processing', progress: 0, message: 'Queued for video generation...' };

    // Simulate progress over time
    for (let i = 1; i <= 10; i++) {
      await new Promise(r => setTimeout(r, 800));
      task.status.progress = i * 10;
      task.status.message = `Generating video... ${i * 10}%`;
    }

    task.status = {
      status: 'completed',
      progress: 100,
      message: 'Video generation complete (stub)',
      video_url: 'https://placeholder.studio/video.mp4',
    };
    task.completed_at = new Date();
    log(`[Studio] Video task ${taskId} completed (stub)`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    task.status = { status: 'error', progress: 0, message, error: message };
  }
}

// ============================================================================
// Image Generation API
// ============================================================================

export async function generateImage(input: GenerateImageInput): Promise<GenerateImageResult> {
  const taskId = generateTaskId('img');
  const mode = input.input_image ? 'edit' : 'generate';

  log(`[Studio] Starting image generation: task=${taskId}, mode=${mode}`);

  const task: TaskRecord = {
    task_id: taskId,
    task_type: 'image',
    asset_id: input.asset_id,
    user_id: input.user_id,
    input: input as unknown as Record<string, unknown>,
    status: { status: 'queued', progress: 0, message: 'Task queued' },
    created_at: new Date(),
  };

  taskStore.set(taskId, task);
  processImageTask(taskId).catch(err => log(`[Studio] Background error: ${err}`));

  return {
    task_id: taskId,
    asset_id: input.asset_id,
    user_id: input.user_id,
    mode,
    status: 'processing',
    estimated_time: 15,
  };
}

export function getImageStatus(taskId: string): TaskStatus | null {
  const task = taskStore.get(taskId);
  return task?.status || null;
}

// ============================================================================
// Meshy 3D Generation API
// ============================================================================

export async function meshyGenerate(input: MeshyGenerateInput): Promise<MeshyGenerateResult> {
  const taskId = generateTaskId('meshy');

  log(`[Studio] Starting Meshy generation: task=${taskId}, mode=${input.mode}`);

  const task: TaskRecord = {
    task_id: taskId,
    task_type: 'meshy',
    asset_id: input.asset_id || `asset_${Date.now()}`,
    user_id: input.user_id || 'anonymous',
    input: input as unknown as Record<string, unknown>,
    status: { status: 'PENDING', progress: 0, message: 'Task queued' },
    created_at: new Date(),
  };

  taskStore.set(taskId, task);
  process3DTask(taskId).catch(err => log(`[Studio] Background error: ${err}`));

  return {
    task_id: taskId,
    mode: input.mode,
    status: 'PENDING',
    estimated_time: 60,
  };
}

export function getMeshyStatus(taskId: string, mode?: string): TaskStatus | null {
  const task = taskStore.get(taskId);
  return task?.status || null;
}

export async function meshyDownload(taskId: string, assetId: string, userId: string): Promise<Record<string, unknown>> {
  const task = taskStore.get(taskId);
  if (!task || task.status.status !== 'SUCCEEDED') {
    throw new Error('Task not found or not completed');
  }

  return {
    asset_id: assetId,
    user_id: userId,
    model_url: task.status.model_url,
    thumbnail_url: task.status.thumbnail_url,
    format: 'glb',
  };
}

// ============================================================================
// Tripo 3D Generation API
// ============================================================================

export async function tripoGenerate(input: TripoGenerateInput): Promise<TripoGenerateResult> {
  const taskId = generateTaskId('tripo');

  log(`[Studio] Starting Tripo generation: task=${taskId}, type=${input.type}`);

  const task: TaskRecord = {
    task_id: taskId,
    task_type: 'tripo',
    asset_id: input.asset_id || `asset_${Date.now()}`,
    user_id: input.user_id || 'anonymous',
    input: input as unknown as Record<string, unknown>,
    status: { status: 'queued', progress: 0, message: 'Task queued' },
    created_at: new Date(),
  };

  taskStore.set(taskId, task);
  process3DTask(taskId).catch(err => log(`[Studio] Background error: ${err}`));

  return {
    task_id: taskId,
    type: input.type,
    status: 'queued',
    estimated_time: 120,
  };
}

export function getTripoStatus(taskId: string): TaskStatus | null {
  const task = taskStore.get(taskId);
  if (!task) return null;

  // Map internal status to Tripo status format
  const status = task.status;
  return {
    ...status,
    status: status.status === 'SUCCEEDED' ? 'completed' :
            status.status === 'FAILED' ? 'failed' :
            status.status === 'IN_PROGRESS' ? 'processing' : status.status as TaskStatus['status'],
  };
}

export async function tripoDownload(taskId: string, assetId: string, userId: string): Promise<Record<string, unknown>> {
  const task = taskStore.get(taskId);
  if (!task || (task.status.status !== 'SUCCEEDED' && task.status.status !== 'completed')) {
    throw new Error('Task not found or not completed');
  }

  return {
    asset_id: assetId,
    user_id: userId,
    model_url: task.status.model_url,
    thumbnail_url: task.status.thumbnail_url,
  };
}

// ============================================================================
// Kling Video Generation API
// ============================================================================

export async function klingGenerateVideo(input: KlingVideoInput): Promise<KlingVideoResult> {
  const taskId = generateTaskId('kling');

  log(`[Studio] Starting Kling image-to-video: task=${taskId}`);

  const task: TaskRecord = {
    task_id: taskId,
    task_type: 'kling',
    asset_id: input.asset_id,
    user_id: input.user_id || 'anonymous',
    input: input as unknown as Record<string, unknown>,
    status: { status: 'queued', progress: 0, message: 'Task queued' },
    created_at: new Date(),
  };

  taskStore.set(taskId, task);
  processVideoTask(taskId).catch(err => log(`[Studio] Background error: ${err}`));

  return {
    task_id: taskId,
    asset_id: input.asset_id,
    status: 'processing',
    estimated_time: 60,
    cost: input.duration === 10 ? 0.55 : 0.28,
  };
}

export async function klingGenerateTextVideo(input: KlingVideoInput): Promise<KlingVideoResult> {
  const taskId = generateTaskId('kling_txt');

  log(`[Studio] Starting Kling text-to-video: task=${taskId}`);

  const task: TaskRecord = {
    task_id: taskId,
    task_type: 'kling',
    asset_id: input.asset_id,
    user_id: input.user_id || 'anonymous',
    input: { ...input, mode: 'text-to-video' } as unknown as Record<string, unknown>,
    status: { status: 'queued', progress: 0, message: 'Task queued' },
    created_at: new Date(),
  };

  taskStore.set(taskId, task);
  processVideoTask(taskId).catch(err => log(`[Studio] Background error: ${err}`));

  return {
    task_id: taskId,
    asset_id: input.asset_id,
    status: 'processing',
    estimated_time: 60,
    cost: input.duration === 10 ? 0.55 : 0.28,
  };
}

export async function klingGenerateAvatar(input: KlingAvatarInput): Promise<KlingVideoResult> {
  const taskId = generateTaskId('kling_avatar');

  log(`[Studio] Starting Kling avatar: task=${taskId}`);

  const task: TaskRecord = {
    task_id: taskId,
    task_type: 'kling',
    asset_id: input.asset_id,
    user_id: input.user_id || 'anonymous',
    input: { ...input, mode: 'avatar' } as unknown as Record<string, unknown>,
    status: { status: 'queued', progress: 0, message: 'Task queued' },
    created_at: new Date(),
  };

  taskStore.set(taskId, task);
  processVideoTask(taskId).catch(err => log(`[Studio] Background error: ${err}`));

  return {
    task_id: taskId,
    asset_id: input.asset_id,
    status: 'processing',
    estimated_time: 90,
    cost: 0.35,
  };
}

export function getKlingStatus(taskId: string): TaskStatus | null {
  const task = taskStore.get(taskId);
  return task?.status || null;
}

// ============================================================================
// Utility Functions
// ============================================================================

export function listTasks(): Array<{ task_id: string; task_type: string; status: string; created_at: string }> {
  return Array.from(taskStore.values()).map(t => ({
    task_id: t.task_id,
    task_type: t.task_type,
    status: t.status.status,
    created_at: t.created_at.toISOString(),
  }));
}

export function cleanupTasks(olderThanMinutes: number = 30): number {
  const cutoff = Date.now() - olderThanMinutes * 60 * 1000;
  let cleaned = 0;

  for (const [taskId, task] of taskStore.entries()) {
    const isComplete = ['completed', 'error', 'SUCCEEDED', 'FAILED'].includes(task.status.status);
    if (isComplete && task.created_at.getTime() < cutoff) {
      taskStore.delete(taskId);
      cleaned++;
    }
  }

  return cleaned;
}

// ============================================================================
// Error Type Guard
// ============================================================================

export interface StudioError {
  error: string;
  code: string;
}

export function isStudioError(result: unknown): result is StudioError {
  return typeof result === 'object' && result !== null && 'error' in result && 'code' in result;
}
