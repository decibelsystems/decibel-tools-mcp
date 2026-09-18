/**
 * Runtime protocol version.
 *
 * A long-lived daemon can outlive the clients that connect to it — a terminal
 * opened yesterday, an editor extension pinned to an older release, a hook
 * script from a previous install. Without an explicit protocol handshake those
 * clients fail in confusing ways (a missing facade, a renamed action, a changed
 * envelope) rather than saying "we disagree about the contract".
 *
 * This version describes the **runtime wire contract**: the shape of `/call`,
 * `/batch`, `/health`, and the dispatch envelope. It is deliberately separate
 * from the package version — most releases do not change the contract, and a
 * client should not be forced to restart a healthy daemon just because a patch
 * shipped.
 *
 * Bump MAJOR when an existing client would break: a removed or renamed
 * endpoint, a changed request/response envelope, changed error semantics.
 * Bump MINOR for backward-compatible additions (a new endpoint, a new optional
 * field). Clients require an exact MAJOR match and tolerate any MINOR at or
 * above their own.
 */
export const RUNTIME_PROTOCOL_VERSION = '1.1';

/**
 * 1.1 — adds `GET /mcp/tools?tier=`, serving MCP tool definitions verbatim.
 *       Additive, so an older client is unaffected. A 1.1 CLIENT against a 1.0
 *       runtime is not: the thin stdio adapter has no local kernel and cannot
 *       answer tools/list without that endpoint. The minor-version rule
 *       (server.minor >= client.minor) turns that into an actionable
 *       "restart the runtime" at handshake time rather than a bare 404 on the
 *       first request — which is exactly the confusion this file exists to
 *       prevent, and which it caught the first time it was exercised for real.
 * 1.0 — initial contract: /call, /batch, /health, dispatch envelope.
 */

export interface ParsedProtocolVersion {
  major: number;
  minor: number;
}

/** Parse `"1.0"` into `{major: 1, minor: 0}`. Returns null if malformed. */
export function parseProtocolVersion(value: string): ParsedProtocolVersion | null {
  const match = /^(\d+)\.(\d+)$/.exec(value.trim());
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]) };
}

export type CompatibilityResult =
  | { compatible: true }
  | { compatible: false; reason: string };

/**
 * Is a runtime speaking `serverVersion` usable by a client requiring
 * `clientVersion`?
 *
 * Rules:
 *   - MAJOR must match exactly. A different major is a breaking contract change
 *     in either direction, so we refuse rather than guess.
 *   - The server's MINOR must be >= the client's. A newer server has every
 *     endpoint an older client knows about (minor bumps are additive), but an
 *     older server may be missing something the client depends on.
 *
 * An unparseable version is treated as incompatible. That is deliberate: a
 * daemon that cannot state its protocol is a daemon we cannot reason about, and
 * failing loudly beats dispatching into an unknown contract.
 */
export function isProtocolCompatible(
  serverVersion: string | undefined,
  clientVersion: string = RUNTIME_PROTOCOL_VERSION
): CompatibilityResult {
  if (!serverVersion) {
    return {
      compatible: false,
      reason:
        'runtime did not report a protocol_version (it predates protocol negotiation)',
    };
  }

  const server = parseProtocolVersion(serverVersion);
  const client = parseProtocolVersion(clientVersion);

  if (!server) {
    return { compatible: false, reason: `runtime reported an unparseable protocol_version "${serverVersion}"` };
  }
  if (!client) {
    return { compatible: false, reason: `client requested an unparseable protocol version "${clientVersion}"` };
  }

  if (server.major !== client.major) {
    return {
      compatible: false,
      reason: `runtime speaks protocol ${serverVersion}, client requires ${clientVersion} (major version mismatch)`,
    };
  }
  if (server.minor < client.minor) {
    return {
      compatible: false,
      reason: `runtime speaks protocol ${serverVersion}, client requires at least ${clientVersion} (runtime is older)`,
    };
  }

  return { compatible: true };
}
