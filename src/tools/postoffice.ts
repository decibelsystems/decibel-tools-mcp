// ============================================================================
// Post Office — the client half of EPIC-0037
// ============================================================================
// AgentHQ runs the post office: hq.agent_threads / hq.agent_messages behind an
// edge function that speaks seven verbs over a bearer credential. ChatGPT could
// already authenticate and write into a thread; Claude Code could not read or
// ack, which is the only thing that stood between here and a round trip.
//
// This module is a transport, not a second model. It does not cache messages,
// does not maintain its own inbox, and does not decide delivery — the runtime
// on the other side owns all of that. Everything here maps one facade action to
// one verb and surfaces what came back.
//
// THE CREDENTIAL IS NEVER LOGGED. It is read from the environment or
// ~/.decibel/config.yaml and used only as an Authorization header. It is not a
// tool argument, so it never reaches ~/.decibel/logs/dispatch.jsonl, which is
// written to disk in plaintext. Nothing here may put it in an error message
// either: an access token lasts an hour and a refresh token thirty days, so a
// leak into a rotated log file is not a momentary exposure.
// ============================================================================

import { log } from '../config.js';
import { loadConfig } from '../daemonConfig.js';

/**
 * Default origin. NOT hq.decibelsystems.com — that host has no DNS at all
 * (verified 2026-08-30, unresolvable). Pointing at it fails closed with a
 * DNS error rather than anything a caller can act on.
 */
const DEFAULT_HQ_URL = 'https://home.theagenthq.app';
const POST_OFFICE_PATH = '/agents/mcp';
const REQUEST_TIMEOUT_MS = 15_000;

/** The seven verbs the far side implements. An eighth is a two-repo change. */
export type PostOfficeVerb =
  | 'agents.list'
  | 'threads.open'
  | 'messages.send'
  | 'messages.read'
  | 'messages.ack'
  | 'handoff.request'
  | 'handoff.respond';

export interface PostOfficeError {
  error: string;
  code:
    | 'HQ_NOT_CONFIGURED'
    | 'HQ_UNAUTHORIZED'
    | 'HQ_FORBIDDEN'
    | 'HQ_NOT_FOUND'
    | 'HQ_REJECTED'
    | 'HQ_UNAVAILABLE';
  hint?: string;
}

export function isPostOfficeError(v: unknown): v is PostOfficeError {
  return typeof v === 'object' && v !== null && 'code' in v && 'error' in v;
}

interface Credential { url: string; token: string; }

/**
 * Resolve the endpoint and credential.
 *
 * Env wins over config so a session can point at a staging HQ without editing
 * a file that other processes read. Returns an error rather than throwing,
 * because "you have not set this up yet" is a normal state for most projects
 * and should read as instructions, not as a stack trace.
 */
function resolveCredential(): Credential | PostOfficeError {
  const cfg = loadConfig();
  const url = (process.env.DECIBEL_HQ_URL || cfg.hq?.url || DEFAULT_HQ_URL).replace(/\/+$/, '');
  const token = process.env.DECIBEL_HQ_TOKEN || cfg.hq?.token;

  if (!token) {
    return {
      error: 'No AgentHQ credential is configured, so this agent cannot reach the post office.',
      code: 'HQ_NOT_CONFIGURED',
      hint:
        'A credential is issued once and never recoverable. An org admin runs ' +
        "hq.issue_agent_token(p_org, p_agent_name, ...) and it returns the raw token exactly once. " +
        'Then set DECIBEL_HQ_TOKEN, or add hq.token to ~/.decibel/config.yaml. ' +
        `Endpoint currently resolves to ${url}${POST_OFFICE_PATH}.`,
    };
  }
  return { url, token };
}

/**
 * One request to the post office.
 *
 * Every failure is mapped to something a caller can act on. The far side is
 * deliberate about its status codes — 403 names the scope it wanted, 404
 * distinguishes an unknown recipient from an unknown thread — and flattening
 * those into "request failed" would discard the part that tells you what to fix.
 */
export async function postOfficeCall(
  verb: PostOfficeVerb,
  payload: Record<string, unknown> = {}
): Promise<Record<string, unknown> | PostOfficeError> {
  const cred = resolveCredential();
  if (isPostOfficeError(cred)) return cred;

  const endpoint = `${cred.url}${POST_OFFICE_PATH}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // The only place the credential appears. Not logged, not echoed.
        Authorization: `Bearer ${cred.token}`,
      },
      body: JSON.stringify({ verb, ...payload }),
      signal: controller.signal,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      error: `Could not reach the post office at ${endpoint}: ${detail}`,
      code: 'HQ_UNAVAILABLE',
      hint:
        'Check the host resolves and is reachable. Note hq.decibelsystems.com has no DNS — ' +
        `the working origin is ${DEFAULT_HQ_URL}.`,
    };
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {
      error: `Post office returned ${res.status} with a non-JSON body: ${text.slice(0, 200)}`,
      code: 'HQ_UNAVAILABLE',
    };
  }

  if (res.ok) {
    log(`PostOffice: ${verb} ok`);
    return body;
  }

  // The far side attaches `detail` to rejections that came from Postgres —
  // a CHECK bound, a type mismatch, a missing FK. That detail IS the
  // actionable half: "thread_rejected" says nothing, while
  // 'invalid input syntax for type uuid: "decibel-tools-mcp"' says exactly
  // what to pass instead. Dropping it was the first thing that cost a
  // round-trip attempt to diagnose.
  const base = typeof body.error === 'string' ? body.error : `HTTP ${res.status}`;
  const detail = typeof body.detail === 'string' ? body.detail : undefined;
  const message = detail ? `${base}: ${detail}` : base;
  if (res.status === 401) {
    return {
      error: `The post office rejected this agent's credential: ${message}`,
      code: 'HQ_UNAUTHORIZED',
      hint:
        'The token is wrong, revoked, or expired. Tokens are stored as a sha256 and cannot be ' +
        'recovered — issue a new one with hq.issue_agent_token and replace DECIBEL_HQ_TOKEN.',
    };
  }
  if (res.status === 403) {
    const required = typeof body.required === 'string' ? body.required : 'a scope';
    return {
      error: `This credential lacks ${required}.`,
      code: 'HQ_FORBIDDEN',
      hint: 'Reads need postoffice.read and writes need postoffice.write. Re-issue with the scope.',
    };
  }
  if (res.status === 404) {
    return { error: message, code: 'HQ_NOT_FOUND' };
  }
  if (res.status === 400) {
    const supported = Array.isArray(body.supported)
      ? ` Supported verbs: ${(body.supported as string[]).join(', ')}.`
      : '';
    return { error: `${message}${supported}`, code: 'HQ_REJECTED' };
  }
  return { error: `Post office error (${res.status}): ${message}`, code: 'HQ_UNAVAILABLE' };
}

// ============================================================================
// Verbs
// ============================================================================

export function agentsList() {
  return postOfficeCall('agents.list');
}

export interface ThreadsOpenInput {
  subject: string;
  /**
   * HQ project UUID, NOT a Decibel project slug. hq.agent_threads.project_id is
   * a uuid referencing hq.projects, so passing 'decibel-tools-mcp' is rejected
   * by Postgres rather than resolved. There is no lookup verb in the seven, so
   * a caller that does not already hold the uuid should omit this.
   */
  project?: string;
  intent?: string;
}
export function threadsOpen(input: ThreadsOpenInput) {
  return postOfficeCall('threads.open', {
    subject: input.subject,
    project: input.project,
    intent: input.intent,
  });
}

export interface MessagesSendInput {
  to: string;
  thread: string;
  summary: string;
  intent?: 'inform' | 'request' | 'respond';
  context_refs?: string[];
  request?: string;
  expected_output?: string;
}
export function messagesSend(input: MessagesSendInput) {
  return postOfficeCall('messages.send', { ...input });
}

export interface MessagesReadInput { thread?: string; status?: string; limit?: number; }
/**
 * Read this agent's mail.
 *
 * `status` is deliberately NOT defaulted, and polling must not set it to
 * 'sent'. The far side marks sent -> read as a side effect of reading, so a
 * mailbox query filtered to status='sent' never returns a message twice: a
 * reader that fetches and then dies before acting has silently consumed it,
 * and no restart recovers it. Unfiltered, the same message comes back as
 * 'read' and can still be acted on.
 *
 * That is the whole reason read and ack are separate verbs — at-least-once
 * beats at-most-once here, because a duplicated message costs a minute and a
 * dropped handoff stalls work invisibly.
 */
export function messagesRead(input: MessagesReadInput = {}) {
  const payload: Record<string, unknown> = {};
  if (input.thread) payload.thread = input.thread;
  if (input.status) payload.status = input.status;
  if (input.limit) payload.limit = input.limit;
  return postOfficeCall('messages.read', payload);
}

export interface MessagesAckInput { message: string; }
/** Idempotent by construction on the far side: acking twice is not an error. */
export function messagesAck(input: MessagesAckInput) {
  return postOfficeCall('messages.ack', { message: input.message });
}

export interface HandoffRequestInput { thread: string; to?: string; summary?: string; }
export function handoffRequest(input: HandoffRequestInput) {
  return postOfficeCall('handoff.request', { ...input });
}

export interface HandoffRespondInput { thread: string; accept: boolean; summary?: string; }
export function handoffRespond(input: HandoffRespondInput) {
  return postOfficeCall('handoff.respond', { ...input });
}
