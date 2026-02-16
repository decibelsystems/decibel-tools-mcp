Plan: Decibel Daemon — Unified Runtime

 Context

 Decibel Tools MCP currently has a dual-transport architecture (stdio vs HTTP) split across server.ts and httpServer.ts. Both
 transports share the same tool set but have divergent dispatch paths: HTTP has a legacy executeDojoTool() switch statement alongside
  the modular tool map, and graduated Dojo tools only load in stdio mode. G proposed a clean "one kernel, multiple transports"
 architecture with a daemon mode. This plan implements that vision in phases.

 Context bloat is the most urgent problem. The MCP server exposes 167 tools (~32K tokens) that get injected into the LLM's
 context on every turn. Claude reads the full tool registry every message, even when the user only needs git + sentinel.
 The facade pattern solves this: collapse 167 internal handlers into ~18 module-level tools that the LLM sees, with the
 kernel dispatching to the correct handler internally. This maps naturally to agentic design — each facade is a
 capability boundary an agent can reason about.

 The decibel-tools Python repo is effectively superseded — its useful concepts (tmux orchestration, admin UI) can be rebuilt natively
  in the MCP repo later. Archive it.

 The decibel-tools-marketplace plugin is deprecated. The marketplace directory is missing and the plugin reference in
 settings.json is broken. Phase 5 replaces it with @decibelsystems/tools as a scoped package with proper .mcp.json config.

 Phase 1: Tool Kernel Cleanup (ship first, prerequisite for everything)

 Goal: Single tool dispatch path, no transport-specific tool logic.

 1a. Eliminate legacy switch statement

 - File: src/httpServer.ts (lines 346-510)
 - Remove executeDojoTool() switch — all tools go through the modular httpToolMap (the default case already does this)
 - The switch handles: dojo, context, bench, policy, testspec tools — verify all are in src/tools/index.ts registry, then delete the
 switch

 1b. Unify graduated tool loading

 - File: src/server.ts (lines 32-34)
 - Graduated Dojo tools currently only load in stdio mode
 - Move graduated tool loading into src/tools/index.ts → getAllTools() so both transports get them

 1c. Extract tool kernel (agent-ready)

 - Create src/kernel.ts — single source of truth:
 export async function createKernel(): Promise<ToolKernel> {
   const tools = await getAllTools();
   const toolMap = new Map(tools.map(t => [t.definition.name, t]));
   return { tools, toolMap, dispatch(name, args, context?) };
 }
 - Both server.ts (stdio) and httpServer.ts (HTTP) import and use the kernel
 - Kernel owns: tool registry, dispatch, auth/pro gating, logging hooks

 Agent-readiness: dispatch context

 Every dispatch call accepts an optional DispatchContext:

 interface DispatchContext {
   agentId?: string;       // who is calling (e.g. "cymoril-code", "claude-code")
   runId?: string;         // vector run ID for tracing
   parentCallId?: string;  // if this call was delegated from another agent
   scope?: string;         // project ID or "portfolio"
 }

 This is plumbing, not policy. The kernel threads context to handlers but doesn't enforce it.
 decibel-agent already has agent IDs, run tracking, and scope — this lets it pass that
 through to MCP so coordinator logs, vector events, and provenance all know WHO did WHAT.

 How context arrives:
 - stdio: MCP JSON-RPC `params._meta` field (MCP spec allows client metadata)
 - HTTP: X-Agent-Id, X-Run-Id, X-Scope headers on /call requests
 - If absent: agentId defaults to "anonymous", runId to null — no breakage

 1d. Tool Facades — context-efficient public API

 Problem: 167 tools × ~196 tokens = ~32K tokens in LLM context every turn. Claude reads all tool definitions on every
 message even when the user only needs 2-3 modules. This is the single biggest context cost in the system.

 Solution: The kernel maintains the full internal tool registry (167 handlers), but exposes ~18 module-level facade
 tools to MCP clients. Each facade takes an `action` enum + `params` object and the kernel dispatches internally.

 What the LLM sees (MCP tools/list response):

 | Facade Tool | Description | Actions |
 |-------------|-------------|---------|
 | sentinel | Work tracking: epics, issues, test specs | create_issue, list_issues, read_issue, close_issue, log_epic, list_epics, read_epic, resolve_epic, list_epic_issues, create_test_spec, list_test_specs, compile_tests, scan, scan_codebase |
 | architect | Architecture decisions & policies | create_adr, read_adr, list_adrs, create_policy, read_policy, list_policies, compile_oversight |
 | dojo | Feature incubation: wishes, proposals, experiments | add_wish, list_wishes, create_proposal, scaffold_experiment, run_experiment, read_artifact, read_results, can_graduate, list, projects |
 | designer | Design decisions, crits, tokens | record_decision, list_principles, upsert_principle, crit, review_figma, sync_tokens, lateral_session, lateral_apply, lateral_close, list_crits |
 | git | Git history & issue linking | log_recent, changed_files, find_removal, blame_context, tags, status, find_linked_issues, auto_link, link_commit, list_linked_commits |
 | workflow | High-level composite operations | status, preflight, ship, investigate |
 | oracle | Strategic planning & health | next_actions, portfolio_summary, hygiene_report, roadmap |
 | roadmap | Objectives, milestones, epics | init, list, read, list_objectives, read_objective, link_epic, get_epic_context, get_health |
 | vector | Agent run tracking & drift | create_run, read_run, list_runs, log_event, complete_run, checkpoint, context_pack, assumptions, score_prompt |
 | context | Persistent memory & pinned facts | list, pin, unpin, refresh, event_append, event_search, artifact_list, artifact_read |
 | auditor | Code quality & health metrics | init, triage, refactor_score, naming_audit, log_health, health_dashboard, health_history |
 | forecast | Task estimation & capacity | parse, decompose, plan, record, calibration |
 | velocity | Productivity metrics & trends | snapshot, list, trends, contributor, install_hook, uninstall_hook |
 | coordinator | Multi-agent locking & heartbeat | register, lock, unlock, status, heartbeat, log |
 | friction | Pain point tracking | log, list, bump, resolve |
 | registry | Project discovery & management | add, remove, list, alias, resolve |
 | senken | Trade analysis (Postgres) | trade_summary, giveback_report, trade_review, list_overrides, apply_override |
 | feedback | Tool feedback | submit, list |
 | learnings | Technical knowledge | append, list |
 | provenance | Audit trail | list |

 Pro facades (gated by DECIBEL_PRO):
 | voice | Voice inbox & commands | inbox_add, inbox_list, inbox_process, inbox_sync, command |
 | studio | Creative asset generation | generate_image, get_image_status, create_artifact, update_artifact, list_artifacts, ... |
 | corpus | Pattern & playbook search | search, status |
 | agentic | Render, lint, compile, eval | render, lint, compile_pack, golden_eval |

 Schema design for each facade:

 {
   name: "sentinel",
   description: "Work tracking: epics, issues, test specs. Actions: create_issue, list_issues, read_issue, close_issue, log_epic, list_epics, read_epic, resolve_epic, list_epic_issues, create_test_spec, list_test_specs, compile_tests, scan, scan_codebase",
   inputSchema: {
     type: "object",
     properties: {
       action: {
         type: "string",
         enum: ["create_issue", "list_issues", "read_issue", ...],
         description: "The operation to perform"
       },
       params: {
         type: "object",
         description: "Action-specific parameters. Use action name to determine required fields.",
         additionalProperties: true
       }
     },
     required: ["action"]
   }
 }

 Context impact:
 - Before: 167 tools × ~196 tokens = ~32,700 tokens per turn
 - After:  ~22 facades × ~150 tokens = ~3,300 tokens per turn
 - Savings: ~29,400 tokens per turn (~90% reduction)

 SLM-readiness: tiered detail levels

 The facade registry should support multiple detail tiers so the same kernel can serve
 large models (Claude, GPT-4) and small local models (Phi, Gemma, Llama 3.2 small).
 This is a design constraint on the facade schema, not a separate feature.

 Three tiers:

 | Tier | Facades | Tokens | Consumer |
 |------|---------|--------|----------|
 | full | ~22, full descriptions + action enums | ~3,300 | Claude, GPT-4, Opus |
 | compact | ~22, one-line descriptions + action enums | ~1,500 | Mid-range SLM (7-13B) |
 | micro | 5 high-level facades only | ~500 | Tiny SLM (1-3B), edge, mobile |

 Micro tier surfaces only:
 - workflow (status, preflight, ship, investigate)
 - sentinel (create/list issues and epics)
 - git (history and changes)
 - context (remember and recall facts)
 - coordinator (check in, lock, message)

 Implementation: each FacadeSpec stores { description, compactDescription, microEligible }.
 The kernel's tools/list handler accepts a detail hint (from client _meta or HTTP query param)
 and filters accordingly. Default = full. No behavior change for existing clients.

 This costs ~zero extra work during facade implementation — just two extra string fields per
 facade definition. But it means when decibel-agent hands a task to a local SLM, the SLM
 gets a 500-token tool list instead of 3,300. Combined with facade filtering (Phase 4c),
 an SLM could see as few as 1-2 facades (~100 tokens) for a specific delegated task.

 Kernel dispatch (internal):

 // kernel.ts
 interface ToolKernel {
   facades: FacadeSpec[];              // what MCP clients see (~22 tools)
   internalTools: Map<string, Tool>;   // full registry (167 handlers)
   dispatch(facade: string, action: string, params: object): Promise<Result>;
 }

 function dispatch(facade: string, action: string, params: object) {
   const internalName = `${facade}_${action}`;  // e.g. "sentinel_create_issue"
   const tool = this.internalTools.get(internalName);
   if (!tool) throw new Error(`Unknown action "${action}" for ${facade}. Available: ${listActions(facade)}`);
   return tool.handler(params);
 }

 This maps cleanly to agentic design: each facade is a capability boundary. An orchestrator agent can delegate
 "use sentinel to track this bug" without knowing the 14 individual sentinel actions — it just knows the sentinel
 facade exists and handles work tracking. The action enum gives the LLM enough to pick the right operation without
 needing the full schema of every action's parameters in context.

 Deduplication (resolved by facades):
 - sentinel_createIssue + sentinel_create_issue → sentinel(action: "create_issue") — pick YAML backend
 - sentinel_listIssues + sentinel_list_repo_issues → sentinel(action: "list_issues") — unified
 - sentinel_scan + sentinel_scanData → sentinel(action: "scan") — pick TS backend
 - architect_record_arch_decision + architect_createAdr → architect(action: "create_adr") — unified

 Backward compatibility for HTTP clients:
 - The HTTP /call endpoint continues to accept both formats:
   { tool: "sentinel", action: "create_issue", params: {...} }   // new facade format
   { tool: "sentinel_createIssue", params: {...} }                // legacy direct format
 - The kernel resolves both to the same internal handler
 - No breaking change for Mother or ChatGPT integrations

 Critical files:
 - src/kernel.ts — facade registry, dispatch, action validation
 - src/facades/ — new directory, one file per facade defining actions + metadata
 - src/tools/index.ts — tool loading (keep, extend)
 - src/httpServer.ts — remove switch, use kernel
 - src/server.ts — use kernel
 - src/kernel.ts — new, extracted from both

 Phase 2: Transport Abstraction

 Goal: Clean transport layer so adding new transports is trivial.

 2a. Transport adapter interface

 - Create src/transports/types.ts:
 interface TransportAdapter {
   name: string;
   start(kernel: ToolKernel, config: TransportConfig): Promise<void>;
   stop(): Promise<void>;
 }

 2b. Stdio adapter

 - src/transports/stdio.ts — wraps existing StdioServerTransport
 - Session = process lifetime (no change)

 2c. HTTP/SSE adapter

 - src/transports/http.ts — wraps existing httpServer.ts logic
 - Session = connection lifecycle (needs session ID + cleanup)
 - Keep all REST shorthand endpoints (/call, /dojo/*, /health, etc.)

 2d. Both transports from one process

 - server.ts can start one or both:
 if (stdio) await stdioAdapter.start(kernel, config);
 if (http)  await httpAdapter.start(kernel, config);

 Critical files:
 - src/transports/types.ts — new
 - src/transports/stdio.ts — extracted from server.ts
 - src/transports/http.ts — extracted from httpServer.ts
 - src/server.ts — simplified orchestrator

 Phase 3: Daemon Mode

 Goal: decibel daemon as a long-running background process.

 3a. CLI interface

 decibel mcp --stdio              # single-client, agent CLI style
 decibel daemon --port 4888 --sse # local daemon for IDEs
 decibel daemon --port 4888 --sse --stdio  # both from one process

 3b. Daemon lifecycle

 - PID file: ~/.decibel/daemon.pid — write on start, remove on stop
 - Graceful shutdown: SIGTERM handler drains connections (30s timeout)
 - Lock check: On start, check if PID file exists + process alive → error with hint
 - Log file: ~/.decibel/logs/daemon.log (structured JSON lines)
 - Config file: ~/.decibel/config.yaml for persistent settings (port, pro features, log level)

 3c. macOS launchd integration

 - Provide com.decibel.daemon.plist template
 - decibel daemon install → copies to ~/Library/LaunchAgents/, loads
 - decibel daemon uninstall → unloads, removes
 - Auto-start on login, restart on crash

 3d. Health & monitoring

 - /health already exists — add version, uptime, tool count, connected clients
 - Add /ready endpoint for probes
 - Optional: /metrics for Prometheus

 Critical files:
 - src/server.ts — add daemon flag parsing, PID file, shutdown handler
 - src/daemon.ts — new, lifecycle management (install/uninstall/status)
 - templates/com.decibel.daemon.plist — new
 - ~/.decibel/config.yaml — new config format

 Phase 4: Agent Scaffolding (prep for decibel-agent)

 Goal: The MCP server becomes a capable coordination layer for autonomous agents. decibel-agent
 has in-memory A2A bus, delegation, and swarms — but these die when the process restarts. The MCP
 server provides the durable primitives that agents coordinate through. Build the seams now so
 decibel-agent can plug in without MCP-side refactors.

 Relationship: decibel-agent = orchestrator (in-memory, per-process)
              decibel-tools-mcp = shared persistence + coordination (durable, cross-process)

 4a. Coordinator messaging (persistent inbox)

 Extend coordinator module with message passing. The voice inbox pattern already proves this
 works on the filesystem — apply the same pattern to agent-to-agent messages.

 New tools (added to coordinator facade):
 - coord_send: Post message to agent inbox
   { to: string, from: string, intent: string, payload: object, reply_to?: string }
 - coord_inbox: Check messages for an agent
   { agent_id: string, status?: "pending"|"acked"|"completed", limit?: number }
 - coord_ack: Acknowledge receipt + optionally post result
   { message_id: string, agent_id: string, result?: object }

 Storage: .decibel/coordinator/messages/{agent_id}/MSG-{timestamp}-{from}.yaml
 Status lifecycle: pending → acked → completed (or expired after TTL)

 Design constraints:
 - File-per-message (not a single growing file) — enables concurrent agents
 - No fan-out: coord_send writes to ONE agent's inbox. Broadcast = N sends (caller's job)
 - TTL: Messages expire after 24h by default (configurable). Heartbeat sweep cleans them.
 - reply_to enables request-reply: Agent A sends with reply_to, Agent B acks with result,
   Agent A polls its inbox for the reply. No long-polling, no websockets — just files.

 Why not just use decibel-agent's A2A bus?
 - A2A bus is in-memory: dies on restart, invisible to other processes
 - Coordinator messages persist: survive restarts, visible to any agent connecting via MCP
 - Both can coexist: A2A for fast in-process chatter, coordinator for durable cross-process

 4b. Cross-agent vector runs

 Extend vector module so runs can reference other runs and agents.

 New fields in run metadata (backward-compatible additions to prompt.json):
 - delegated_by?: { agent_id: string, run_id: string }   // who asked for this run
 - delegated_to?: { agent_id: string, run_id: string }[]  // sub-runs spawned

 New event types:
 - 'delegation_sent': { target_agent, task, run_id }
 - 'delegation_received': { source_agent, task, run_id }
 - 'delegation_completed': { source_run_id, result_summary }

 New tool (added to vector facade):
 - vector_trace: Given a run_id, walk delegation chain and return the full tree
   { run_id: string, depth?: number }
   Returns: { run, parent?, children: [{run, children}...] }

 This gives you "Agent A asked Agent B which asked Agent C" traceability without
 changing the run model — just optional fields on existing structures.

 4c. Facade-aware tool filtering for agents

 decibel-agent currently filters 167 individual tool names by intent. With facades, this
 becomes dramatically simpler:

 Before (in decibel-agent McpToolRouter):
   if (intent === 'CREATE') filter = ['sentinel_createIssue', 'sentinel_create_issue',
     'dojo_create_proposal', 'dojo_add_wish', 'architect_createAdr', ...]

 After:
   if (intent === 'CREATE') facades = ['sentinel', 'dojo', 'architect', 'designer']

 The kernel can support this natively:
 - New endpoint: GET /facades — returns facade list with action enums (for agent bootstrap)
 - New dispatch option: kernel.dispatch(facade, action, params, { allowedFacades? })
   If allowedFacades is set, reject calls outside the list → prevents scope creep

 This means decibel-agent's tool filtering is just a facade allowlist per intent. No need to
 maintain a mapping of 167 tool names. The facade IS the capability boundary.

 4d. Batch dispatch

 Autonomous agents are token-sensitive. One MCP round-trip should handle multiple operations
 when they're independent.

 New endpoint: POST /batch
 {
   calls: [
     { facade: "sentinel", action: "list_issues", params: { project_id: "..." } },
     { facade: "git", action: "status", params: {} },
     { facade: "oracle", action: "next_actions", params: { project_id: "..." } }
   ],
   context: { agentId: "cymoril", runId: "RUN-..." }
 }

 Returns: { results: [Result, Result, Result] }  // same order

 - Calls execute in parallel (Promise.all through kernel.dispatch)
 - One HTTP round-trip instead of 3
 - Errors are per-call (one failure doesn't abort others)
 - MCP stdio: expose as a facade action: workflow(action: "batch", params: { calls: [...] })

 4e. Kernel dispatch hooks (observability seam)

 The kernel emits events on every dispatch — agents can subscribe for cross-agent awareness.

 kernel.on('dispatch', { facade, action, agentId, runId, timestamp })
 kernel.on('result', { facade, action, agentId, runId, duration_ms, success })
 kernel.on('error', { facade, action, agentId, runId, error })

 In daemon mode (Phase 3), these events are:
 - Written to ~/.decibel/logs/dispatch.jsonl (structured, queryable)
 - Available via GET /events?since={timestamp}&agent_id={id} (SSE stream or poll)

 This gives decibel-agent's coordinator real-time visibility into what other agents are doing
 through the shared daemon, without the agents needing to explicitly message each other.

 Critical files:
 - src/tools/coordinator/ — add send, inbox, ack tools
 - src/tools/vector/index.ts — add delegation fields, trace tool
 - src/kernel.ts — dispatch context, hooks, batch support, facade filtering
 - src/transports/http.ts — /batch endpoint, /facades endpoint, /events stream

 Phase 5: Bridge Mode (future)

 Goal: stdio clients transparently use HTTP daemon when present.

 decibel mcp --stdio --prefer-daemon http://127.0.0.1:4888

 - Stdio shim checks if daemon is alive (GET /health)
 - If yes: proxy JSON-RPC over HTTP to daemon
 - If no: fall back to in-process tool kernel
 - Benefit: one command works everywhere, but can share daemon state
 - Agent benefit: multiple Claude Code instances share one daemon → coordinator sees all agents

 Phase 6: Package & Extension (future)

 6a. Scoped package rename

 - decibel-tools-mcp → @decibelsystems/tools
 - Update .mcp.json, plugin cache, npm publish config
 - Kill decibel-tools-marketplace plugin — @decibelsystems/tools replaces it

 6b. VS Code/Cursor extension

 - Default: spawn stdio per workspace
 - Optional: connect to daemon over SSE
 - "Enable Codex" command → writes .codex/config.toml
 - Tree view for epics, issues, experiments

 6c. decibel-agent integration package

 - @decibel/agent-mcp-bridge — thin adapter that maps decibel-agent's McpToolRouter to facade API
 - Replaces current 167-tool filtering with facade allowlists
 - Wires DispatchContext (agentId, runId, scope) from agent core to MCP kernel
 - Uses /batch for multi-tool operations
 - Subscribes to /events for cross-agent observability

 What We're NOT Doing

 - Not merging decibel-tools Python repo — archive it, the MCP repo is the future
 - Not building the admin UI yet — that's a separate project (studio or dashboard)
 - Not changing the mother role name — breaking API change, separate migration
 - Not renaming SQL tables (mother_trades, mother_overrides) — database schema migration
 - Not building the full A2A protocol in MCP — decibel-agent owns orchestration, MCP owns persistence
 - Not adding long-polling or websockets for agent messaging — file-based inbox + polling is enough
 - Not building agent discovery/capability negotiation — coordinator register + heartbeat handles this

 Verification

 After Phase 1 (kernel + facades):
 - npm run build passes
 - npm test passes (unit + integration)
 - Start stdio mode: tools load, dispatch works
 - Start HTTP mode: all tools appear at /tools, /call works for every tool
 - Graduated tools appear in both transports
 - MCP tools/list returns ~22 facade tools (not 167)
 - Each facade dispatches to correct internal handler
 - Legacy direct tool names still work via HTTP /call endpoint
 - Context usage drops from ~32K to ~3-5K tokens
 - Deduplicated tools (sentinel create/list/scan) resolve to canonical implementation

 After Phase 2 (transport abstraction):
 - Same verification as Phase 1
 - Can start both transports simultaneously from one process

 After Phase 3 (daemon):
 - node dist/server.js --daemon --port 4888 starts, writes PID, logs to file
 - kill $(cat ~/.decibel/daemon.pid) gracefully shuts down
 - /health returns uptime + tool count
 - launchd plist installs and auto-starts

 After Phase 4 (agent scaffolding):
 - coord_send writes message to target agent's inbox directory
 - coord_inbox returns pending messages for an agent
 - coord_ack marks message as completed with optional result
 - vector_create_run accepts delegated_by field
 - vector_trace returns delegation chain for a run
 - POST /batch dispatches N calls in parallel, returns N results
 - GET /facades returns facade list with action enums
 - Dispatch hooks fire events to dispatch.jsonl
 - decibel-agent McpToolRouter can connect and use facade API

 Implementation Order

 Ship now (Phase 1a-1c): Kernel cleanup. 2-3 hours. Unblocks everything else. Low risk — only removes dead code paths.

 Ship with it (Phase 1d): Facades. 3-4 hours. Highest-impact change — 90% context reduction. Build alongside
 kernel since facades ARE the kernel's public API. This is what solves Rich's "Claude reads all 167 tools" problem.

 Ship next (Phase 2): 3-4 hours. Clean transport refactor, no behavior change.

 Ship after (Phase 3): 4-6 hours. New capability, daemon mode.

 Ship after daemon (Phase 4): 3-4 hours. Agent scaffolding — coordinator messaging, vector delegation,
 batch dispatch, facade filtering. These are small additions to existing modules, not new systems.
 Ship before decibel-agent goes autonomous so the seams are ready.

 Future (Phase 5-6): Bridge mode, scoped package, VS Code extension, agent bridge package.

 Settings cleanup (do during Phase 1):
 - Remove broken plugin reference from ~/.claude/settings.json (decibel-tools@decibel-tools-marketplace)
 - Update project .mcp.json to use local dev build (node dist/server.js) instead of npx
 - Clean up TOGETHER_API_KEY env var reference
 - Archive or delete decibel-tools-marketplace repo