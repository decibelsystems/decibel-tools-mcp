// ============================================================================
// Git-Sentinel Domain Tool Definitions
// ============================================================================
// Tools for linking git commits to Sentinel artifacts (issues, epics).
// Bidirectional: link commits to artifacts, query linked commits,
// and reverse-lookup which artifacts reference a commit.
// ============================================================================

import { ToolSpec } from '../types.js';
import { toolSuccess, toolError } from '../shared/index.js';
import {
  sentinelLinkCommit,
  sentinelGetLinkedCommits,
  gitFindLinkedIssues,
  autoLinkCommit,
  isLinkError,
  SentinelLinkCommitInput,
  SentinelGetCommitsInput,
  GitFindIssueInput,
  AutoLinkInput,
} from '../git-sentinel.js';

// ============================================================================
// Constants
// ============================================================================

const RELATIONSHIP_TYPES = [
  'fixes',
  'closes',
  'related',
  'reverts',
  'breaks',
  'implements',
] as const;

// ============================================================================
// sentinel_link_commit
// ============================================================================

export const sentinelLinkCommitTool: ToolSpec = {
  definition: {
    name: 'sentinel_link_commit',
    description:
      'Link a git commit to a Sentinel artifact (issue or epic). Creates a bidirectional reference stored in the artifact YAML. Use after committing a fix, implementing a feature, or reverting a change.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description:
            'Project identifier. Uses current project if not specified.',
        },
        artifactId: {
          type: 'string',
          description:
            'Sentinel artifact ID to link to (e.g., "ISS-0042", "EPIC-0015")',
        },
        commitSha: {
          type: 'string',
          description: 'Full or short git commit SHA to link',
        },
        relationship: {
          type: 'string',
          enum: [...RELATIONSHIP_TYPES],
          description:
            'How the commit relates to the artifact (default: "related")',
        },
      },
      required: ['artifactId', 'commitSha'],
    },
  },
  handler: async (args) => {
    try {
      const result = await sentinelLinkCommit(args as SentinelLinkCommitInput);
      if (isLinkError(result)) {
        return toolError(result.error, result.details);
      }
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// sentinel_get_linked_commits
// ============================================================================

export const sentinelGetLinkedCommitsTool: ToolSpec = {
  definition: {
    name: 'sentinel_get_linked_commits',
    description:
      'Get all git commits linked to a Sentinel artifact (issue or epic). Shows commit SHAs, messages, relationships, and when they were linked.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description:
            'Project identifier. Uses current project if not specified.',
        },
        artifactId: {
          type: 'string',
          description:
            'Sentinel artifact ID to query (e.g., "ISS-0042", "EPIC-0015")',
        },
      },
      required: ['artifactId'],
    },
  },
  handler: async (args) => {
    try {
      const result = await sentinelGetLinkedCommits(
        args as SentinelGetCommitsInput,
      );
      if (isLinkError(result)) {
        return toolError(result.error, result.details);
      }
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// git_find_linked_issues
// ============================================================================

export const gitFindLinkedIssuesTool: ToolSpec = {
  definition: {
    name: 'git_find_linked_issues',
    description:
      'Reverse lookup: find all Sentinel artifacts (issues, epics) that reference a specific git commit. Useful for understanding the impact and context of a commit.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description:
            'Project identifier. Uses current project if not specified.',
        },
        commitSha: {
          type: 'string',
          description: 'Full or short git commit SHA to search for',
        },
      },
      required: ['commitSha'],
    },
  },
  handler: async (args) => {
    try {
      const result = await gitFindLinkedIssues(args as GitFindIssueInput);
      if (isLinkError(result)) {
        return toolError(result.error, result.details);
      }
      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

// ============================================================================
// sentinel_auto_link
// ============================================================================

export const sentinelAutoLinkTool: ToolSpec = {
  definition: {
    name: 'sentinel_auto_link',
    description:
      'Auto-link a commit to issues/epics referenced in its message. Parses patterns like "fixes ISS-0042", "closes EPIC-0001", or standalone "ISS-0042" references. Call after commits to automatically create links.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description:
            'Project identifier. Uses current project if not specified.',
        },
        commitSha: {
          type: 'string',
          description:
            'Commit SHA to process (default: HEAD). Parses commit message for issue/epic references.',
        },
      },
    },
  },
  handler: async (args) => {
    try {
      const result = await autoLinkCommit(args as AutoLinkInput);
      if (isLinkError(result)) {
        return toolError(result.error, result.details);
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

export const gitSentinelTools: ToolSpec[] = [
  sentinelLinkCommitTool,
  sentinelGetLinkedCommitsTool,
  gitFindLinkedIssuesTool,
  sentinelAutoLinkTool,
];
