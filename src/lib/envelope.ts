// ============================================================================
// Wire envelope — EPIC-0038 Phase 4
// ============================================================================
// The shape every non-MCP surface returns: /call, /batch, the REST shorthands,
// and (from Phase 4) any adapter that speaks to the runtime over HTTP. It
// lives here rather than inside httpServer.ts because the envelope is a
// contract between processes, not a detail of one server — adapters, the
// client SDK and the tests all need to agree on it, and only one of those is
// an HTTP server.
//
// THE FIELD TO TEST IS `ok`.
//
// `status` predates it and is kept for compatibility, but it cannot be used to
// detect success. `wrapSuccess` spreads the tool's payload over the envelope,
// so any tool that returns its own `status` — every sentinel issue (`open`,
// `closed`), every epic (`in_progress`), every job — overwrites `'executed'`
// with a domain value. Failure was detectable only because `wrapError` builds
// the field explicitly, which is why every consumer independently arrived at
// the negative test `status === 'error'` and none could ask the direct
// question. HQ's client carries that exact workaround with a comment
// explaining why.
//
// `ok` is written last, so no payload can clobber it, and it is a boolean, so
// it cannot collide with a domain vocabulary. Consumers should read `ok` when
// present and fall back to `status === 'error'` only for a runtime old enough
// not to send it.
//
// Adding rather than replacing was the deliberate choice (Ben, 2026-08-30):
// HQ, the VS Code extension, the iOS app and senken.pro all read this envelope
// today and none of them has to change for this to land. Retiring the
// ambiguous `status` is a later cleanup, once consumers have moved to `ok`.
// ============================================================================

export interface StatusEnvelope {
  status: 'executed' | 'error' | 'unavailable' | 'queued';
  /** True when the call was carried out. Authoritative — payloads cannot overwrite it. */
  ok?: boolean;
  [key: string]: unknown;
}

export interface ErrorEnvelope extends StatusEnvelope {
  status: 'error';
  ok: false;
  error: string;
  code?: string;
}

/**
 * Strip absolute paths out of an error before it goes on the wire.
 * Preserves URLs, relative paths, and the `.decibel/` portion of a project
 * path — that part is what makes an error actionable, the prefix is what
 * leaks a home directory.
 */
export function sanitizeErrorMessage(message: string): string {
  let sanitized = message;

  // Step 1: Preserve paths containing .decibel (keep the .decibel part, strip prefix)
  // /home/user/project/.decibel/foo -> .decibel/foo
  sanitized = sanitized.replace(/(?:\/[^\s:'"]+)?\/\.decibel\//g, '.decibel/');
  sanitized = sanitized.replace(/(?:[A-Z]:\\[^\s:'"]+)?\\\.decibel\\/gi, '.decibel\\');

  // Step 2: Remove absolute Unix paths (must start with / and have at least one more /)
  // But exclude URLs (http://, https://, file://)
  // Match: /home/user/file.txt, /var/log/app.log
  // Don't match: http://example.com, ./relative/path
  sanitized = sanitized.replace(
    /(?<!:)\/(?:home|Users|var|tmp|opt|usr|etc|media|mnt)\/[^\s:'"]+/g,
    '[path]'
  );

  // Step 3: Remove Windows absolute paths (C:\, D:\, etc.)
  sanitized = sanitized.replace(/[A-Z]:\\[^\s:'"]+/gi, '[path]');

  // Step 4: Sanitize any remaining usernames in paths that weren't caught
  sanitized = sanitized.replace(/\/home\/[^\/\s]+\//g, '/home/[user]/');
  sanitized = sanitized.replace(/\/Users\/[^\/\s]+\//g, '/Users/[user]/');
  sanitized = sanitized.replace(/C:\\Users\\[^\\]+\\/gi, 'C:\\Users\\[user]\\');

  return sanitized;
}

/** Wrap a successful result. `ok` goes last so the payload cannot overwrite it. */
export function wrapSuccess(data: Record<string, unknown>): StatusEnvelope {
  return { status: 'executed', ...data, ok: true };
}

/** Wrap a failure. Both fields are explicit, so both are trustworthy here. */
export function wrapError(error: string, code?: string): ErrorEnvelope {
  const sanitized = sanitizeErrorMessage(error);
  return { status: 'error', ok: false, error: sanitized, ...(code && { code }) };
}

/**
 * The one place that decides whether an envelope represents a failure.
 * Handles both dialects so a new client can talk to an old runtime.
 */
export function envelopeFailed(envelope: Record<string, unknown>): boolean {
  if (typeof envelope.ok === 'boolean') return !envelope.ok;
  return envelope.status === 'error';
}

/** HTTP status code for an envelope. 400 only when the call actually failed. */
export function envelopeHttpStatus(envelope: StatusEnvelope): number {
  return envelope.ok === false ? 400 : 200;
}
