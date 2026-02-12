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
    description: 'Work tracking: epics, issues, test specs, code scanning. Actions: create_issue, read_issue, update_issue, close_issue, list_issues, log_epic, list_epics, read_epic, resolve_epic, list_epic_issues, create_test_spec, list_test_specs, compile_tests, audit_policies, scan, scan_data, scan_codebase, scan_config, scan_coverage, auto_link, link_commit, list_linked_commits',
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
    description: 'Architecture decisions & policies. Actions: create_adr, read_adr, list_adrs, create_policy, read_policy, list_policies, compile_oversight, record_arch_decision',
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
    description: 'Feature incubation: wishes, proposals, experiments, benchmarks. Actions: add_wish, list_wishes, create_proposal, scaffold_experiment, run_experiment, read_artifact, read_results, can_graduate, list, projects, bench',
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
    description: 'Design decisions, critiques, tokens, lateral thinking. Actions: record_decision, list_principles, upsert_principle, crit, review_figma, sync_tokens, lateral_session, lateral_apply, lateral_close, list_crits',
    compactDescription: 'Design decisions, crits, and design tokens',
    microEligible: false,
    tier: 'core',
    actions: {
      record_decision: 'designer_record_design_decision',
      list_principles: 'designer_list_principles',
      upsert_principle: 'designer_upsert_principle',
      crit: 'designer_crit',
      review_figma: 'designer_review_figma',
      sync_tokens: 'designer_sync_tokens',
      lateral_session: 'designer_lateral_session',
      lateral_apply: 'designer_lateral_apply',
      lateral_close: 'designer_lateral_close',
      list_crits: 'designer_list_crits',
    },
  },

  {
    name: 'git',
    description: 'Git history, changes, and issue linking. Actions: log_recent, changed_files, find_removal, blame_context, tags, status, find_linked_issues',
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
    description: 'High-level composite operations. Actions: status, preflight, ship, investigate',
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
    description: 'Strategic planning, health scores, and recommendations. Actions: next_actions, portfolio_summary, hygiene_report, roadmap',
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
    description: 'Objectives, milestones, and epic tracking. Actions: init, list, read, list_objectives, read_objective, link_epic, get_epic_context, get_health',
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
    description: 'Agent run tracking, drift detection, and prompt scoring. Actions: create_run, read_run, list_runs, log_event, complete_run, checkpoint, context_pack, assumptions, score_prompt',
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
    },
  },

  {
    name: 'context',
    description: 'Persistent memory: pinned facts, events, artifacts. Actions: list, pin, unpin, refresh, event_append, event_search, artifact_list, artifact_read',
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
    description: 'Code quality, health metrics, and refactor scoring. Actions: init, triage, refactor_score, naming_audit, log_health, health_dashboard, health_history',
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
    description: 'Task estimation, decomposition, and capacity planning. Actions: parse, decompose, plan, record, calibration',
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
    description: 'Productivity metrics, trends, and contributor stats. Actions: snapshot, list, trends, contributor, install_hook, uninstall_hook',
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
    description: 'Multi-agent coordination: locking, heartbeat, logging. Actions: register, lock, unlock, status, heartbeat, log',
    compactDescription: 'Agent coordination and locking',
    microEligible: true,
    tier: 'core',
    actions: {
      register: 'coord_register',
      lock: 'coord_lock',
      unlock: 'coord_unlock',
      status: 'coord_status',
      heartbeat: 'coord_heartbeat',
      log: 'coord_log',
    },
  },

  {
    name: 'friction',
    description: 'Track recurring pain points and workarounds. Actions: log, list, bump, resolve',
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
    description: 'Project discovery and management. Actions: add, remove, list, alias, resolve, init, snapshot, status',
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
    description: 'Submit and view tool feedback. Actions: submit, list',
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
    description: 'Technical knowledge and lessons learned. Actions: append, list',
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
    description: 'Audit trail for tool operations. Actions: list',
    compactDescription: 'View audit trail',
    microEligible: false,
    tier: 'core',
    actions: {
      list: 'provenance_list',
    },
  },

  {
    name: 'bench',
    description: 'Benchmark suites and comparison. Actions: run, compare',
    compactDescription: 'Run and compare benchmarks',
    microEligible: false,
    tier: 'core',
    actions: {
      run: 'decibel_bench',
      compare: 'decibel_bench_compare',
    },
  },

];

// ============================================================================
// Pro Facades (gated by DECIBEL_PRO)
// ============================================================================

export const proFacades: FacadeSpec[] = [
  {
    name: 'voice',
    description: 'Voice inbox and command processing. Actions: inbox_add, inbox_list, inbox_process, inbox_sync, command',
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
    description: 'Creative asset generation: images, video, 3D. Actions: generate_image, get_image_status, create_artifact, update_artifact, list_artifacts, create_project, read_project, list_projects, list_tasks, list_jobs, claim_job, update_job, register_device, heartbeat, sync_events',
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
    description: 'Pattern and playbook search across codebase. Actions: search, status',
    compactDescription: 'Search patterns and playbooks',
    microEligible: false,
    tier: 'pro',
    actions: {
      search: 'corpus_search',
      status: 'corpus_status',
    },
  },

  {
    name: 'agentic',
    description: 'Agentic operations: render, lint, compile, evaluation. Actions: render, lint, compile_pack, golden_eval',
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
    description: 'Trade analysis: strategy summaries, giveback reports, grading. Actions: trade_summary, giveback_report, trade_review, list_overrides, apply_override',
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
    description: 'Trading card buylist search and price comparison. Actions: list, search, stores',
    compactDescription: 'Card buylist search',
    microEligible: false,
    tier: 'apps',
    actions: {
      list: 'deck_buylist_list',
      search: 'deck_buylist_search',
      stores: 'deck_buylist_stores',
    },
  },
];

// ============================================================================
// All Facades
// ============================================================================

export const allFacadeDefinitions: FacadeSpec[] = [...coreFacades, ...proFacades, ...appFacades];
