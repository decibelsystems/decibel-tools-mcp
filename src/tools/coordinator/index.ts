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
// Export All Tools
// ============================================================================

export const coordinatorTools: ToolSpec[] = [
  coordRegisterTool,
  coordHeartbeatTool,
  coordLockTool,
  coordUnlockTool,
  coordStatusTool,
  coordLogTool,
];
