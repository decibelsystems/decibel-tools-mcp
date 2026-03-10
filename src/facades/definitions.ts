// ============================================================================
// Facade Definitions — the complete registry of public-facing tool facades
// ============================================================================
// Each facade maps a module name + action enum to internal tool handlers.
// Action names are snake_case. Internal tool names match the kernel's toolMap.
//
// To add a new action: add the entry to the relevant facade's `actions` map
// and ensure the internal tool is registered in src/tools/index.ts.
// ============================================================================

import type { FacadeSpec } from './types.js';

// ============================================================================
// Core Facades (always available)
// ============================================================================

export const coreFacades: FacadeSpec[] = [
  {
    name: 'sentinel',
    description: 'Work tracking: epics, issues, test specs, code scanning. Use this instead of creating markdown files for task tracking. Always read_issue before update_issue. Pass project_id when filing cross-repo issues. For large features use log_epic first, then create_issue for sub-tasks. Actions: create_issue, read_issue, update_issue, close_issue, list_issues, log_epic, list_epics, read_epic, resolve_epic, list_epic_issues, create_test_spec, list_test_specs, compile_tests, audit_policies, scan, scan_data, scan_codebase, scan_config, scan_coverage, auto_link, link_commit, list_linked_commits',
    compactDescription: 'Track epics, issues, test specs, and scan code',
    microEligible: true,
    tier: 'core',
    actions: {
      create_issue: 'sentinel_create_issue',
      read_issue: 'sentinel_read_issue',
      update_issue: 'sentinel_updateIssue',
      close_issue: 'sentinel_close_issue',
      list_issues: 'sentinel_list_repo_issues',
      log_epic: 'sentinel_log_epic',
      list_epics: 'sentinel_list_epics',
      read_epic: 'sentinel_read_epic',
      resolve_epic: 'sentinel_resolve_epic',
      list_epic_issues: 'sentinel_list_epic_issues',
      create_test_spec: 'sentinel_createTestSpec',
      list_test_specs: 'sentinel_listTestSpecs',
      compile_tests: 'sentinel_compileTests',
      audit_policies: 'sentinel_auditPolicies',
      scan: 'sentinel_scan',
      scan_data: 'sentinel_scanData',
      scan_codebase: 'sentinel_scan_codebase',
      scan_config: 'sentinel_scan_config',
      scan_coverage: 'sentinel_scan_coverage',
      auto_link: 'sentinel_auto_link',
      link_commit: 'sentinel_link_commit',
      list_linked_commits: 'sentinel_list_linked_commits',
    },
  },

  {
    name: 'architect',
    description: 'Architecture decisions & policies. Use when recording WHY a technical decision was made, not WHAT was built (that is sentinel). create_adr for significant choices with trade-offs; record_arch_decision for quick inline rationale. Actions: create_adr, read_adr, list_adrs, create_policy, read_policy, list_policies, compile_oversight, record_arch_decision',
    compactDescription: 'Record ADRs, policies, and architecture decisions',
    microEligible: false,
    tier: 'core',
    actions: {
      create_adr: 'architect_createAdr',
      read_adr: 'architect_readAdr',
      list_adrs: 'architect_listAdrs',
      create_policy: 'architect_createPolicy',
      read_policy: 'architect_read_policy',
      list_policies: 'architect_listPolicies',
      compile_oversight: 'architect_compileOversight',
      record_arch_decision: 'architect_record_arch_decision',
    },
  },

  {
    name: 'dojo',
    description: 'Feature incubation: wishes, proposals, experiments, benchmarks. Use for ideas not yet ready to build. Flow: add_wish (just an idea) → create_proposal (ready to spec) → scaffold_experiment (ready to test) → can_graduate (ready to promote). Never create proposal/experiment files manually. Actions: add_wish, list_wishes, create_proposal, scaffold_experiment, run_experiment, read_artifact, read_results, can_graduate, list, projects, bench',
    compactDescription: 'Incubate ideas with wishes, proposals, experiments',
    microEligible: false,
    tier: 'core',
    actions: {
      add_wish: 'dojo_add_wish',
      list_wishes: 'dojo_list_wishes',
      create_proposal: 'dojo_create_proposal',
      scaffold_experiment: 'dojo_scaffold_experiment',
      run_experiment: 'dojo_run_experiment',
      read_artifact: 'dojo_read_artifact',
      read_results: 'dojo_read_results',
      can_graduate: 'dojo_can_graduate',
      list: 'dojo_list',
      projects: 'dojo_projects',
      bench: 'dojo_bench',
    },
  },

  {
    name: 'designer',
    description: 'Design decisions, principles, critiques, tokens, and lateral thinking. Use for UI/UX/visual choices (not architecture — that is architect). create_decision for design rationale; create_principle for reusable rules (e.g. "4px grid"); log_crit for design review feedback. Actions: create_decision, list_principles, create_principle, log_crit, review_figma, sync_tokens, check_parity, lateral_session, lateral_apply, lateral_close, list_crits',
    compactDescription: 'Design decisions, principles, crits, and tokens',
    microEligible: false,
    tier: 'core',
    actions: {
      create_decision: 'designer_record_design_decision',
      list_principles: 'designer_list_principles',
      create_principle: 'designer_upsert_principle',
      log_crit: 'designer_crit',
      review_figma: 'designer_review_figma',
      sync_tokens: 'designer_sync_tokens',
      check_parity: 'designer_check_parity',
      lateral_session: 'designer_lateral_session',
      lateral_apply: 'designer_lateral_apply',
      lateral_close: 'designer_lateral_close',
      list_crits: 'designer_list_crits',
    },
    aliases: {
      upsert_principle: 'create_principle',
      record_decision: 'create_decision',
      crit: 'log_crit',
    },
  },

  {
    name: 'git',
    description: 'Git history, changes, and issue linking. Use for investigating code history, not for making commits. find_removal to locate when code was deleted; blame_context for who changed a line and why; auto_link after commits to connect them to sentinel issues. Actions: log_recent, changed_files, find_removal, blame_context, tags, status, find_linked_issues',
    compactDescription: 'Git history, diffs, and forensics',
    microEligible: true,
    tier: 'core',
    actions: {
      log_recent: 'git_log_recent',
      changed_files: 'git_changed_files',
      find_removal: 'git_find_removal',
      blame_context: 'git_blame_context',
      tags: 'git_tags',
      status: 'git_status',
      find_linked_issues: 'git_find_linked_issues',
    },
  },

  {
    name: 'workflow',
    description: 'High-level composite operations that run multiple tools in sequence. status for a quick project health check; preflight before committing (runs lints, tests, scan); ship for release readiness; investigate to debug a reported issue with structured hypothesis tracking. Actions: status, preflight, ship, investigate',
    compactDescription: 'Status, preflight, ship, investigate',
    microEligible: true,
    tier: 'core',
    actions: {
      status: 'workflow_status',
      preflight: 'workflow_preflight',
      ship: 'workflow_ship',
      investigate: 'workflow_investigate',
    },
  },

  {
    name: 'oracle',
    description: 'Strategic planning, health scores, and recommendations. Use when asked "what should I work on?" or "how healthy is the project?". next_actions for prioritized task suggestions; portfolio_summary for cross-project overview; hygiene_report for tech debt assessment. Actions: next_actions, portfolio_summary, hygiene_report, roadmap',
    compactDescription: 'AI-powered priorities and project health',
    microEligible: false,
    tier: 'core',
    actions: {
      next_actions: 'oracle_next_actions',
      portfolio_summary: 'oracle_portfolio_summary',
      hygiene_report: 'oracle_hygiene_report',
      roadmap: 'oracle_roadmap',
    },
  },

  {
    name: 'roadmap',
    description: 'Objectives, milestones, and epic tracking. Use for high-level planning (quarters/releases), not individual tasks (that is sentinel). init to bootstrap a roadmap; link_epic to connect sentinel epics to objectives; get_health for milestone progress. Actions: init, list, read, list_objectives, read_objective, link_epic, get_epic_context, get_health',
    compactDescription: 'Manage roadmap objectives and milestones',
    microEligible: false,
    tier: 'core',
    actions: {
      init: 'roadmap_init',
      list: 'roadmap_list',
      read: 'roadmap_read',
      list_objectives: 'roadmap_listObjectives',
      read_objective: 'roadmap_read_objective',
      link_epic: 'roadmap_linkEpic',
      get_epic_context: 'roadmap_getEpicContext',
      get_health: 'roadmap_getHealth',
    },
  },

  {
    name: 'vector',
    description: 'Agent run tracking, drift detection, and prompt scoring. Use at the start and end of multi-step agent tasks. create_run when beginning work, log_event for key steps, complete_run when done. checkpoint to save progress mid-run; assumptions to record what you are assuming so drift can be detected. Actions: create_run, read_run, list_runs, log_event, complete_run, checkpoint, context_pack, assumptions, score_prompt, trace',
    compactDescription: 'Track agent runs, events, and drift',
    microEligible: false,
    tier: 'core',
    actions: {
      create_run: 'vector_create_run',
      read_run: 'vector_read_run',
      list_runs: 'vector_list_runs',
      log_event: 'vector_log_event',
      complete_run: 'vector_complete_run',
      checkpoint: 'vector_agent_checkpoint',
      context_pack: 'vector_agent_context_pack',
      assumptions: 'vector_agent_assumptions',
      score_prompt: 'vector_score_prompt',
      trace: 'vector_trace',
    },
  },

  {
    name: 'context',
    description: 'Persistent memory: pinned facts, events, artifacts. pin to save key facts that should persist across sessions (e.g. "uses Postgres 16", "deploy target is Vercel"). event_append for timestamped logs. refresh at session start to load pinned context. Actions: list, pin, unpin, refresh, event_append, event_search, artifact_list, artifact_read',
    compactDescription: 'Pin facts, log events, manage artifacts',
    microEligible: true,
    tier: 'core',
    actions: {
      list: 'decibel_context_list',
      pin: 'decibel_context_pin',
      unpin: 'decibel_context_unpin',
      refresh: 'decibel_context_refresh',
      event_append: 'decibel_event_append',
      event_search: 'decibel_event_search',
      artifact_list: 'decibel_artifact_list',
      artifact_read: 'decibel_artifact_read',
    },
  },

  {
    name: 'auditor',
    description: 'Code quality, health metrics, and refactor scoring. Use after refactors or before releases. triage to identify the worst code smells; refactor_score to measure improvement from a change; log_health to record a snapshot; health_dashboard for trends over time. Actions: init, triage, refactor_score, naming_audit, log_health, health_dashboard, health_history',
    compactDescription: 'Code quality audits and health metrics',
    microEligible: false,
    tier: 'core',
    actions: {
      init: 'auditor_init',
      triage: 'auditor_triage',
      refactor_score: 'auditor_refactor_score',
      naming_audit: 'auditor_naming_audit',
      log_health: 'auditor_log_health',
      health_dashboard: 'auditor_health_dashboard',
      health_history: 'auditor_health_history',
    },
  },

  {
    name: 'forecast',
    description: 'Task estimation, decomposition, and capacity planning. parse a task description into estimated effort; decompose to break large tasks into sub-tasks with estimates; record actual time after completion to improve future calibration. Actions: parse, decompose, plan, record, calibration',
    compactDescription: 'Estimate tasks and plan capacity',
    microEligible: false,
    tier: 'core',
    actions: {
      parse: 'forecast_parse',
      decompose: 'forecast_decompose',
      plan: 'forecast_plan',
      record: 'forecast_record',
      calibration: 'forecast_calibration',
    },
  },

  {
    name: 'velocity',
    description: 'Productivity metrics, trends, and contributor stats. snapshot to capture current commit velocity; trends for week-over-week changes; contributor for per-author stats. install_hook to auto-track commits via git hook. Actions: snapshot, list, trends, contributor, install_hook, uninstall_hook',
    compactDescription: 'Track productivity and commit velocity',
    microEligible: false,
    tier: 'core',
    actions: {
      snapshot: 'velocity_snapshot',
      list: 'velocity_list',
      trends: 'velocity_trends',
      contributor: 'velocity_contributor',
      install_hook: 'velocity_install_hook',
      uninstall_hook: 'velocity_uninstall_hook',
    },
  },

  {
    name: 'coordinator',
    description: 'Multi-agent coordination: locking, heartbeat, logging, messaging. Use when multiple agents work on the same project. register at agent start; lock before modifying shared resources (unlock when done); send/inbox for inter-agent messages; heartbeat to signal liveness. Actions: register, lock, unlock, status, heartbeat, log, send, inbox, ack',
    compactDescription: 'Agent coordination, locking, and messaging',
    microEligible: true,
    tier: 'core',
    actions: {
      register: 'coord_register',
      lock: 'coord_lock',
      unlock: 'coord_unlock',
      status: 'coord_status',
      heartbeat: 'coord_heartbeat',
      log: 'coord_log',
      send: 'coord_send',
      inbox: 'coord_inbox',
      ack: 'coord_ack',
    },
  },

  {
    name: 'friction',
    description: 'Track recurring pain points and workarounds. log when you notice something annoying or broken that keeps coming up; bump to increase severity of an existing friction; resolve when the root cause is fixed. Check list before logging to avoid duplicates. Actions: log, list, bump, resolve',
    compactDescription: 'Log and track recurring pain points',
    microEligible: false,
    tier: 'core',
    actions: {
      log: 'friction_log',
      list: 'friction_list',
      bump: 'friction_bump',
      resolve: 'friction_resolve',
    },
  },

  {
    name: 'registry',
    description: 'Project discovery and management. init to bootstrap .decibel/ in a new project; add to register an existing project; resolve to look up a project by ID or alias. If tools fail with "project not found", use list to see registered projects, then init or add to fix. Actions: add, remove, list, alias, resolve, init, snapshot, status',
    compactDescription: 'Manage project registry and discovery',
    microEligible: false,
    tier: 'core',
    actions: {
      add: 'registry_add',
      remove: 'registry_remove',
      list: 'registry_list',
      alias: 'registry_alias',
      resolve: 'registry_resolve',
      init: 'project_init',
      snapshot: 'project_snapshot',
      status: 'project_status',
    },
  },


  {
    name: 'feedback',
    description: 'Submit and view tool feedback. submit when a tool behaves unexpectedly or could be improved. Include the tool name and what went wrong. Actions: submit, list',
    compactDescription: 'Tool feedback',
    microEligible: false,
    tier: 'core',
    actions: {
      submit: 'feedback_submit',
      list: 'feedback_list',
    },
  },

  {
    name: 'learnings',
    description: 'Technical knowledge and lessons learned. append after discovering something non-obvious (gotchas, patterns, constraints) that future sessions should know. list at session start to recall prior learnings. Actions: append, list',
    compactDescription: 'Record and recall learnings',
    microEligible: false,
    tier: 'core',
    actions: {
      append: 'learnings_append',
      list: 'learnings_list',
    },
  },

  {
    name: 'provenance',
    description: 'Audit trail for tool operations. list to see what tools were called, when, and by whom. Use for debugging unexpected state or verifying what happened in a previous session. Actions: list',
    compactDescription: 'View audit trail',
    microEligible: false,
    tier: 'core',
    actions: {
      list: 'provenance_list',
    },
  },

  {
    name: 'bench',
    description: 'Benchmark suites and comparison. run to execute a benchmark suite; compare to diff two runs and identify regressions or improvements. Actions: run, compare',
    compactDescription: 'Run and compare benchmarks',
    microEligible: false,
    tier: 'core',
    actions: {
      run: 'decibel_bench',
      compare: 'decibel_bench_compare',
    },
  },

  {
    name: 'guardian',
    description: 'Security scanning: dependency audits, secret detection, HTTP surface checks, response header analysis, config review. Use report for a full security grade; use individual scans to drill into specific areas. scan_headers takes a URL and checks for missing CSP/HSTS/etc. Run after deploying or changing infrastructure. Actions: scan_deps, scan_secrets, scan_http, scan_headers, scan_config, report',
    compactDescription: 'Security scanning and vulnerability detection',
    microEligible: false,
    tier: 'core',
    actions: {
      scan_deps: 'guardian_scan_deps',
      scan_secrets: 'guardian_scan_secrets',
      scan_http: 'guardian_scan_http',
      scan_headers: 'guardian_scan_headers',
      scan_config: 'guardian_scan_config',
      report: 'guardian_report',
    },
  },

];

// ============================================================================
// Pro Facades (gated by DECIBEL_PRO)
// ============================================================================

export const proFacades: FacadeSpec[] = [
  {
    name: 'voice',
    description: 'Voice inbox and command processing. inbox_sync at session start to pull queued voice messages from Supabase. inbox_process to act on a specific message. command to execute a spoken instruction directly. Actions: inbox_add, inbox_list, inbox_process, inbox_sync, command',
    compactDescription: 'Voice inbox and commands',
    microEligible: false,
    tier: 'pro',
    actions: {
      inbox_add: 'voice_inbox_add',
      inbox_list: 'voice_inbox_list',
      inbox_process: 'voice_inbox_process',
      inbox_sync: 'voice_inbox_sync',
      command: 'voice_command',
    },
  },

  {
    name: 'studio',
    description: 'Creative asset generation: images, video, 3D. generate_image returns a job ID — poll get_image_status until complete. Artifacts are the persistent asset records; projects group related artifacts. Device endpoints are for GPU render workers. Actions: generate_image, get_image_status, create_artifact, update_artifact, list_artifacts, create_project, read_project, list_projects, list_tasks, list_jobs, claim_job, update_job, register_device, heartbeat, sync_events',
    compactDescription: 'Generate images, video, and 3D assets',
    microEligible: false,
    tier: 'pro',
    actions: {
      generate_image: 'studio_generate_image',
      get_image_status: 'studio_get_image_status',
      create_artifact: 'studio_create_artifact',
      update_artifact: 'studio_update_artifact',
      list_artifacts: 'studio_list_artifacts',
      create_project: 'studio_create_project',
      read_project: 'studio_read_project',
      list_projects: 'studio_list_projects',
      list_tasks: 'studio_list_tasks',
      list_jobs: 'studio_list_jobs',
      claim_job: 'studio_claim_job',
      update_job: 'studio_update_job',
      register_device: 'studio_register_device',
      heartbeat: 'studio_heartbeat',
      sync_events: 'studio_sync_events',
    },
  },

  {
    name: 'corpus',
    description: 'Shared knowledge base: patterns, playbooks, and field notes. search to find existing solutions before implementing; add_pattern for reusable solutions (id must be PREFIX-NNNN); add_field_note for lessons learned; add_playbook for step-by-step guides. status to check corpus availability. All writes are no-overwrite — they fail if the file already exists. Actions: search, status, add_pattern, add_field_note, add_playbook',
    compactDescription: 'Search and contribute to shared knowledge base',
    microEligible: false,
    tier: 'pro',
    actions: {
      search: 'corpus_search',
      status: 'corpus_status',
      add_pattern: 'corpus_add_pattern',
      add_field_note: 'corpus_add_field_note',
      add_playbook: 'corpus_add_playbook',
    },
  },

  {
    name: 'agentic',
    description: 'Agentic operations: render, lint, compile, evaluation. render to produce human-readable output from structured data; lint for code quality checks; compile_pack to bundle context for another agent; golden_eval to test agent output against known-good examples. Actions: render, lint, compile_pack, golden_eval',
    compactDescription: 'Render, lint, compile, evaluate',
    microEligible: false,
    tier: 'pro',
    actions: {
      render: 'agentic_render',
      lint: 'agentic_lint',
      compile_pack: 'agentic_compile_pack',
      golden_eval: 'agentic_golden_eval',
    },
  },
];

// ============================================================================
// App Facades (Decibel internal — gated by DECIBEL_APPS)
// ============================================================================

export const appFacades: FacadeSpec[] = [
  {
    name: 'senken',
    description: 'Trade analysis: strategy summaries, giveback reports, grading. Reads from Postgres (requires SENKEN_DATABASE_URL). trade_summary for aggregate stats by strategy; trade_review for individual trade grades (A-F by MFE capture); giveback_report for unrealized profit analysis. apply_override is a WRITE — it modifies live strategy parameters. Actions: trade_summary, giveback_report, trade_review, list_overrides, apply_override',
    compactDescription: 'Trading strategy analysis (Postgres)',
    microEligible: false,
    tier: 'apps',
    actions: {
      trade_summary: 'senken_trade_summary',
      giveback_report: 'senken_giveback_report',
      trade_review: 'senken_trade_review',
      list_overrides: 'senken_list_overrides',
      apply_override: 'senken_apply_override',
    },
  },

  {
    name: 'deck',
    description: 'Trading card buylist search and price comparison. search by card name to find best buylist prices across stores; list to see all available buylists; stores for store details and shipping info. Actions: list, search, stores',
    compactDescription: 'Card buylist search',
    microEligible: false,
    tier: 'apps',
    actions: {
      list: 'deck_buylist_list',
      search: 'deck_buylist_search',
      stores: 'deck_buylist_stores',
    },
  },

  {
    name: 'terminal',
    description: 'DX Terminal Pro vault management: market data, portfolio, competitor intelligence, strategy writing. Read actions use REST (no auth); write actions use cast (requires wallet). get_strategies works on ANY vault (public on-chain) — use to scout competitors. Always get_strategies before add_strategy to check slot count (max 8). disable_strategy expired ones before adding new. Writes are on-chain transactions on Base L2. Actions: get_tokens, get_portfolio, get_strategies, get_leaderboard, get_swaps, get_inference_logs, get_holders, get_candles, get_pnl_history, get_vault_settings, get_deposits_withdrawals, add_strategy, disable_strategy, update_settings, deposit_eth, withdraw_eth',
    compactDescription: 'DX Terminal Pro vault + strategies',
    microEligible: false,
    tier: 'apps',
    actions: {
      get_tokens: 'terminal_get_tokens',
      get_portfolio: 'terminal_get_portfolio',
      get_strategies: 'terminal_get_strategies',
      get_leaderboard: 'terminal_get_leaderboard',
      get_swaps: 'terminal_get_swaps',
      get_inference_logs: 'terminal_get_inference_logs',
      get_holders: 'terminal_get_holders',
      get_candles: 'terminal_get_candles',
      get_pnl_history: 'terminal_get_pnl_history',
      get_vault_settings: 'terminal_get_vault_settings',
      get_deposits_withdrawals: 'terminal_get_deposits_withdrawals',
      add_strategy: 'terminal_add_strategy',
      disable_strategy: 'terminal_disable_strategy',
      update_settings: 'terminal_update_settings',
      deposit_eth: 'terminal_deposit_eth',
      withdraw_eth: 'terminal_withdraw_eth',
    },
  },
];

// ============================================================================
// All Facades
// ============================================================================

export const allFacadeDefinitions: FacadeSpec[] = [...coreFacades, ...proFacades, ...appFacades];
