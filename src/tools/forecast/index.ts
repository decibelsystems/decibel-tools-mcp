// ============================================================================
// Forecasting Engine MCP Tool Definitions
// ============================================================================
// DOJO-PROP-0005: Capacity planning tools for engineering managers.
// ============================================================================

import { ToolSpec } from '../types.js';
import { toolSuccess, toolError, requireFields } from '../shared/index.js';
import {
  generateDecomposePrompt,
  parseDecomposeResponse,
  createCapacityPlan,
  recordCompletedTask,
  getCalibration,
  isForecastError,
  DecomposeInput,
  CreatePlanInput,
  RecordCompletedInput,
  GetCalibrationInput,
  TaskEstimate,
  StoryPoints,
  TaskCategory,
} from '../forecast.js';

// ============================================================================
// Constants
// ============================================================================

const VALID_STORY_POINTS: StoryPoints[] = [1, 2, 3, 5, 8, 13, 21];
const VALID_CATEGORIES: TaskCategory[] = [
  'frontend', 'backend', 'api', 'database', 'devops',
  'testing', 'documentation', 'design', 'other'
];

// ============================================================================
// forecast_decompose - Generate decomposition prompt
// ============================================================================

export const forecastDecomposeTool: ToolSpec = {
  definition: {
    name: 'forecast_decompose',
    description: 'Generate a prompt to decompose a PRD/feature into engineering tasks with story points. Returns a structured prompt - use this with Claude to get task breakdown, then call forecast_parse to process the response.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project identifier. Uses default if not specified.',
        },
        title: {
          type: 'string',
          description: 'Feature/PRD title',
        },
        description: {
          type: 'string',
          description: 'Detailed description of the feature to decompose',
        },
        context: {
          type: 'string',
          description: 'Optional additional context about codebase, team, or constraints',
        },
      },
      required: ['title', 'description'],
    },
  },
  handler: async (args) => {
    try {
      const input = args as DecomposeInput;
      requireFields(input, 'title', 'description');

      const result = await generateDecomposePrompt(input);
      if (isForecastError(result)) {
        return toolError(result.message, result.hint);
      }
      return toolSuccess({
        prompt: result.prompt,
        hasCalibration: result.calibration !== null,
        instructions: 'Send this prompt to Claude, then use forecast_parse with the YAML response.',
      });
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// forecast_parse - Parse decomposition response
// ============================================================================

export const forecastParseTool: ToolSpec = {
  definition: {
    name: 'forecast_parse',
    description: 'Parse Claude\'s YAML response from forecast_decompose into structured tasks with hour estimates. Applies calibration data if available.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project identifier. Uses default if not specified.',
        },
        title: {
          type: 'string',
          description: 'Feature title (same as decompose)',
        },
        yamlResponse: {
          type: 'string',
          description: 'The YAML task list from Claude\'s response',
        },
      },
      required: ['title', 'yamlResponse'],
    },
  },
  handler: async (args) => {
    try {
      const { projectId, title, yamlResponse } = args as {
        projectId?: string;
        title: string;
        yamlResponse: string;
      };
      requireFields({ title, yamlResponse }, 'title', 'yamlResponse');

      const result = await parseDecomposeResponse(projectId, title, yamlResponse);
      if (isForecastError(result)) {
        return toolError(result.message, result.hint);
      }
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// forecast_plan - Create capacity plan with timeline
// ============================================================================

export const forecastPlanTool: ToolSpec = {
  definition: {
    name: 'forecast_plan',
    description: 'Create a capacity plan from tasks with timeline estimates. Uses team size, velocity data, and calibration to project completion dates.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project identifier. Uses default if not specified.',
        },
        title: {
          type: 'string',
          description: 'Plan title',
        },
        tasks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              title: { type: 'string' },
              description: { type: 'string' },
              category: { type: 'string', enum: VALID_CATEGORIES },
              storyPoints: { type: 'number', enum: VALID_STORY_POINTS },
              estimatedHours: {
                type: 'object',
                properties: {
                  min: { type: 'number' },
                  max: { type: 'number' },
                },
              },
              confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
            },
          },
          description: 'Array of TaskEstimate objects (from forecast_parse)',
        },
        teamSize: {
          type: 'number',
          description: 'Number of engineers (default: 1)',
        },
        hoursPerWeek: {
          type: 'number',
          description: 'Available hours per person per week (default: 32)',
        },
        startDate: {
          type: 'string',
          description: 'Start date in ISO format (default: today)',
        },
      },
      required: ['title', 'tasks'],
    },
  },
  handler: async (args) => {
    try {
      const input = args as CreatePlanInput;
      requireFields(input, 'title', 'tasks');

      if (!Array.isArray(input.tasks) || input.tasks.length === 0) {
        throw new Error('tasks must be a non-empty array');
      }

      const result = await createCapacityPlan(input);
      if (isForecastError(result)) {
        return toolError(result.message, result.hint);
      }
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// forecast_record - Record completed task for calibration
// ============================================================================

export const forecastRecordTool: ToolSpec = {
  definition: {
    name: 'forecast_record',
    description: 'Record a completed task with actual hours to improve future estimates. Builds calibration data over time for more accurate forecasts.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project identifier. Uses default if not specified.',
        },
        taskId: {
          type: 'string',
          description: 'Optional task ID for reference',
        },
        category: {
          type: 'string',
          enum: VALID_CATEGORIES,
          description: 'Task category',
        },
        estimatedPoints: {
          type: 'number',
          enum: VALID_STORY_POINTS,
          description: 'Original story point estimate',
        },
        actualHours: {
          type: 'number',
          description: 'Actual hours spent on the task',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional tags for categorization',
        },
      },
      required: ['category', 'estimatedPoints', 'actualHours'],
    },
  },
  handler: async (args) => {
    try {
      const input = args as RecordCompletedInput;
      requireFields(input, 'category', 'estimatedPoints', 'actualHours');

      if (!VALID_CATEGORIES.includes(input.category)) {
        throw new Error(`Invalid category. Must be one of: ${VALID_CATEGORIES.join(', ')}`);
      }
      if (!VALID_STORY_POINTS.includes(input.estimatedPoints)) {
        throw new Error(`Invalid story points. Must be one of: ${VALID_STORY_POINTS.join(', ')}`);
      }

      const result = await recordCompletedTask(input);
      if (isForecastError(result)) {
        return toolError(result.message, result.hint);
      }
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// forecast_calibration - Get calibration status
// ============================================================================

export const forecastCalibrationTool: ToolSpec = {
  definition: {
    name: 'forecast_calibration',
    description: 'Get current calibration status and recommendations. Shows hours-per-story-point ratio, category multipliers, and data quality.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project identifier. Uses default if not specified.',
        },
      },
    },
  },
  handler: async (args) => {
    try {
      const input = args as GetCalibrationInput;
      const result = await getCalibration(input);
      if (isForecastError(result)) {
        return toolError(result.message, result.hint);
      }
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// Export All Tools
// ============================================================================

export const forecastTools: ToolSpec[] = [
  forecastDecomposeTool,
  forecastParseTool,
  forecastPlanTool,
  forecastRecordTool,
  forecastCalibrationTool,
];
