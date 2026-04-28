/**
 * Peers Domain — thin pass-through to the claude-peers broker.
 *
 * The broker is a singleton HTTP server on localhost:7899 (default) that owns
 * peer registration, summaries, and message routing. We don't duplicate that —
 * we just expose `peers_list` so HQ and other clients can read live peer state
 * over the daemon's /call endpoint.
 *
 * If the broker isn't running, peers_list returns an actionable error rather
 * than crashing the daemon.
 */

import { ToolSpec } from './types.js';
import { toolSuccess, toolError } from './shared/index.js';

const BROKER_PORT = parseInt(process.env.CLAUDE_PEERS_PORT ?? '7899', 10);
const BROKER_URL = `http://127.0.0.1:${BROKER_PORT}`;
const REQUESTER_ID = 'decibel-daemon';

interface BrokerPeer {
  id: string;
  pid: number;
  cwd: string;
  git_root: string | null;
  tty: string | null;
  summary: string;
  registered_at: string;
  last_seen: string;
}

export const peersListTool: ToolSpec = {
  definition: {
    name: 'peers_list',
    description:
      'List live Claude Code peer instances registered with the claude-peers broker. Returns id, cwd, git_root, summary, last_seen, and registered_at for each peer. Use this to populate a peer roster UI or to check what other Claude sessions are active on the machine.',
    inputSchema: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          enum: ['machine', 'directory', 'repo'],
          description:
            'Discovery scope. machine = all peers on this host (default). directory = peers in the same cwd. repo = peers in the same git repo.',
        },
        cwd: {
          type: 'string',
          description: 'Required when scope is "directory" or "repo" without git_root.',
        },
        git_root: {
          type: 'string',
          description: 'Required when scope is "repo".',
        },
      },
    },
  },
  handler: async (args) => {
    try {
      const scope = (args.scope as string) || 'machine';
      const body: Record<string, unknown> = { requester_id: REQUESTER_ID, scope };
      if (args.cwd) body.cwd = args.cwd;
      if (args.git_root) body.git_root = args.git_root;

      const res = await fetch(`${BROKER_URL}/list-peers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(2000),
      });

      if (!res.ok) {
        return toolError(
          `claude-peers broker returned ${res.status}`,
          `Broker is at ${BROKER_URL}. Start any Claude Code session with claude-peers MCP enabled — it auto-launches the broker.`,
        );
      }

      const peers = (await res.json()) as BrokerPeer[];
      return toolSuccess({
        peers,
        count: peers.length,
        broker_url: BROKER_URL,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return toolError(
        `claude-peers broker unreachable: ${msg}`,
        `Expected broker at ${BROKER_URL}. The broker auto-launches when any Claude Code session has claude-peers MCP enabled. Check that at least one peer session is running, or set CLAUDE_PEERS_PORT to override the port.`,
      );
    }
  },
};

export const peersTools: ToolSpec[] = [peersListTool];
