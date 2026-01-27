// ============================================================================
// Git Domain Tool Definitions
// ============================================================================

import { ToolSpec } from '../types.js';
import { toolSuccess, toolError } from '../shared/index.js';
import {
  gitLogRecent,
  gitChangedFiles,
  gitFindRemoval,
  gitBlame,
  gitTags,
  gitStatus,
  isGitErrorResult,
  GitLogInput,
  GitChangedFilesInput,
  GitFindRemovalInput,
  GitBlameInput,
  GitTagsInput,
  GitStatusInput,
} from '../git.js';

// ============================================================================
// git_log_recent
// ============================================================================

export const gitLogRecentTool: ToolSpec = {
  definition: {
    name: 'git_log_recent',
    description: 'Get recent git commits. Use for reviewing history, finding changes, or investigating regressions.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project identifier. Uses current project if not specified.',
        },
        count: {
          type: 'number',
          description: 'Number of commits to return (default: 20)',
        },
        since: {
          type: 'string',
          description: 'Show commits after date (e.g., "2 weeks ago", "2025-01-01")',
        },
        until: {
          type: 'string',
          description: 'Show commits before date',
        },
        author: {
          type: 'string',
          description: 'Filter by author name or email',
        },
        path: {
          type: 'string',
          description: 'Filter to commits affecting this path',
        },
        grep: {
          type: 'string',
          description: 'Search commit messages for this pattern',
        },
      },
      required: [],
    },
  },
  handler: async (args) => {
    const result = await gitLogRecent(args as GitLogInput);
    if (isGitErrorResult(result)) {
      return toolError(result.error, result.stderr);
    }
    return toolSuccess(result);
  },
};

// ============================================================================
// git_changed_files
// ============================================================================

export const gitChangedFilesTool: ToolSpec = {
  definition: {
    name: 'git_changed_files',
    description: 'List files changed between two commits, tags, or branches. Useful for reviewing what changed in a release or feature.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project identifier',
        },
        from: {
          type: 'string',
          description: 'Starting point: commit SHA, tag, or branch (default: HEAD~1)',
        },
        to: {
          type: 'string',
          description: 'Ending point (default: HEAD)',
        },
      },
      required: [],
    },
  },
  handler: async (args) => {
    const result = await gitChangedFiles(args as GitChangedFilesInput);
    if (isGitErrorResult(result)) {
      return toolError(result.error, result.stderr);
    }
    return toolSuccess(result);
  },
};

// ============================================================================
// git_find_removal
// ============================================================================

export const gitFindRemovalTool: ToolSpec = {
  definition: {
    name: 'git_find_removal',
    description: 'Find when a string, function, or code was removed. Uses git log -S for "pickaxe" search. Essential for debugging regressions.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project identifier',
        },
        search: {
          type: 'string',
          description: 'String to search for (function name, variable, etc.)',
        },
        path: {
          type: 'string',
          description: 'Limit search to specific path pattern',
        },
      },
      required: ['search'],
    },
  },
  handler: async (args) => {
    const result = await gitFindRemoval(args as GitFindRemovalInput);
    if (isGitErrorResult(result)) {
      return toolError(result.error, result.stderr);
    }
    return toolSuccess(result);
  },
};

// ============================================================================
// git_blame_context
// ============================================================================

export const gitBlameContextTool: ToolSpec = {
  definition: {
    name: 'git_blame_context',
    description: 'Get blame information for a file or line range. Shows who changed what and when. Useful for understanding code history.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project identifier',
        },
        file: {
          type: 'string',
          description: 'Path to the file',
        },
        line: {
          type: 'number',
          description: 'Specific line number to blame',
        },
        startLine: {
          type: 'number',
          description: 'Start of line range',
        },
        endLine: {
          type: 'number',
          description: 'End of line range',
        },
      },
      required: ['file'],
    },
  },
  handler: async (args) => {
    const result = await gitBlame(args as GitBlameInput);
    if (isGitErrorResult(result)) {
      return toolError(result.error, result.stderr);
    }
    return toolSuccess(result);
  },
};

// ============================================================================
// git_tags
// ============================================================================

export const gitTagsTool: ToolSpec = {
  definition: {
    name: 'git_tags',
    description: 'List git tags sorted by date. Useful for release forensics and finding known-good versions.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project identifier',
        },
        count: {
          type: 'number',
          description: 'Number of tags to return (default: 10)',
        },
        pattern: {
          type: 'string',
          description: 'Filter pattern (e.g., "v*" for version tags)',
        },
      },
      required: [],
    },
  },
  handler: async (args) => {
    const result = await gitTags(args as GitTagsInput);
    if (isGitErrorResult(result)) {
      return toolError(result.error, result.stderr);
    }
    return toolSuccess(result);
  },
};

// ============================================================================
// git_status
// ============================================================================

export const gitStatusTool: ToolSpec = {
  definition: {
    name: 'git_status',
    description: 'Get current git status: branch, uncommitted changes, ahead/behind remote.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project identifier',
        },
      },
      required: [],
    },
  },
  handler: async (args) => {
    const result = await gitStatus(args as GitStatusInput);
    if (isGitErrorResult(result)) {
      return toolError(result.error, result.stderr);
    }
    return toolSuccess(result);
  },
};

// ============================================================================
// Export All Tools
// ============================================================================

export const gitTools: ToolSpec[] = [
  gitLogRecentTool,
  gitChangedFilesTool,
  gitFindRemovalTool,
  gitBlameContextTool,
  gitTagsTool,
  gitStatusTool,
];
