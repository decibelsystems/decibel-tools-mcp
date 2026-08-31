// ============================================================================
// Post Office Tools — EPIC-0037
// ============================================================================
// Seven verbs, one per tool. The surface is deliberately exactly the far side's
// surface: an eighth verb is a contract change across two repos, so there is no
// convenience action here that composes several.
// ============================================================================

import { ToolSpec } from '../types.js';
import { toolSuccess, toolError, requireFields } from '../shared/index.js';
import {
  agentsList,
  threadsOpen,
  messagesSend,
  messagesRead,
  messagesAck,
  handoffRequest,
  handoffRespond,
  isPostOfficeError,
  type PostOfficeError,
  type ThreadsOpenInput,
  type MessagesSendInput,
  type MessagesReadInput,
  type MessagesAckInput,
  type HandoffRequestInput,
  type HandoffRespondInput,
} from '../postoffice.js';

/**
 * Post office failures carry a code and usually a hint that names the fix.
 * Flattening them into a bare message would discard the actionable half — an
 * unconfigured credential and a revoked one need different responses.
 */
function settle(result: Record<string, unknown> | PostOfficeError) {
  if (isPostOfficeError(result)) {
    return toolError(JSON.stringify({ error: result.error, code: result.code, hint: result.hint }));
  }
  return toolSuccess(result);
}

export const postOfficeAgentsListTool: ToolSpec = {
  definition: {
    name: 'postoffice_agents_list',
    description:
      'List agents reachable through AgentHQ, with live presence. A view over presence, not a second roster.',
    annotations: { title: 'List Agents', readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: { type: 'object', properties: {} },
  },
  handler: async () => {
    try {
      return settle(await agentsList());
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

export const postOfficeThreadsOpenTool: ToolSpec = {
  definition: {
    name: 'postoffice_threads_open',
    description:
      'Open a conversation thread. A thread is the unit a handoff happens inside — open one before sending.',
    annotations: { title: 'Open Thread', readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        subject: { type: 'string', description: 'What the thread is about. Required.' },
        project: { type: 'string', description: 'Optional HQ project UUID (not a Decibel project slug — hq.agent_threads.project_id is a uuid). Omit unless you hold the uuid.' },
        intent: { type: 'string', description: 'Optional free-text intent for the thread as a whole.' },
      },
      required: ['subject'],
    },
  },
  handler: async (args) => {
    try {
      requireFields(args, 'subject');
      return settle(await threadsOpen(args as unknown as ThreadsOpenInput));
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

export const postOfficeMessagesSendTool: ToolSpec = {
  definition: {
    name: 'postoffice_messages_send',
    description:
      'Send a message to another agent inside a thread. The recipient is addressed by agent name or id; the sender is taken from the credential and cannot be spoofed.',
    annotations: { title: 'Send Message', readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient agent name or uuid, in your org.' },
        thread: { type: 'string', description: 'Thread id from postoffice_threads_open.' },
        summary: { type: 'string', description: 'The message. Max 2048 characters.' },
        intent: {
          type: 'string',
          enum: ['inform', 'request', 'respond'],
          description: 'Why you are writing. Defaults to inform. Handoff intents are set by the handoff tools.',
        },
        context_refs: {
          type: 'array',
          items: { type: 'string' },
          description: 'Up to 32 references (issue ids, file paths, URLs) the recipient will need.',
        },
        request: { type: 'string', description: 'What you are asking for, when intent is request.' },
        expected_output: { type: 'string', description: 'What a good answer looks like. Max 1024 characters.' },
      },
      required: ['to', 'thread', 'summary'],
    },
  },
  handler: async (args) => {
    try {
      requireFields(args, 'to', 'thread', 'summary');
      return settle(await messagesSend(args as unknown as MessagesSendInput));
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

export const postOfficeMessagesReadTool: ToolSpec = {
  definition: {
    name: 'postoffice_messages_read',
    description:
      'Read your mail. Reading does NOT acknowledge — ack separately with postoffice_messages_ack once you have acted. Do not poll with status="sent": reading marks sent->read, so that filter cannot return a message twice and a reader that dies before acting loses it silently. Leave status unset to see everything still addressed to you.',
    annotations: { title: 'Read Messages', readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        thread: { type: 'string', description: 'Optional: restrict to one thread.' },
        status: {
          type: 'string',
          enum: ['sent', 'read', 'acked', 'failed'],
          description: 'Optional exact-status filter. Omit when polling — see the tool description.',
        },
        limit: { type: 'number', description: 'Max messages to return. Default 25, capped at 100.' },
      },
    },
  },
  handler: async (args) => {
    try {
      return settle(await messagesRead((args ?? {}) as unknown as MessagesReadInput));
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

export const postOfficeMessagesAckTool: ToolSpec = {
  definition: {
    name: 'postoffice_messages_ack',
    description:
      'Acknowledge a message: "I have this and I am acting on it." Separate from reading on purpose. Acking twice is not an error and does not change status, but it currently REWRITES acked_at to the later time — so a retry moves the recorded acknowledgement time. Only the recipient can ack.',
    // idempotentHint is FALSE deliberately, and it is not a mistake that the
    // description says acking twice is safe. Status is idempotent; acked_at is
    // not — a double ack measured 0.959s of drift against the live service on
    // 2026-08-31, and the drift always moves the timestamp LATER, which flatters
    // any ack-latency measure. A retry-on-timeout is exactly when a client acks
    // twice and exactly when the first ack probably landed, so the error
    // correlates with slow calls and hides them.
    //
    // Claiming idempotent here would tell a client that retrying is free. It is
    // free for delivery and not free for the record. HQ owns the fix
    // (coalesce(acked_at, now()) server-side); when it lands this flips back to
    // true and this comment explains why it ever moved.
    annotations: { title: 'Ack Message', readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    inputSchema: {
      type: 'object',
      properties: { message: { type: 'string', description: 'Message id to acknowledge.' } },
      required: ['message'],
    },
  },
  handler: async (args) => {
    try {
      requireFields(args, 'message');
      return settle(await messagesAck(args as unknown as MessagesAckInput));
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

export const postOfficeHandoffRequestTool: ToolSpec = {
  definition: {
    name: 'postoffice_handoff_request',
    description:
      'Ask another agent to take over a thread. Writes a handoff_request message so the handoff is legible in the thread it happened in, rather than in a side table.',
    annotations: { title: 'Request Handoff', readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        thread: { type: 'string', description: 'Thread to hand over.' },
        to: { type: 'string', description: 'Agent to hand it to, by name or uuid.' },
        summary: { type: 'string', description: 'What you are handing over and what state it is in.' },
      },
      required: ['thread'],
    },
  },
  handler: async (args) => {
    try {
      requireFields(args, 'thread');
      return settle(await handoffRequest(args as unknown as HandoffRequestInput));
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

export const postOfficeHandoffRespondTool: ToolSpec = {
  definition: {
    name: 'postoffice_handoff_respond',
    description:
      'Accept or decline a handoff you were offered. Writes a handoff_respond message into the same thread.',
    annotations: { title: 'Respond to Handoff', readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        thread: { type: 'string', description: 'Thread the handoff was offered in.' },
        accept: { type: 'boolean', description: 'true to take it, false to decline.' },
        summary: { type: 'string', description: 'Optional note explaining the decision.' },
      },
      required: ['thread', 'accept'],
    },
  },
  handler: async (args) => {
    try {
      requireFields(args, 'thread', 'accept');
      return settle(await handoffRespond(args as unknown as HandoffRespondInput));
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

export const postOfficeTools: ToolSpec[] = [
  postOfficeAgentsListTool,
  postOfficeThreadsOpenTool,
  postOfficeMessagesSendTool,
  postOfficeMessagesReadTool,
  postOfficeMessagesAckTool,
  postOfficeHandoffRequestTool,
  postOfficeHandoffRespondTool,
];
