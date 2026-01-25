// ============================================================================
// Feedback Domain Logic
// ============================================================================
// Tools for collecting user/AI feedback on tools, features, and workflows.
// Phase 1: feedback_submit + feedback_list
// ============================================================================

import fs from 'fs/promises';
import path from 'path';
import { log } from '../config.js';
import { ensureDir } from '../dataRoot.js';
import { resolveProjectPaths, validateWritePath, ResolvedProjectPaths } from '../projectRegistry.js';
import { emitCreateProvenance } from './provenance.js';

// ============================================================================
// Project Resolution Error
// ============================================================================

export interface ProjectResolutionError {
  error: 'project_resolution_failed';
  message: string;
  hint: string;
}

function makeProjectResolutionError(operation: string): ProjectResolutionError {
  return {
    error: 'project_resolution_failed',
    message: `Cannot ${operation}: No project context available.`,
    hint:
      'Either specify projectId parameter, set DECIBEL_PROJECT_ROOT env var, or run from a directory containing .decibel/',
  };
}

// ============================================================================
// Types
// ============================================================================

export type FeedbackCategory = 'tool' | 'workflow' | 'docs' | 'ux' | 'perf' | 'other';
export type FeedbackSentiment = 'positive' | 'negative';
export type FeedbackSource = 'human' | 'agent';
export type FeedbackStatus = 'open' | 'acknowledged' | 'actioned' | 'archived';

export interface SubmitFeedbackInput {
  projectId?: string;
  category: FeedbackCategory;
  feedback: string;           // the feedback text
  tool_ref?: string;          // specific tool name (if category=tool)
  sentiment?: FeedbackSentiment;
  source?: FeedbackSource;
  tags?: string[];
}

export interface SubmitFeedbackOutput {
  id: string;
  path: string;
  created_at: string;
  category: FeedbackCategory;
  sentiment: FeedbackSentiment;
}

export interface ListFeedbackInput {
  projectId?: string;
  category?: FeedbackCategory;
  tool_ref?: string;
  sentiment?: FeedbackSentiment;
  status?: FeedbackStatus;
  limit?: number;
  since?: string;             // ISO date string
}

export interface FeedbackEntry {
  id: string;
  category: FeedbackCategory;
  tool_ref: string;
  sentiment: FeedbackSentiment;
  source: FeedbackSource;
  status: FeedbackStatus;
  created_at: string;
  tags: string[];
  excerpt: string;            // first line of feedback body
}

export interface ListFeedbackOutput {
  entries: FeedbackEntry[];
  summary: {
    total: number;
    by_category: Record<string, number>;
    sentiment_breakdown: Record<string, number>;
  };
}

export interface FeedbackError {
  error: string;
  details?: string;
}

// ============================================================================
// Helpers
// ============================================================================

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50);
}

function formatTimestampForFilename(date: Date): string {
  const iso = date.toISOString();
  return iso.replace(/:/g, '-').replace(/\.\d{3}Z$/, 'Z');
}

async function parseFeedbackFile(filePath: string): Promise<FeedbackEntry | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) return null;

    const frontmatter: Record<string, string | string[]> = {};
    for (const line of frontmatterMatch[1].split('\n')) {
      const colonIndex = line.indexOf(':');
      if (colonIndex > 0) {
        const key = line.slice(0, colonIndex).trim();
        const value = line.slice(colonIndex + 1).trim();

        if (value.startsWith('[') && value.endsWith(']')) {
          frontmatter[key] = value
            .slice(1, -1)
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
        } else {
          frontmatter[key] = value;
        }
      }
    }

    // Extract first line of feedback body (after heading)
    const bodyMatch = content.match(/---\n\n# .+\n\n([\s\S]*?)(?=\n## |$)/);
    const excerpt = bodyMatch ? bodyMatch[1].trim().split('\n')[0] : '';

    return {
      id: path.basename(filePath, '.md'),
      category: (frontmatter.category as FeedbackCategory) || 'other',
      tool_ref: (frontmatter.tool_ref as string) || '',
      sentiment: (frontmatter.sentiment as FeedbackSentiment) || 'positive',
      source: (frontmatter.source as FeedbackSource) || 'human',
      status: (frontmatter.status as FeedbackStatus) || 'open',
      created_at: (frontmatter.created_at as string) || '',
      tags: (frontmatter.tags as string[]) || [],
      excerpt,
    };
  } catch {
    return null;
  }
}

export function isFeedbackError(result: unknown): result is FeedbackError {
  return typeof result === 'object' && result !== null && 'error' in result && !('entries' in result);
}

// ============================================================================
// feedback_submit
// ============================================================================

export async function submitFeedback(
  input: SubmitFeedbackInput
): Promise<SubmitFeedbackOutput | ProjectResolutionError> {
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.projectId);
  } catch {
    return makeProjectResolutionError('submit feedback');
  }

  const now = new Date();
  const timestamp = now.toISOString();
  const fileTimestamp = formatTimestampForFilename(now);

  const feedbackDir = resolved.subPath('feedback');
  ensureDir(feedbackDir);

  // Build slug from feedback text or tool_ref
  const slugSource = input.tool_ref
    ? `${input.category}-${input.tool_ref}`
    : `${input.category}-${input.feedback}`;
  const slug = slugify(slugSource);
  const filename = `${fileTimestamp}-${slug}.md`;
  const filePath = path.join(feedbackDir, filename);

  const sentiment = input.sentiment || 'positive';
  const source = input.source || 'human';
  const tags = input.tags || [];

  // Build frontmatter
  const frontmatterLines = [
    '---',
    `category: ${input.category}`,
  ];
  if (input.tool_ref) {
    frontmatterLines.push(`tool_ref: ${input.tool_ref}`);
  }
  frontmatterLines.push(
    `sentiment: ${sentiment}`,
    `source: ${source}`,
    `status: open`,
    `created_at: ${timestamp}`,
    `tags: [${tags.join(', ')}]`,
    '---',
  );
  const frontmatter = frontmatterLines.join('\n');

  // Build heading
  const heading = input.tool_ref
    ? `# Feedback: ${input.tool_ref}`
    : `# Feedback: ${input.category}`;

  // Build body
  const bodyLines = [
    heading,
    '',
    input.feedback,
    '',
    '## Details',
    '',
    `**Category:** ${input.category}`,
  ];
  if (input.tool_ref) {
    bodyLines.push(`**Tool:** ${input.tool_ref}`);
  }
  bodyLines.push(
    `**Sentiment:** ${sentiment === 'positive' ? '👍' : '👎'} ${sentiment}`,
    `**Source:** ${source}`,
    `**Date:** ${timestamp}`,
  );

  const content = `${frontmatter}\n\n${bodyLines.join('\n')}\n`;

  validateWritePath(filePath, resolved);
  await fs.writeFile(filePath, content, 'utf-8');
  log(`Feedback: Submitted feedback at ${filePath} (project: ${resolved.id})`);

  // Emit provenance event
  await emitCreateProvenance(
    `feedback:submit:${filename.replace('.md', '')}`,
    content,
    `Submitted feedback: ${input.category}${input.tool_ref ? ` (${input.tool_ref})` : ''}`,
    input.projectId,
  );

  return {
    id: filename.replace('.md', ''),
    path: filePath,
    created_at: timestamp,
    category: input.category,
    sentiment,
  };
}

// ============================================================================
// feedback_list
// ============================================================================

export async function listFeedback(
  input: ListFeedbackInput
): Promise<ListFeedbackOutput | ProjectResolutionError> {
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.projectId);
  } catch {
    return makeProjectResolutionError('list feedback');
  }

  const feedbackDir = resolved.subPath('feedback');
  const limit = input.limit || 20;

  let entries: FeedbackEntry[] = [];

  // Summary accumulators (count all before filtering)
  const byCategory: Record<string, number> = {};
  const sentimentBreakdown: Record<string, number> = { positive: 0, negative: 0 };
  let totalCount = 0;

  try {
    const files = await fs.readdir(feedbackDir);

    for (const file of files) {
      if (!file.endsWith('.md')) continue;

      const filePath = path.join(feedbackDir, file);
      const entry = await parseFeedbackFile(filePath);
      if (!entry) continue;

      // Count for summary (before filtering)
      totalCount++;
      byCategory[entry.category] = (byCategory[entry.category] || 0) + 1;
      sentimentBreakdown[entry.sentiment] = (sentimentBreakdown[entry.sentiment] || 0) + 1;

      // Apply filters
      if (input.category && entry.category !== input.category) continue;
      if (input.tool_ref && entry.tool_ref !== input.tool_ref) continue;
      if (input.sentiment && entry.sentiment !== input.sentiment) continue;
      if (input.status && entry.status !== input.status) continue;
      if (input.since && entry.created_at < input.since) continue;

      entries.push(entry);
    }
  } catch {
    // Directory doesn't exist yet
  }

  // Sort by created_at descending (newest first)
  entries.sort((a, b) => b.created_at.localeCompare(a.created_at));

  // Apply limit
  entries = entries.slice(0, limit);

  return {
    entries,
    summary: {
      total: totalCount,
      by_category: byCategory,
      sentiment_breakdown: sentimentBreakdown,
    },
  };
}
