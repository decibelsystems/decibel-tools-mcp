// ============================================================================
// Oracle Domain Tools
// ============================================================================
// Tools for getting insights, recommendations, and roadmap progress.
// ============================================================================

import { ToolSpec } from '../types.js';
import { toolSuccess, toolError } from '../shared/index.js';
import {
  nextActions,
  NextActionsInput,
  roadmapProgress,
  RoadmapInput,
  RoadmapOutput,
  MilestoneProgress,
  isOracleError,
} from '../oracle.js';
import { listProjects, type ProjectEntry } from '../../projectRegistry.js';

// ============================================================================
// Helper: Normalize project_id → projectId
// ============================================================================

function normalizeProjectId(args: Record<string, unknown>): void {
  if (!args.projectId && args.project_id) {
    args.projectId = args.project_id;
  }
}

// ============================================================================
// Next Actions Tool
// ============================================================================

export const oracleNextActionsTool: ToolSpec = {
  definition: {
    name: 'oracle_next_actions',
    description: 'Get recommended next actions for a project based on recent design decisions, architecture changes, and issues.',
    annotations: {
      title: 'Next Actions',
      readOnlyHint: true,
      destructiveHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'The project identifier to analyze',
        },
        focus: {
          type: 'string',
          description: 'Optional focus area to filter actions (e.g., "architect", "sentinel", or a keyword)',
        },
      },
      required: ['project_id'],
    },
  },
  handler: async (args) => {
    try {
      const rawInput = args as Record<string, unknown>;
      normalizeProjectId(rawInput);
      const input = rawInput as unknown as NextActionsInput;
      const result = await nextActions(input);
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// Roadmap Progress Tool
// ============================================================================

export const oracleRoadmapTool: ToolSpec = {
  definition: {
    name: 'oracle_roadmap',
    description: 'Evaluate roadmap progress against milestones and objectives. Reads roadmap from .decibel/architect/roadmap/roadmap.yaml, cross-references epic statuses from Sentinel, and optionally saves progress to .decibel/oracle/progress.yaml.',
    annotations: {
      title: 'Roadmap Progress',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project identifier (optional, auto-detects from cwd)',
        },
        dryRun: {
          type: 'boolean',
          description: 'If true, evaluate without saving progress.yaml',
        },
        noSignals: {
          type: 'boolean',
          description: 'Skip Sentinel signals integration',
        },
      },
    },
  },
  handler: async (args) => {
    try {
      const input = args as RoadmapInput;
      const result = await roadmapProgress(input);
      if (isOracleError(result)) {
        return toolError(JSON.stringify(result, null, 2));
      }
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// Portfolio Summary Tool
// ============================================================================

function formatMilestoneStatus(status: MilestoneProgress['status']): string {
  const labels: Record<string, string> = {
    on_track: 'ON TRACK',
    at_risk: 'AT RISK',
    behind: 'BEHIND',
    completed: 'COMPLETED',
  };
  return labels[status] ?? status.toUpperCase();
}

function formatProjectSummary(
  project: ProjectEntry,
  roadmap: RoadmapOutput,
  actions?: string[],
): string {
  const lines: string[] = [];
  const name = project.name ?? project.id;
  lines.push(`### ${project.id} (${name})`);

  // Epic counts by status
  const shipped = roadmap.epics.filter(e => e.status === 'completed').length;
  const inProgress = roadmap.epics.filter(e => e.status === 'in_progress').length;
  const planned = roadmap.epics.filter(e => e.status === 'not_started').length;
  lines.push(
    `Milestones: ${roadmap.milestones.length} | Epics: ${roadmap.epics.length} (${shipped} shipped, ${inProgress} in progress, ${planned} planned)`,
  );

  // Milestone details
  for (const ms of roadmap.milestones) {
    const due = ms.target_date ? ` (due ${ms.target_date})` : '';
    lines.push(`- ${ms.id} "${ms.label}" — ${ms.progress_percent}%, ${formatMilestoneStatus(ms.status)}${due}`);
  }

  // Signals
  if (roadmap.signals) {
    const { blocking_issues, high_severity_issues, friction_points } = roadmap.signals;
    const parts: string[] = [];
    if (blocking_issues > 0) parts.push(`${blocking_issues} blocking issue${blocking_issues > 1 ? 's' : ''}`);
    if (high_severity_issues > 0) parts.push(`${high_severity_issues} high-severity`);
    if (friction_points > 0) parts.push(`${friction_points} friction point${friction_points > 1 ? 's' : ''}`);
    if (parts.length > 0) {
      lines.push(`Signals: ${parts.join(', ')}`);
    }
  }

  // Next actions (condensed)
  if (actions && actions.length > 0) {
    lines.push(`Next: ${actions.join('; ')}`);
  }

  return lines.join('\n');
}

export const oraclePortfolioSummaryTool: ToolSpec = {
  definition: {
    name: 'oracle_portfolio_summary',
    description:
      'Compile a cross-project portfolio digest showing roadmap health, milestone status, and next actions for all registered projects. Output is compact markdown designed for system prompt injection.',
    annotations: {
      title: 'Portfolio Summary',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        include_actions: {
          type: 'boolean',
          description: 'Include recommended next actions per project (default: true)',
        },
      },
    },
  },
  handler: async (args) => {
    try {
      const includeActions = (args as { include_actions?: boolean }).include_actions !== false;
      const projects = listProjects();

      if (projects.length === 0) {
        return toolSuccess({ summary: 'No projects registered.' });
      }

      const today = new Date().toISOString().slice(0, 10);
      const sections: string[] = [`## Portfolio Summary (${today})`];

      for (const project of projects) {
        // Get roadmap progress (dry run, include signals)
        const roadmapResult = await roadmapProgress({
          projectId: project.id,
          dryRun: true,
          noSignals: false,
        });

        // Skip projects with no roadmap
        if (isOracleError(roadmapResult)) {
          sections.push(`### ${project.id} (${project.name ?? project.id})\nNo roadmap configured`);
          continue;
        }

        // Optionally get next actions
        let actionDescriptions: string[] | undefined;
        if (includeActions) {
          const actionsResult = await nextActions({ projectId: project.id });
          if (!isOracleError(actionsResult) && actionsResult.actions.length > 0) {
            actionDescriptions = actionsResult.actions
              .slice(0, 3)
              .map(a => a.description);
          }
        }

        sections.push(formatProjectSummary(project, roadmapResult, actionDescriptions));
      }

      const summary = sections.join('\n\n');
      return toolSuccess({ summary });
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// Export All Tools
// ============================================================================

export const oracleTools: ToolSpec[] = [
  oracleNextActionsTool,
  oracleRoadmapTool,
  oraclePortfolioSummaryTool,
];
