/**
 * Roadmap tools for Decibel Architect.
 *
 * Provides strategic roadmap management - objectives, themes, milestones, and epic context.
 * Reads from .decibel/architect/roadmap/roadmap.yaml
 */

import fs from 'fs';
import path from 'path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { log } from '../config.js';
import { getWritePath, getReadPath } from '../decibelPaths.js';

// =============================================================================
// Types
// =============================================================================

export interface KeyResult {
  metric: string;
  target: string;
  current?: string;
}

export interface Objective {
  id: string;
  title: string;
  timeframe: string;
  owner?: string;
  key_results?: KeyResult[];
}

export interface Theme {
  id: string;
  label: string;
  description?: string;
}

export interface Milestone {
  id: string;
  label: string;
  target_date: string;
  epics?: string[];
}

export interface EpicContext {
  epic_id: string;
  theme?: string;
  objectives?: string[];
  milestone?: string;
  work_type: 'feature' | 'infra' | 'refactor' | 'experiment' | 'policy';
  adrs?: string[];
}

export interface OracleAnnotation {
  epic_id: string;
  health_score: number;
  risk_flags: string[];
  confidence: 'low' | 'medium' | 'high';
  commentary?: string;
  last_reviewed?: string;
}

export interface Roadmap {
  objectives: Objective[];
  themes: Theme[];
  milestones: Milestone[];
  epic_context: Record<string, EpicContext>;
}

export interface OracleAnnotations {
  annotations: Record<string, OracleAnnotation>;
}

// =============================================================================
// File Paths
// =============================================================================

const ROADMAP_SUBPATH = 'architect/roadmap';
const ROADMAP_FILE = 'roadmap.yaml';
const ORACLE_ANNOTATIONS_FILE = 'oracle-annotations.yaml';

function getRoadmapPath(roadmapDir: string): string {
  return path.join(roadmapDir, ROADMAP_FILE);
}

function getOracleAnnotationsPath(roadmapDir: string): string {
  return path.join(roadmapDir, ORACLE_ANNOTATIONS_FILE);
}

// =============================================================================
// Loading Functions
// =============================================================================

function loadRoadmap(roadmapDir: string): Roadmap {
  const roadmapPath = getRoadmapPath(roadmapDir);

  if (!fs.existsSync(roadmapPath)) {
    return {
      objectives: [],
      themes: [],
      milestones: [],
      epic_context: {},
    };
  }

  const content = fs.readFileSync(roadmapPath, 'utf-8');
  const data = parseYaml(content) as Record<string, unknown> || {};

  return {
    objectives: (data.objectives as Objective[]) || [],
    themes: (data.themes as Theme[]) || [],
    milestones: (data.milestones as Milestone[]) || [],
    epic_context: (data.epic_context as Record<string, EpicContext>) || {},
  };
}

function loadOracleAnnotations(roadmapDir: string): OracleAnnotations {
  const annotationsPath = getOracleAnnotationsPath(roadmapDir);

  if (!fs.existsSync(annotationsPath)) {
    return { annotations: {} };
  }

  const content = fs.readFileSync(annotationsPath, 'utf-8');
  const data = parseYaml(content) as Record<string, unknown> || {};

  return {
    annotations: (data.annotations as Record<string, OracleAnnotation>) || {},
  };
}

function saveRoadmap(roadmapDir: string, roadmap: Roadmap): void {
  if (!fs.existsSync(roadmapDir)) {
    fs.mkdirSync(roadmapDir, { recursive: true });
  }

  const roadmapPath = getRoadmapPath(roadmapDir);
  const content = stringifyYaml(roadmap);
  fs.writeFileSync(roadmapPath, content, 'utf-8');
}

export function roadmapExists(roadmapDir: string): boolean {
  return fs.existsSync(getRoadmapPath(roadmapDir));
}

// =============================================================================
// Input/Output Types
// =============================================================================

export interface GetRoadmapInput {
  projectId: string;
}

export interface GetEpicContextInput {
  projectId: string;
  epicId: string;
}

export interface GetRoadmapHealthInput {
  projectId: string;
  threshold?: number;
}

export interface LinkEpicInput {
  projectId: string;
  epicId: string;
  theme?: string;
  milestone?: string;
  objectives?: string[];
  workType?: 'feature' | 'infra' | 'refactor' | 'experiment' | 'policy';
  adrs?: string[];
}

export interface RoadmapListInput {
  projectId: string;
}

export interface RoadmapInitInput {
  projectId: string;
}

// =============================================================================
// Tool Implementations
// =============================================================================

export async function getRoadmap(input: GetRoadmapInput): Promise<Record<string, unknown>> {
  const roadmapDir = await getReadPath(input.projectId, ROADMAP_SUBPATH);

  if (!roadmapExists(roadmapDir)) {
    return {
      error: 'Roadmap not initialized',
      suggestion: "Run 'decibel-architect roadmap init' or use roadmap_init tool to create roadmap.yaml",
    };
  }

  const roadmap = loadRoadmap(roadmapDir);
  const annotations = loadOracleAnnotations(roadmapDir);

  // Calculate summary stats
  const workTypeCounts: Record<string, number> = {};
  for (const ec of Object.values(roadmap.epic_context)) {
    workTypeCounts[ec.work_type] = (workTypeCounts[ec.work_type] || 0) + 1;
  }

  const unhealthyCount = Object.values(annotations.annotations)
    .filter((a) => a.health_score < 0.7).length;

  return {
    objectives: roadmap.objectives,
    themes: roadmap.themes,
    milestones: roadmap.milestones,
    epic_context: roadmap.epic_context,
    summary: {
      objectives_count: roadmap.objectives.length,
      themes_count: roadmap.themes.length,
      milestones_count: roadmap.milestones.length,
      epics_count: Object.keys(roadmap.epic_context).length,
      work_type_distribution: workTypeCounts,
      unhealthy_epics_count: unhealthyCount,
      has_oracle_annotations: Object.keys(annotations.annotations).length > 0,
    },
  };
}

export async function getEpicContext(input: GetEpicContextInput): Promise<Record<string, unknown>> {
  const roadmapDir = await getReadPath(input.projectId, ROADMAP_SUBPATH);

  if (!roadmapExists(roadmapDir)) {
    return {
      error: 'Roadmap not initialized',
      suggestion: "Run 'decibel-architect roadmap init' or use roadmap_init tool to create roadmap.yaml",
    };
  }

  const roadmap = loadRoadmap(roadmapDir);
  const annotations = loadOracleAnnotations(roadmapDir);

  const ec = roadmap.epic_context[input.epicId];
  if (!ec) {
    return {
      found: false,
      epic_id: input.epicId,
      message: `Epic '${input.epicId}' not found in roadmap`,
    };
  }

  // Resolve references
  const theme = ec.theme ? roadmap.themes.find((t) => t.id === ec.theme) : null;
  const milestone = ec.milestone ? roadmap.milestones.find((m) => m.id === ec.milestone) : null;
  const objectives = (ec.objectives || [])
    .map((objId) => roadmap.objectives.find((o) => o.id === objId))
    .filter(Boolean);
  const annotation = annotations.annotations[input.epicId];

  return {
    found: true,
    epic_id: input.epicId,
    theme: theme || null,
    milestone: milestone || null,
    objectives,
    work_type: ec.work_type,
    adrs: ec.adrs || [],
    oracle_annotation: annotation || null,
  };
}

export async function getRoadmapHealth(input: GetRoadmapHealthInput): Promise<Record<string, unknown>> {
  const roadmapDir = await getReadPath(input.projectId, ROADMAP_SUBPATH);
  const threshold = input.threshold ?? 0.7;

  if (!roadmapExists(roadmapDir)) {
    return {
      error: 'Roadmap not initialized',
      suggestion: "Run 'decibel-architect roadmap init' or use roadmap_init tool to create roadmap.yaml",
    };
  }

  const roadmap = loadRoadmap(roadmapDir);
  const annotations = loadOracleAnnotations(roadmapDir);

  if (Object.keys(annotations.annotations).length === 0) {
    return {
      threshold,
      unhealthy_count: 0,
      total_annotated: 0,
      epics: [],
      message: 'No Oracle annotations found. Run decibel-oracle roadmap-review.',
    };
  }

  // Find unhealthy epics
  const unhealthy = Object.values(annotations.annotations)
    .filter((a) => a.health_score < threshold)
    .sort((a, b) => a.health_score - b.health_score);

  const epics = unhealthy.map((ann) => {
    const ec = roadmap.epic_context[ann.epic_id];
    const theme = ec?.theme ? roadmap.themes.find((t) => t.id === ec.theme) : null;
    const milestone = ec?.milestone ? roadmap.milestones.find((m) => m.id === ec.milestone) : null;

    return {
      epic_id: ann.epic_id,
      health_score: ann.health_score,
      risk_flags: ann.risk_flags,
      confidence: ann.confidence,
      commentary: ann.commentary,
      theme: theme?.label || null,
      milestone: milestone?.label || null,
    };
  });

  return {
    threshold,
    unhealthy_count: epics.length,
    total_annotated: Object.keys(annotations.annotations).length,
    epics,
  };
}

export async function linkEpicToRoadmap(input: LinkEpicInput): Promise<Record<string, unknown>> {
  const readDir = await getReadPath(input.projectId, ROADMAP_SUBPATH);
  const writeDir = await getWritePath(input.projectId, ROADMAP_SUBPATH);

  if (!roadmapExists(readDir)) {
    return {
      error: 'Roadmap not initialized',
      suggestion: "Run 'decibel-architect roadmap init' or use roadmap_init tool to create roadmap.yaml",
    };
  }

  const roadmap = loadRoadmap(readDir);

  // Validate theme
  if (input.theme && !roadmap.themes.find((t) => t.id === input.theme)) {
    return {
      status: 'error',
      message: `Theme '${input.theme}' not found in roadmap`,
    };
  }

  // Validate objectives
  if (input.objectives) {
    for (const objId of input.objectives) {
      if (!roadmap.objectives.find((o) => o.id === objId)) {
        return {
          status: 'error',
          message: `Objective '${objId}' not found in roadmap`,
        };
      }
    }
  }

  // Validate and update milestone
  if (input.milestone) {
    const ms = roadmap.milestones.find((m) => m.id === input.milestone);
    if (!ms) {
      return {
        status: 'error',
        message: `Milestone '${input.milestone}' not found in roadmap`,
      };
    }
    // Add epic to milestone's epic list if not already there
    if (!ms.epics) {
      ms.epics = [];
    }
    if (!ms.epics.includes(input.epicId)) {
      ms.epics.push(input.epicId);
    }
  }

  // Create epic context
  const epicContext: EpicContext = {
    epic_id: input.epicId,
    theme: input.theme,
    objectives: input.objectives || [],
    milestone: input.milestone,
    work_type: input.workType || 'feature',
    adrs: input.adrs || [],
  };

  roadmap.epic_context[input.epicId] = epicContext;
  saveRoadmap(writeDir, roadmap);

  log(`Roadmap: Linked epic ${input.epicId} to roadmap`);

  return {
    status: 'linked',
    epic_id: input.epicId,
    epic_context: epicContext,
    message: `Epic '${input.epicId}' linked to roadmap`,
  };
}

export async function roadmapList(input: RoadmapListInput): Promise<Record<string, unknown>> {
  const roadmapDir = await getReadPath(input.projectId, ROADMAP_SUBPATH);

  if (!roadmapExists(roadmapDir)) {
    return {
      error: 'Roadmap not initialized',
      suggestion: "Run 'decibel-architect roadmap init' or use roadmap_init tool to create roadmap.yaml",
    };
  }

  const roadmap = loadRoadmap(roadmapDir);
  const annotations = loadOracleAnnotations(roadmapDir);

  // Build epic list with context and health
  const epics = Object.values(roadmap.epic_context).map((ec) => {
    const theme = ec.theme ? roadmap.themes.find((t) => t.id === ec.theme) : null;
    const milestone = ec.milestone ? roadmap.milestones.find((m) => m.id === ec.milestone) : null;
    const annotation = annotations.annotations[ec.epic_id];

    return {
      epic_id: ec.epic_id,
      theme: theme ? { id: theme.id, label: theme.label } : null,
      milestone: milestone
        ? { id: milestone.id, label: milestone.label, target_date: milestone.target_date }
        : null,
      work_type: ec.work_type,
      objectives: ec.objectives,
      adrs: ec.adrs,
      health: annotation
        ? {
            score: annotation.health_score,
            risk_flags: annotation.risk_flags,
            confidence: annotation.confidence,
          }
        : null,
    };
  });

  // Sort by milestone target date, then by epic_id
  epics.sort((a, b) => {
    const aDate = a.milestone?.target_date || '9999-99-99';
    const bDate = b.milestone?.target_date || '9999-99-99';
    if (aDate !== bDate) return aDate.localeCompare(bDate);
    return a.epic_id.localeCompare(b.epic_id);
  });

  // Calculate summary
  const workTypeCounts: Record<string, number> = {};
  for (const ec of Object.values(roadmap.epic_context)) {
    workTypeCounts[ec.work_type] = (workTypeCounts[ec.work_type] || 0) + 1;
  }

  return {
    epics,
    summary: {
      objectives_count: roadmap.objectives.length,
      themes_count: roadmap.themes.length,
      milestones_count: roadmap.milestones.length,
      epics_count: Object.keys(roadmap.epic_context).length,
      work_type_distribution: workTypeCounts,
    },
  };
}

export async function roadmapInit(input: RoadmapInitInput): Promise<Record<string, unknown>> {
  const readDir = await getReadPath(input.projectId, ROADMAP_SUBPATH);
  const writeDir = await getWritePath(input.projectId, ROADMAP_SUBPATH);

  if (roadmapExists(readDir)) {
    return {
      status: 'already_exists',
      message: 'Roadmap already exists',
      path: getRoadmapPath(readDir),
    };
  }

  // Create scaffold roadmap
  const roadmap: Roadmap = {
    objectives: [
      {
        id: 'OBJ-0001',
        title: 'Example Objective',
        timeframe: '2026-Q1',
        owner: 'team',
        key_results: [
          {
            metric: 'example_metric',
            target: '>90%',
            current: '~70%',
          },
        ],
      },
    ],
    themes: [
      {
        id: 'foundations',
        label: 'Foundations',
        description: 'Core infrastructure and tooling',
      },
      {
        id: 'features',
        label: 'Features',
        description: 'User-facing functionality',
      },
    ],
    milestones: [
      {
        id: 'M-0001',
        label: 'v1.0 - Initial Release',
        target_date: '2026-03-01',
        epics: [],
      },
    ],
    epic_context: {},
  };

  saveRoadmap(writeDir, roadmap);

  log(`Roadmap: Initialized roadmap for ${input.projectId}`);

  return {
    status: 'initialized',
    path: getRoadmapPath(writeDir),
    objectives: roadmap.objectives.length,
    themes: roadmap.themes.length,
    milestones: roadmap.milestones.length,
  };
}
