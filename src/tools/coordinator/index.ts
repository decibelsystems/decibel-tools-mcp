// ============================================================================
// Coordinator Domain Tools (ADR-0004)
// ============================================================================
// Minimal multi-chat coordination: locks, agents, event log.
// Design: single-writer per resource, fail loud on conflicts.
// ============================================================================

import { ToolSpec } from '../types.js';
import { toolSuccess, toolError, requireFields, withRunTracking } from '../shared/index.js';
import {
  coordRegister,
  CoordRegisterInput,
  coordHeartbeat,
  CoordHeartbeatInput,
  coordLock,
  CoordLockInput,
  coordUnlock,
  CoordUnlockInput,
  coordStatus,
  CoordStatusInput,
  coordLog,
  CoordLogInput,
  coordSend,
  CoordSendInput,
  coordInbox,
  CoordInboxInput,
  coordAck,
  CoordAckInput,
  isCoordError,
} from './coordinator.js';

// ============================================================================
// coord_register
// ============================================================================

export const coordRegisterTool: ToolSpec = {
  definition: {
    name: 'coord_register',
    description: 'Register an agent with the coordinator. Call this when an agent starts up to announce its presence and capabilities.',
    annotations: {
      title: 'Register Agent',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: {
          type: 'string',
          description: 'Unique identifier for this agent (e.g., "cymoril-code", "cymoril-test")',
        },
        capabilities: {
          type: 'array',
          items: { type: 'string' },
          description: 'What this agent can do (e.g., ["code", "architecture", "refactor"])',
        },
        project_id: {
          type: 'string',
          description: 'Optional project identifier. Uses default project if not specified.',
        },
      },
      required: ['agent_id', 'capabilities'],
    },
  },
  handler: withRunTracking(
    async (args) => {
      const input = args as CoordRegisterInput;
      requireFields(input, 'agent_id', 'capabilities');

      const result = await coordRegister(input);
      if (isCoordError(result)) {
        return toolError(result.error, result.message);
      }
      return toolSuccess(result);
    },
    { toolName: 'coord_register' }
  ),
};

// ============================================================================
// coord_heartbeat
// ============================================================================

export const coordHeartbeatTool: ToolSpec = {
  definition: {
    name: 'coord_heartbeat',
    description: 'Send a heartbeat to keep agent alive and optionally update status. Also cleans up stale agents and releases their locks. Call every 60s.',
    annotations: {
      title: 'Agent Heartbeat',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: {
          type: 'string',
          description: 'The agent sending the heartbeat',
        },
        current_task: {
          type: 'string',
          description: 'What the agent is currently working on',
        },
        status: {
          type: 'string',
          enum: ['active', 'busy', 'idle'],
          description: 'Current agent status',
        },
        project_id: {
          type: 'string',
          description: 'Optional project identifier. Uses default project if not specified.',
        },
      },
      required: ['agent_id'],
    },
  },
  handler: withRunTracking(
    async (args) => {
      const input = args as CoordHeartbeatInput;
      requireFields(input, 'agent_id');

      const result = await coordHeartbeat(input);
      if (isCoordError(result)) {
        return toolError(result.error, result.message);
      }
      return toolSuccess(result);
    },
    { toolName: 'coord_heartbeat' }
  ),
};

// ============================================================================
// coord_lock
// ============================================================================

export const coordLockTool: ToolSpec = {
  definition: {
    name: 'coord_lock',
    description: 'Acquire an exclusive lock on a resource. FAILS LOUD if already held by another agent. Locks expire after 10 minutes. Re-locking same resource by same agent refreshes the lock (idempotent).',
    annotations: {
      title: 'Acquire Lock',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: {
          type: 'string',
          description: 'The agent requesting the lock',
        },
        resource: {
          type: 'string',
          description: 'Resource to lock (file path, tool name, or domain like "domain:testing")',
        },
        reason: {
          type: 'string',
          description: 'Why you need this lock (for audit trail)',
        },
        project_id: {
          type: 'string',
          description: 'Optional project identifier. Uses default project if not specified.',
        },
      },
      required: ['agent_id', 'resource'],
    },
  },
  handler: withRunTracking(
    async (args) => {
      const input = args as CoordLockInput;
      requireFields(input, 'agent_id', 'resource');

      const result = await coordLock(input);
      if (isCoordError(result)) {
        return toolError(result.error, result.message);
      }
      return toolSuccess(result);
    },
    { toolName: 'coord_lock' }
  ),
};

// ============================================================================
// coord_unlock
// ============================================================================

export const coordUnlockTool: ToolSpec = {
  definition: {
    name: 'coord_unlock',
    description: 'Release a lock on a resource. Only the lock owner can release it. No-op if not held (idempotent).',
    annotations: {
      title: 'Release Lock',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: {
          type: 'string',
          description: 'The agent releasing the lock',
        },
        resource: {
          type: 'string',
          description: 'Resource to unlock',
        },
        project_id: {
          type: 'string',
          description: 'Optional project identifier. Uses default project if not specified.',
        },
      },
      required: ['agent_id', 'resource'],
    },
  },
  handler: withRunTracking(
    async (args) => {
      const input = args as CoordUnlockInput;
      requireFields(input, 'agent_id', 'resource');

      const result = await coordUnlock(input);
      if (isCoordError(result)) {
        return toolError(result.error, result.message);
      }
      return toolSuccess(result);
    },
    { toolName: 'coord_unlock' }
  ),
};

// ============================================================================
// coord_status
// ============================================================================

export const coordStatusTool: ToolSpec = {
  definition: {
    name: 'coord_status',
    description: 'Get current coordination status: all registered agents, active locks, and stale agents.',
    annotations: {
      title: 'Coordination Status',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'Optional project identifier. Uses default project if not specified.',
        },
      },
      required: [],
    },
  },
  handler: withRunTracking(
    async (args) => {
      const input = args as CoordStatusInput;

      const result = await coordStatus(input);
      if (isCoordError(result)) {
        return toolError(result.error, result.message);
      }
      return toolSuccess(result);
    },
    { toolName: 'coord_status' }
  ),
};

// ============================================================================
// coord_log
// ============================================================================

export const coordLogTool: ToolSpec = {
  definition: {
    name: 'coord_log',
    description: 'Query coordination event log. Returns recent events, optionally filtered by agent or action type.',
    annotations: {
      title: 'Query Event Log',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'Optional project identifier. Uses default project if not specified.',
        },
        limit: {
          type: 'number',
          description: 'Maximum events to return (default: 50)',
        },
        agent_id: {
          type: 'string',
          description: 'Filter by agent ID',
        },
        action: {
          type: 'string',
          description: 'Filter by action (e.g., "lock_acquired", "lock_denied", "registered")',
        },
      },
      required: [],
    },
  },
  handler: withRunTracking(
    async (args) => {
      const input = args as CoordLogInput;

      const result = await coordLog(input);
      if (isCoordError(result)) {
        return toolError(result.error, result.message);
      }
      return toolSuccess(result);
    },
    { toolName: 'coord_log' }
  ),
};

// ============================================================================
// coord_send (4a: agent messaging)
// ============================================================================

export const coordSendTool: ToolSpec = {
  definition: {
    name: 'coord_send',
    description: 'Send a message to another agent\'s persistent inbox. Messages persist across restarts. Use reply_to for request-reply patterns.',
    annotations: {
      title: 'Send Message',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Target agent ID' },
        from: { type: 'string', description: 'Sender agent ID' },
        intent: { type: 'string', description: 'Message intent (e.g., "delegate_task", "request_review", "notify")' },
        payload: { type: 'object', description: 'Message payload (action-specific data)', additionalProperties: true },
        reply_to: { type: 'string', description: 'Message ID this is replying to (for request-reply)' },
        ttl_ms: { type: 'number', description: 'Time-to-live in ms (default: 24 hours)' },
        project_id: { type: 'string', description: 'Optional project identifier' },
      },
      required: ['to', 'from', 'intent', 'payload'],
    },
  },
  handler: withRunTracking(
    async (args) => {
      const input = args as CoordSendInput;
      requireFields(input, 'to', 'from', 'intent', 'payload');
      const result = await coordSend(input);
      if (isCoordError(result)) return toolError(result.error, result.message);
      return toolSuccess(result);
    },
    { toolName: 'coord_send' }
  ),
};

// ============================================================================
// coord_inbox (4a: agent messaging)
// ============================================================================

export const coordInboxTool: ToolSpec = {
  definition: {
    name: 'coord_inbox',
    description: 'Check an agent\'s message inbox. Returns pending messages by default. Filter by status to see acked or completed messages.',
    annotations: {
      title: 'Check Inbox',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'Agent whose inbox to check' },
        status: { type: 'string', enum: ['pending', 'acked', 'completed'], description: 'Filter by message status' },
        limit: { type: 'number', description: 'Max messages to return (default: 20)' },
        project_id: { type: 'string', description: 'Optional project identifier' },
      },
      required: ['agent_id'],
    },
  },
  handler: withRunTracking(
    async (args) => {
      const input = args as CoordInboxInput;
      requireFields(input, 'agent_id');
      const result = await coordInbox(input);
      if (isCoordError(result)) return toolError(result.error, result.message);
      return toolSuccess(result);
    },
    { toolName: 'coord_inbox' }
  ),
};

// ============================================================================
// coord_ack (4a: agent messaging)
// ============================================================================

export const coordAckTool: ToolSpec = {
  definition: {
    name: 'coord_ack',
    description: 'Acknowledge a message and optionally post a result. Status goes pending→acked (no result) or pending→completed (with result). Can also complete a previously acked message.',
    annotations: {
      title: 'Acknowledge Message',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        message_id: { type: 'string', description: 'ID of the message to acknowledge' },
        agent_id: { type: 'string', description: 'Agent acknowledging the message' },
        result: { type: 'object', description: 'Optional result to attach (marks message as completed)', additionalProperties: true },
        project_id: { type: 'string', description: 'Optional project identifier' },
      },
      required: ['message_id', 'agent_id'],
    },
  },
  handler: withRunTracking(
    async (args) => {
      const input = args as CoordAckInput;
      requireFields(input, 'message_id', 'agent_id');
      const result = await coordAck(input);
      if (isCoordError(result)) return toolError(result.error, result.message);
      return toolSuccess(result);
    },
    { toolName: 'coord_ack' }
  ),
};

// ============================================================================
// Export All Tools
// ============================================================================

export const coordinatorTools: ToolSpec[] = [
  coordRegisterTool,
  coordHeartbeatTool,
  coordLockTool,
  coordUnlockTool,
  coordStatusTool,
  coordLogTool,
  coordSendTool,
  coordInboxTool,
  coordAckTool,
];
