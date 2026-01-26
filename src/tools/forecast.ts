// ============================================================================
// Forecasting Engine - Capacity Planning Tools
// ============================================================================
// DOJO-PROP-0005: Break down PRDs into tasks, estimate complexity,
// and create capacity plans using velocity data.
// ============================================================================

import fs from 'fs/promises';
import path from 'path';
import YAML from 'yaml';
import { log } from '../config.js';
import { ensureDir } from '../dataRoot.js';
import { resolveProjectPaths, ResolvedProjectPaths } from '../projectRegistry.js';
// TODO: Import velocity tools after branch merge
// import { listSnapshots, VelocitySnapshot } from './velocity.js';

// ============================================================================
// Types
// ============================================================================

export type StoryPoints = 1 | 2 | 3 | 5 | 8 | 13 | 21;
export type Confidence = 'high' | 'medium' | 'low';
export type TaskCategory = 'frontend' | 'backend' | 'api' | 'database' | 'devops' | 'testing' | 'documentation' | 'design' | 'other';

export interface TaskEstimate {
  id: string;
  title: string;
  description: string;
  category: TaskCategory;
  storyPoints: StoryPoints;
  estimatedHours: { min: number; max: number };
  confidence: Confidence;
  dependencies?: string[];  // Other task IDs
  tags?: string[];
}

export interface CapacityPlan {
  id: string;
  title: string;
  createdAt: string;
  tasks: TaskEstimate[];
  totals: {
    storyPoints: number;
    estimatedHours: { min: number; max: number };
    taskCount: number;
  };
  teamVelocity?: {
    pointsPerWeek: number;
    hoursPerPoint: number;
    confidence: Confidence;
  };
  timeline?: {
    estimatedWeeks: { min: number; max: number };
    estimatedEndDate?: { min: string; max: string };
  };
}

export interface CalibrationData {
  lastUpdated: string;
  dataPoints: number;
  hoursPerStoryPoint: number;
  categoryMultipliers: Partial<Record<TaskCategory, number>>;
  confidenceLevel: Confidence;
  optInContribution: boolean;
}

export interface CompletedTask {
  taskId: string;
  category: TaskCategory;
  estimatedPoints: StoryPoints;
  actualHours: number;
  completedAt: string;
  tags?: string[];
}

// ============================================================================
// Baseline Story Point Tables (Industry Standard)
// ============================================================================

const BASELINE_HOURS: Record<StoryPoints, { min: number; max: number; confidence: Confidence }> = {
  1: { min: 1, max: 4, confidence: 'high' },
  2: { min: 3, max: 8, confidence: 'high' },
  3: { min: 6, max: 16, confidence: 'medium' },
  5: { min: 12, max: 32, confidence: 'medium' },
  8: { min: 24, max: 48, confidence: 'low' },
  13: { min: 40, max: 80, confidence: 'low' },
  21: { min: 64, max: 120, confidence: 'low' },
};

const CATEGORY_MULTIPLIERS: Record<TaskCategory, number> = {
  frontend: 1.2,      // Often underestimated
  backend: 1.0,
  api: 1.0,
  database: 1.1,
  devops: 1.4,        // High variance
  testing: 0.9,
  documentation: 0.8,
  design: 1.1,
  other: 1.2,
};

// ============================================================================
// Error Types
// ============================================================================

export interface ForecastError {
  error: string;
  message: string;
  hint?: string;
}

function makeError(error: string, message: string, hint?: string): ForecastError {
  return { error, message, hint };
}

function makeProjectError(operation: string): ForecastError {
  return {
    error: 'project_resolution_failed',
    message: `Cannot ${operation}: No project context available.`,
    hint: 'Specify projectId or run from a directory with .decibel/',
  };
}

// ============================================================================
// Helpers
// ============================================================================

function generateTaskId(): string {
  return `TASK-${Date.now().toString(36).toUpperCase()}`;
}

function generatePlanId(): string {
  return `PLAN-${new Date().toISOString().slice(0, 10)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

async function loadCalibration(resolved: ResolvedProjectPaths): Promise<CalibrationData | null> {
  const calibrationPath = resolved.subPath('oracle', 'calibration.yml');
  try {
    const content = await fs.readFile(calibrationPath, 'utf-8');
    return YAML.parse(content) as CalibrationData;
  } catch {
    return null;
  }
}

async function saveCalibration(resolved: ResolvedProjectPaths, data: CalibrationData): Promise<void> {
  const oracleDir = resolved.subPath('oracle');
  ensureDir(oracleDir);
  const calibrationPath = path.join(oracleDir, 'calibration.yml');
  await fs.writeFile(calibrationPath, YAML.stringify(data), 'utf-8');
}

function estimateHoursForTask(
  points: StoryPoints,
  category: TaskCategory,
  calibration: CalibrationData | null
): { min: number; max: number; confidence: Confidence } {
  const baseline = BASELINE_HOURS[points];

  // Apply category multiplier
  const categoryMult = calibration?.categoryMultipliers[category] ?? CATEGORY_MULTIPLIERS[category];

  // Apply calibration if available
  let hoursPerPoint = 4; // Default: 1 point ≈ 4 hours
  if (calibration && calibration.dataPoints >= 5) {
    hoursPerPoint = calibration.hoursPerStoryPoint;
  }

  // Calculate estimates
  const calibratedMin = Math.round(points * hoursPerPoint * 0.7 * categoryMult);
  const calibratedMax = Math.round(points * hoursPerPoint * 1.5 * categoryMult);

  // Use calibrated if we have enough data, otherwise baseline
  if (calibration && calibration.dataPoints >= 10) {
    return {
      min: calibratedMin,
      max: calibratedMax,
      confidence: calibration.confidenceLevel,
    };
  }

  return {
    min: Math.round(baseline.min * categoryMult),
    max: Math.round(baseline.max * categoryMult),
    confidence: baseline.confidence,
  };
}

// ============================================================================
// forecast_decompose - Break down PRD/feature into tasks
// ============================================================================

export interface DecomposeInput {
  projectId?: string;
  title: string;
  description: string;
  context?: string;  // Additional context about the codebase/team
}

export interface DecomposeOutput {
  planId: string;
  title: string;
  tasks: TaskEstimate[];
  totals: {
    storyPoints: number;
    estimatedHours: { min: number; max: number };
    taskCount: number;
  };
  prompt: string;  // The prompt used (for transparency)
}

/**
 * Generate a structured decomposition prompt for Claude.
 * Returns the prompt - actual LLM call happens at tool layer.
 */
export async function generateDecomposePrompt(
  input: DecomposeInput
): Promise<{ prompt: string; calibration: CalibrationData | null } | ForecastError> {
  let resolved: ResolvedProjectPaths;
  let calibration: CalibrationData | null = null;

  try {
    resolved = resolveProjectPaths(input.projectId);
    calibration = await loadCalibration(resolved);
  } catch {
    // Continue without calibration
  }

  const prompt = `You are a technical project manager breaking down a feature into engineering tasks.

## Feature to Decompose
**Title:** ${input.title}

**Description:**
${input.description}

${input.context ? `**Additional Context:**\n${input.context}\n` : ''}

## Instructions
Break this feature into 5-15 discrete engineering tasks. For each task:

1. **Title**: Clear, actionable task name
2. **Description**: 1-2 sentences explaining the work
3. **Category**: One of: frontend, backend, api, database, devops, testing, documentation, design, other
4. **Story Points**: Fibonacci scale (1, 2, 3, 5, 8, 13, 21)
   - 1: Trivial, <2 hours
   - 2: Simple, 2-4 hours
   - 3: Moderate, 4-8 hours
   - 5: Complex, 1-2 days
   - 8: Very complex, 2-4 days
   - 13: Large, needs breakdown consideration
   - 21: Epic-sized, should probably be split
5. **Dependencies**: Which other tasks must complete first (by title)
6. **Tags**: Relevant keywords

## Output Format
Return ONLY valid YAML array, no markdown fences:

- title: "Task title here"
  description: "What needs to be done"
  category: backend
  storyPoints: 3
  dependencies: []
  tags: [auth, api]

- title: "Another task"
  description: "More work"
  category: frontend
  storyPoints: 5
  dependencies: ["Task title here"]
  tags: [ui, forms]
`;

  return { prompt, calibration };
}

/**
 * Parse the YAML response from Claude into TaskEstimate objects.
 */
export async function parseDecomposeResponse(
  projectId: string | undefined,
  title: string,
  yamlResponse: string
): Promise<DecomposeOutput | ForecastError> {
  let calibration: CalibrationData | null = null;

  try {
    const resolved = resolveProjectPaths(projectId);
    calibration = await loadCalibration(resolved);
  } catch {
    // Continue without calibration
  }

  // Clean up response (remove markdown fences if present)
  let cleanYaml = yamlResponse.trim();
  if (cleanYaml.startsWith('```')) {
    cleanYaml = cleanYaml.replace(/^```(?:yaml|yml)?\n?/, '').replace(/\n?```$/, '');
  }

  let rawTasks: Array<{
    title: string;
    description: string;
    category: string;
    storyPoints: number;
    dependencies?: string[];
    tags?: string[];
  }>;

  try {
    rawTasks = YAML.parse(cleanYaml);
    if (!Array.isArray(rawTasks)) {
      return makeError('parse_error', 'Response is not a valid task array');
    }
  } catch (e) {
    return makeError('parse_error', `Failed to parse YAML: ${e}`);
  }

  const tasks: TaskEstimate[] = [];
  let totalPoints = 0;
  let totalMinHours = 0;
  let totalMaxHours = 0;

  for (const raw of rawTasks) {
    const points = [1, 2, 3, 5, 8, 13, 21].includes(raw.storyPoints)
      ? raw.storyPoints as StoryPoints
      : 3 as StoryPoints;

    const category = Object.keys(CATEGORY_MULTIPLIERS).includes(raw.category)
      ? raw.category as TaskCategory
      : 'other' as TaskCategory;

    const hours = estimateHoursForTask(points, category, calibration);

    const task: TaskEstimate = {
      id: generateTaskId(),
      title: raw.title,
      description: raw.description,
      category,
      storyPoints: points,
      estimatedHours: { min: hours.min, max: hours.max },
      confidence: hours.confidence,
      dependencies: raw.dependencies,
      tags: raw.tags,
    };

    tasks.push(task);
    totalPoints += points;
    totalMinHours += hours.min;
    totalMaxHours += hours.max;
  }

  return {
    planId: generatePlanId(),
    title,
    tasks,
    totals: {
      storyPoints: totalPoints,
      estimatedHours: { min: totalMinHours, max: totalMaxHours },
      taskCount: tasks.length,
    },
    prompt: '(decomposition prompt was used)',
  };
}

// ============================================================================
// forecast_plan - Create capacity plan with timeline
// ============================================================================

export interface CreatePlanInput {
  projectId?: string;
  title: string;
  tasks: TaskEstimate[];
  teamSize?: number;           // Number of engineers (default: 1)
  hoursPerWeek?: number;       // Available hours per person per week (default: 32)
  startDate?: string;          // ISO date (default: today)
}

export interface CreatePlanOutput {
  plan: CapacityPlan;
  savedTo: string;
}

export async function createCapacityPlan(
  input: CreatePlanInput
): Promise<CreatePlanOutput | ForecastError> {
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.projectId);
  } catch {
    return makeProjectError('create capacity plan');
  }

  const calibration = await loadCalibration(resolved);
  const teamSize = input.teamSize || 1;
  const hoursPerWeek = input.hoursPerWeek || 32;
  const totalTeamHoursPerWeek = teamSize * hoursPerWeek;

  // Calculate totals
  let totalPoints = 0;
  let totalMinHours = 0;
  let totalMaxHours = 0;

  for (const task of input.tasks) {
    totalPoints += task.storyPoints;
    totalMinHours += task.estimatedHours.min;
    totalMaxHours += task.estimatedHours.max;
  }

  // Calculate velocity metrics
  const hoursPerPoint = calibration?.hoursPerStoryPoint || 4;
  const pointsPerWeek = Math.round(totalTeamHoursPerWeek / hoursPerPoint);

  // Calculate timeline
  const minWeeks = Math.ceil(totalMinHours / totalTeamHoursPerWeek);
  const maxWeeks = Math.ceil(totalMaxHours / totalTeamHoursPerWeek);

  const startDate = input.startDate ? new Date(input.startDate) : new Date();
  const minEndDate = new Date(startDate);
  minEndDate.setDate(minEndDate.getDate() + minWeeks * 7);
  const maxEndDate = new Date(startDate);
  maxEndDate.setDate(maxEndDate.getDate() + maxWeeks * 7);

  const plan: CapacityPlan = {
    id: generatePlanId(),
    title: input.title,
    createdAt: new Date().toISOString(),
    tasks: input.tasks,
    totals: {
      storyPoints: totalPoints,
      estimatedHours: { min: totalMinHours, max: totalMaxHours },
      taskCount: input.tasks.length,
    },
    teamVelocity: {
      pointsPerWeek,
      hoursPerPoint,
      confidence: calibration?.confidenceLevel || 'low',
    },
    timeline: {
      estimatedWeeks: { min: minWeeks, max: maxWeeks },
      estimatedEndDate: {
        min: minEndDate.toISOString().slice(0, 10),
        max: maxEndDate.toISOString().slice(0, 10),
      },
    },
  };

  // Save plan
  const plansDir = resolved.subPath('oracle', 'plans');
  ensureDir(plansDir);
  const planPath = path.join(plansDir, `${plan.id}.yml`);
  await fs.writeFile(planPath, YAML.stringify(plan), 'utf-8');

  log(`Forecast: Created capacity plan ${plan.id}`);

  return {
    plan,
    savedTo: planPath,
  };
}

// ============================================================================
// forecast_record - Record completed task for calibration
// ============================================================================

export interface RecordCompletedInput {
  projectId?: string;
  taskId?: string;
  category: TaskCategory;
  estimatedPoints: StoryPoints;
  actualHours: number;
  tags?: string[];
}

export interface RecordCompletedOutput {
  recorded: boolean;
  newCalibration: {
    dataPoints: number;
    hoursPerStoryPoint: number;
    confidence: Confidence;
  };
}

export async function recordCompletedTask(
  input: RecordCompletedInput
): Promise<RecordCompletedOutput | ForecastError> {
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.projectId);
  } catch {
    return makeProjectError('record completed task');
  }

  // Load existing calibration
  let calibration = await loadCalibration(resolved);
  if (!calibration) {
    calibration = {
      lastUpdated: new Date().toISOString(),
      dataPoints: 0,
      hoursPerStoryPoint: 4,
      categoryMultipliers: {},
      confidenceLevel: 'low',
      optInContribution: false,
    };
  }

  // Load completed tasks history
  const historyPath = resolved.subPath('oracle', 'completed_tasks.yml');
  let history: CompletedTask[] = [];
  try {
    const content = await fs.readFile(historyPath, 'utf-8');
    history = YAML.parse(content) || [];
  } catch {
    // Start fresh
  }

  // Add new completed task
  const completed: CompletedTask = {
    taskId: input.taskId || generateTaskId(),
    category: input.category,
    estimatedPoints: input.estimatedPoints,
    actualHours: input.actualHours,
    completedAt: new Date().toISOString(),
    tags: input.tags,
  };
  history.push(completed);

  // Recalculate calibration
  const totalPoints = history.reduce((sum, t) => sum + t.estimatedPoints, 0);
  const totalHours = history.reduce((sum, t) => sum + t.actualHours, 0);
  const newHoursPerPoint = totalHours / totalPoints;

  // Calculate category multipliers
  const categoryData: Record<string, { points: number; hours: number }> = {};
  for (const task of history) {
    if (!categoryData[task.category]) {
      categoryData[task.category] = { points: 0, hours: 0 };
    }
    categoryData[task.category].points += task.estimatedPoints;
    categoryData[task.category].hours += task.actualHours;
  }

  const newCategoryMultipliers: Partial<Record<TaskCategory, number>> = {};
  for (const [cat, data] of Object.entries(categoryData)) {
    if (data.points >= 3) { // Need at least 3 data points per category
      const catHoursPerPoint = data.hours / data.points;
      newCategoryMultipliers[cat as TaskCategory] = catHoursPerPoint / newHoursPerPoint;
    }
  }

  // Determine confidence level
  let confidence: Confidence = 'low';
  if (history.length >= 20) confidence = 'high';
  else if (history.length >= 10) confidence = 'medium';

  // Update calibration
  calibration.lastUpdated = new Date().toISOString();
  calibration.dataPoints = history.length;
  calibration.hoursPerStoryPoint = Math.round(newHoursPerPoint * 10) / 10;
  calibration.categoryMultipliers = newCategoryMultipliers;
  calibration.confidenceLevel = confidence;

  // Save
  const oracleDir = resolved.subPath('oracle');
  ensureDir(oracleDir);
  await fs.writeFile(historyPath, YAML.stringify(history), 'utf-8');
  await saveCalibration(resolved, calibration);

  log(`Forecast: Recorded completed task, calibration now has ${history.length} data points`);

  return {
    recorded: true,
    newCalibration: {
      dataPoints: calibration.dataPoints,
      hoursPerStoryPoint: calibration.hoursPerStoryPoint,
      confidence: calibration.confidenceLevel,
    },
  };
}

// ============================================================================
// forecast_calibration - Get current calibration status
// ============================================================================

export interface GetCalibrationInput {
  projectId?: string;
}

export interface GetCalibrationOutput {
  hasCalibration: boolean;
  calibration: CalibrationData | null;
  baseline: typeof BASELINE_HOURS;
  recommendations: string[];
}

export async function getCalibration(
  input: GetCalibrationInput
): Promise<GetCalibrationOutput | ForecastError> {
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.projectId);
  } catch {
    return makeProjectError('get calibration');
  }

  const calibration = await loadCalibration(resolved);
  const recommendations: string[] = [];

  if (!calibration) {
    recommendations.push('No calibration data. Record completed tasks to improve estimates.');
  } else {
    if (calibration.dataPoints < 10) {
      recommendations.push(`Only ${calibration.dataPoints} data points. Need 10+ for medium confidence.`);
    }
    if (calibration.dataPoints < 20) {
      recommendations.push(`Need 20+ data points for high confidence (currently ${calibration.dataPoints}).`);
    }
    if (Object.keys(calibration.categoryMultipliers).length < 3) {
      recommendations.push('Record tasks in more categories to improve category-specific estimates.');
    }
    if (!calibration.optInContribution) {
      recommendations.push('Consider opting in to contribute anonymized data to improve community estimates.');
    }
  }

  return {
    hasCalibration: calibration !== null && calibration.dataPoints > 0,
    calibration,
    baseline: BASELINE_HOURS,
    recommendations,
  };
}

// ============================================================================
// Type Guards
// ============================================================================

export function isForecastError(result: unknown): result is ForecastError {
  return typeof result === 'object' && result !== null && 'error' in result;
}
