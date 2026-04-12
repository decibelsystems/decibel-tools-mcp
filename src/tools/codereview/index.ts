// ============================================================================
// Code Review Domain Tools
// ============================================================================
// Tools for ingesting code review output and creating issues/learnings.
// ============================================================================

import { ToolSpec } from '../types.js';
import { toolSuccess, toolError, requireFields } from '../shared/index.js';
import {
  ingestCodeReview,
  IngestInput,
  ReviewType,
  isCodeReviewError,
} from '../codereview.js';

const VALID_REVIEW_TYPES: ReviewType[] = ['code-review', 'security-review', 'pr-review', 'general'];

function normalizeProjectId(args: Record<string, unknown>): void {
  if (!args.projectId && args.project_id) {
    args.projectId = args.project_id;
  }
}

export const codeReviewIngestTool: ToolSpec = {
  definition: {
    name: 'codereview_ingest',
    description: `Ingest code review output and automatically create issues, friction points, and learnings.

Paste the raw output from /code-review, /security-review, or /pr-review-toolkit.
The tool will parse findings and create appropriate entries in .decibel/.

**What gets created:**
- Critical/High bugs and security issues → sentinel issues
- Performance and architecture issues → sentinel issues
- Patterns, learnings, and insights → learnings entries
- Style issues → skipped (too noisy)

**Tips:**
- Use dry_run=true to preview what would be created without creating anything
- Include source info (pr_number, branch) for better traceability
- Works best with structured review output (## sections, bullet points)`,
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description: 'Project ID (optional, uses default if not provided)',
        },
        project_id: {
          type: 'string',
          description: 'Alias for projectId',
        },
        review_type: {
          type: 'string',
          enum: ['code-review', 'security-review', 'pr-review', 'general'],
          description: 'Type of review being ingested',
        },
        raw_output: {
          type: 'string',
          description: 'Raw text output from the code review',
        },
        source: {
          type: 'object',
          description: 'Source information for traceability',
          properties: {
            pr_number: { type: 'string', description: 'Pull request number' },
            branch: { type: 'string', description: 'Branch name' },
            commit: { type: 'string', description: 'Commit SHA' },
          },
        },
        dry_run: {
          type: 'boolean',
          description: 'Preview what would be created without actually creating entries',
        },
      },
      required: ['review_type', 'raw_output'],
    },
  },
  handler: async (args) => {
    try {
      const rawInput = args as Record<string, unknown>;
      normalizeProjectId(rawInput);
      const input = rawInput as unknown as IngestInput;

      requireFields(input, 'review_type', 'raw_output');

      if (!VALID_REVIEW_TYPES.includes(input.review_type)) {
        throw new Error(`Invalid review_type. Must be one of: ${VALID_REVIEW_TYPES.join(', ')}`);
      }

      if (!input.raw_output || input.raw_output.trim().length === 0) {
        throw new Error('raw_output cannot be empty');
      }

      const result = await ingestCodeReview(input);

      if (isCodeReviewError(result)) {
        return toolError(result.message, result.hint);
      }

      return toolSuccess(result);
    } catch (err) {
      return toolError(err instanceof Error ? err.message : String(err));
    }
  },
};

export const codeReviewTools: ToolSpec[] = [codeReviewIngestTool];
