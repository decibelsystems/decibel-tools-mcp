// ============================================================================
// @decibelsystems/tools/hq — SDK types
// ============================================================================
// The runtime-agnostic agent SDK. Any local runtime (Hermes, OpenClaw, Codex,
// Cursor, custom) uses defineAgent() to appear on HQ's /agents board and receive
// HQ commands — without ever holding Supabase creds. It talks ONLY to the local
// daemon's localhost endpoints (/agents/register, /heartbeat, /commands, /ack);
// the daemon is the single service_role authority. Contract co-designed w/ HQ
// (agent-runtime-contract.md). EPIC-0033.
// ============================================================================

/** A control command delivered from HQ to the agent (via the daemon inbox). */
export interface AgentCommand {
  id: string;
  kind: string;                 // 'message' | 'request_status' (HQ-allowlisted)
  payload: Record<string, unknown>;
}

/** What onCommand returns: the outcome the daemon writes back to Core. */
export interface CommandResult {
  status: 'done' | 'failed';
  result?: Record<string, unknown>;
  error?: string;
}

export interface DefineAgentOptions {
  /** Human label shown on the board (e.g. "design-reviewer"). */
  name: string;
  /** The runtime kind — drives HQ's badge/filter. */
  runtime: 'hermes' | 'openclaw' | 'codex' | 'cursor' | 'mcp' | 'custom';
  /** Stable session id for this run. Defaults to `${runtime}-${name}-${pid}`. */
  sessionKey?: string;
  /** Optional role tag (free text). */
  role?: string;
  /** Heartbeat cadence. Default 30s. Accepts ms number or "30s"/"1m". */
  heartbeat?: number | string;
  /** Command-inbox poll cadence. Default 5s. */
  pollInterval?: number | string;
  /** Command kinds this agent's onCommand handles. HQ only offers these. */
  capabilities?: string[];
  /** Working dir to report (→ HQ resolves to a project). Default process.cwd(). */
  cwd?: string;
  /** One-line "what I'm doing" shown on the board. */
  summary?: string;
  /** Extra meta written to the presence row (e.g. {tokens_in, current_file}). */
  meta?: Record<string, unknown>;
  /** Daemon base URL. Default discovered from ~/.decibel/daemon.meta, else :4888. */
  daemonUrl?: string;
  /** Receive an HQ command; return its outcome. If omitted, commands are acked
   *  'failed' with "no onCommand handler" (so HQ sees a definite result). */
  onCommand?: (cmd: AgentCommand, ctx: AgentContext) => Promise<CommandResult> | CommandResult;
  /** Optional structured logger; defaults to console. */
  logger?: (msg: string) => void;
}

/** Passed to onCommand — lets a handler update its own presence summary/meta. */
export interface AgentContext {
  sessionKey: string;
  runtime: string;
  /** Push a fresh summary/meta to the board immediately (out of band of heartbeat). */
  updatePresence: (patch: { summary?: string; meta?: Record<string, unknown> }) => Promise<void>;
}

/** The running agent handle returned by defineAgent(). */
export interface AgentHandle {
  sessionKey: string;
  runtime: string;
  /** Stop heartbeating + polling and mark the session ended (best effort). */
  stop: () => Promise<void>;
}
