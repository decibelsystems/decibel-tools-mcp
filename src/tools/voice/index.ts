// ============================================================================
// Voice Domain Tools
// ============================================================================
// Tools for voice command processing and inbox management.
// ============================================================================

import { ToolSpec } from '../types.js';
import { toolSuccess, toolError, requireFields } from '../shared/index.js';
import {
  voiceInboxAdd,
  VoiceInboxAddInput,
  voiceInboxList,
  VoiceInboxListInput,
  voiceInboxProcess,
  VoiceInboxProcessInput,
  voiceCommand,
  VoiceCommandInput,
  voiceInboxSync,
  VoiceInboxSyncInput,
} from '../voice.js';

// ============================================================================
// Voice Inbox Add Tool
// ============================================================================

export const voiceInboxAddTool: ToolSpec = {
  definition: {
    name: 'voice_inbox_add',
    description: 'Add a voice transcript to the inbox for processing. Parses intent automatically. Use process_immediately=true for instant execution.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'Project ID (optional, uses default)' },
        transcript: { type: 'string', description: 'The voice transcript text' },
        source: {
          type: 'string',
          enum: ['voice_cli', 'text_input', 'share_extension', 'api', 'mobile_app'],
          description: 'Source of the transcript (default: text_input)',
        },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags' },
        process_immediately: { type: 'boolean', description: 'Process now instead of queuing (default: false)' },
      },
      required: ['transcript'],
    },
  },
  handler: async (args) => {
    try {
      const input = args as VoiceInboxAddInput;
      requireFields(input, 'transcript');
      const result = await voiceInboxAdd(input);
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// Voice Inbox List Tool
// ============================================================================

export const voiceInboxListTool: ToolSpec = {
  definition: {
    name: 'voice_inbox_list',
    description: 'List voice inbox items, optionally filtered by status.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string', description: 'Project ID (optional, uses default)' },
        status: {
          type: 'string',
          enum: ['queued', 'processing', 'completed', 'failed'],
          description: 'Filter by status',
        },
        limit: { type: 'number', description: 'Max items to return' },
      },
    },
  },
  handler: async (args) => {
    try {
      const input = args as VoiceInboxListInput;
      const result = await voiceInboxList(input);
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// Voice Inbox Process Tool
// ============================================================================

export const voiceInboxProcessTool: ToolSpec = {
  definition: {
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
          description: 'Override the auto-detected intent',
        },
        override_params: { type: 'object', description: 'Override parsed parameters' },
      },
      required: ['inbox_id'],
    },
  },
  handler: async (args) => {
    try {
      const input = args as VoiceInboxProcessInput;
      requireFields(input, 'inbox_id');
      const result = await voiceInboxProcess(input);
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// Voice Command Tool
// ============================================================================

export const voiceCommandTool: ToolSpec = {
  definition: {
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
  handler: async (args) => {
    try {
      const input = args as VoiceCommandInput;
      requireFields(input, 'transcript');
      const result = await voiceCommand(input);
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// Voice Inbox Sync Tool
// ============================================================================

export const voiceInboxSyncTool: ToolSpec = {
  definition: {
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
  handler: async (args) => {
    try {
      const input = args as VoiceInboxSyncInput;
      requireFields(input, 'project_id');
      const result = await voiceInboxSync(input);
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// Export All Tools
// ============================================================================

export const voiceTools: ToolSpec[] = [
  voiceInboxAddTool,
  voiceInboxListTool,
  voiceInboxProcessTool,
  voiceCommandTool,
  voiceInboxSyncTool,
];
