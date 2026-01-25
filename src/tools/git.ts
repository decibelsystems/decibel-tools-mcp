// ============================================================================
// Git Domain Tools
// ============================================================================
// Native git operations for project forensics and history tracking.
// Uses child_process.spawn with git (universally available in dev environments).
// ============================================================================

import { spawn } from 'child_process';
import path from 'path';
import { resolveProjectPaths, ResolvedProjectPaths } from '../projectRegistry.js';

// ============================================================================
// Types
// ============================================================================

export interface GitCommit {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  date: string;
  files?: string[];
}

export interface GitLogInput {
  projectId?: string;
  count?: number;       // Default: 20
  since?: string;       // e.g., "2 weeks ago", "2025-01-01"
  until?: string;
  author?: string;
  path?: string;        // Filter to specific path
  grep?: string;        // Search commit messages
}

// Extended commit with line statistics
export interface GitCommitWithStats {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  email: string;
  date: string;
  linesAdded: number;
  linesDeleted: number;
  filesChanged: number;
}

export interface GitLogWithStatsInput {
  projectId?: string;
  count?: number;       // Default: 20
  since?: string;       // e.g., "2 weeks ago", "2025-01-01"
  until?: string;
  author?: string;
  path?: string;        // Filter to specific path
}

export interface GitLogWithStatsOutput {
  commits: GitCommitWithStats[];
  total: number;
  totals: {
    linesAdded: number;
    linesDeleted: number;
    filesChanged: number;
  };
}

export interface GitLogOutput {
  commits: GitCommit[];
  total: number;
}

export interface GitChangedFilesInput {
  projectId?: string;
  from?: string;        // Commit SHA, tag, or branch (default: HEAD~1)
  to?: string;          // Default: HEAD
  nameOnly?: boolean;   // Just file names (default: true)
}

export interface GitChangedFilesOutput {
  files: Array<{
    path: string;
    status: 'A' | 'M' | 'D' | 'R' | 'C' | 'U';  // Added, Modified, Deleted, Renamed, Copied, Unmerged
  }>;
  from: string;
  to: string;
}

export interface GitFindRemovalInput {
  projectId?: string;
  search: string;       // String to search for (function name, variable, etc.)
  path?: string;        // Limit to specific path pattern
}

export interface GitFindRemovalOutput {
  matches: Array<{
    sha: string;
    message: string;
    date: string;
    author: string;
    changeType: 'added' | 'removed';
  }>;
  searchTerm: string;
}

export interface GitBlameInput {
  projectId?: string;
  file: string;
  line?: number;        // Specific line
  startLine?: number;   // Range start
  endLine?: number;     // Range end
}

export interface GitBlameOutput {
  lines: Array<{
    lineNumber: number;
    sha: string;
    author: string;
    date: string;
    content: string;
  }>;
  file: string;
}

export interface GitTagsInput {
  projectId?: string;
  count?: number;       // Default: 10
  pattern?: string;     // e.g., "v*"
}

export interface GitTagsOutput {
  tags: Array<{
    name: string;
    sha: string;
    date?: string;
    message?: string;
  }>;
}

export interface GitStatusInput {
  projectId?: string;
}

export interface GitStatusOutput {
  branch: string;
  ahead: number;
  behind: number;
  staged: number;
  modified: number;
  untracked: number;
  hasChanges: boolean;
}

export interface GitError {
  error: string;
  stderr?: string;
  exitCode?: number;
}

// ============================================================================
// Helpers
// ============================================================================

interface ExecGitResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function execGit(args: string[], cwd: string): Promise<ExecGitResult> {
  return new Promise((resolve) => {
    const proc = spawn('git', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('error', (err) => {
      resolve({ stdout: '', stderr: err.message, exitCode: -1 });
    });

    proc.on('close', (code) => {
      resolve({ stdout, stderr, exitCode: code ?? -1 });
    });
  });
}

function isGitError(result: ExecGitResult): boolean {
  return result.exitCode !== 0;
}

function makeGitError(message: string, result?: ExecGitResult): GitError {
  return {
    error: message,
    stderr: result?.stderr,
    exitCode: result?.exitCode,
  };
}

// ============================================================================
// Git Log
// ============================================================================

export async function gitLogRecent(
  input: GitLogInput
): Promise<GitLogOutput | GitError> {
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.projectId);
  } catch {
    return makeGitError('Failed to resolve project path');
  }

  const count = input.count || 20;
  const format = '%H|%h|%s|%an|%aI';  // SHA|shortSHA|subject|author|ISO date

  const args = ['log', `--format=${format}`, `-${count}`];

  if (input.since) args.push(`--since=${input.since}`);
  if (input.until) args.push(`--until=${input.until}`);
  if (input.author) args.push(`--author=${input.author}`);
  if (input.grep) args.push(`--grep=${input.grep}`);
  if (input.path) args.push('--', input.path);

  const result = await execGit(args, resolved.projectPath);

  if (isGitError(result)) {
    return makeGitError('Failed to get git log', result);
  }

  const commits: GitCommit[] = result.stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line: string) => {
      const [sha, shortSha, message, author, date] = line.split('|');
      return { sha, shortSha, message, author, date };
    });

  return { commits, total: commits.length };
}

// ============================================================================
// Git Log With Stats (includes line counts)
// ============================================================================

export async function gitLogWithStats(
  input: GitLogWithStatsInput
): Promise<GitLogWithStatsOutput | GitError> {
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.projectId);
  } catch {
    return makeGitError('Failed to resolve project path');
  }

  const count = input.count || 20;
  // Format includes email for contributor identification
  const format = '---COMMIT---%H|%h|%s|%an|%ae|%aI';

  const args = ['log', `--format=${format}`, '--numstat', `-${count}`];

  if (input.since) args.push(`--since=${input.since}`);
  if (input.until) args.push(`--until=${input.until}`);
  if (input.author) args.push(`--author=${input.author}`);
  if (input.path) args.push('--', input.path);

  const result = await execGit(args, resolved.projectPath);

  if (isGitError(result)) {
    return makeGitError('Failed to get git log with stats', result);
  }

  const commits: GitCommitWithStats[] = [];
  let totalLinesAdded = 0;
  let totalLinesDeleted = 0;
  let totalFilesChanged = 0;

  // Parse output: each commit starts with ---COMMIT--- marker
  // followed by numstat lines (added\tdeleted\tfilename)
  const chunks = result.stdout.split('---COMMIT---').filter(Boolean);

  for (const chunk of chunks) {
    const lines = chunk.trim().split('\n');
    if (lines.length === 0) continue;

    // First line is the formatted commit info
    const [sha, shortSha, message, author, email, date] = lines[0].split('|');
    if (!sha) continue;

    // Remaining lines are numstat (added\tdeleted\tfilename)
    let linesAdded = 0;
    let linesDeleted = 0;
    let filesChanged = 0;

    for (let i = 1; i < lines.length; i++) {
      const statLine = lines[i].trim();
      if (!statLine) continue;

      const parts = statLine.split('\t');
      if (parts.length >= 2) {
        // Handle binary files (shows '-' instead of numbers)
        const added = parts[0] === '-' ? 0 : parseInt(parts[0], 10) || 0;
        const deleted = parts[1] === '-' ? 0 : parseInt(parts[1], 10) || 0;
        linesAdded += added;
        linesDeleted += deleted;
        filesChanged++;
      }
    }

    commits.push({
      sha,
      shortSha,
      message,
      author,
      email,
      date,
      linesAdded,
      linesDeleted,
      filesChanged,
    });

    totalLinesAdded += linesAdded;
    totalLinesDeleted += linesDeleted;
    totalFilesChanged += filesChanged;
  }

  return {
    commits,
    total: commits.length,
    totals: {
      linesAdded: totalLinesAdded,
      linesDeleted: totalLinesDeleted,
      filesChanged: totalFilesChanged,
    },
  };
}

// ============================================================================
// Git Changed Files
// ============================================================================

export async function gitChangedFiles(
  input: GitChangedFilesInput
): Promise<GitChangedFilesOutput | GitError> {
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.projectId);
  } catch {
    return makeGitError('Failed to resolve project path');
  }

  const from = input.from || 'HEAD~1';
  const to = input.to || 'HEAD';

  const args = ['diff', '--name-status', from, to];
  const result = await execGit(args, resolved.projectPath);

  if (isGitError(result)) {
    return makeGitError(`Failed to get changed files between ${from} and ${to}`, result);
  }

  const files = result.stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line: string) => {
      const [status, ...pathParts] = line.split('\t');
      return {
        status: status.charAt(0) as 'A' | 'M' | 'D' | 'R' | 'C' | 'U',
        path: pathParts.join('\t'),  // Handle paths with tabs (rare)
      };
    });

  return { files, from, to };
}

// ============================================================================
// Git Find Removal (git log -S)
// ============================================================================

export async function gitFindRemoval(
  input: GitFindRemovalInput
): Promise<GitFindRemovalOutput | GitError> {
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.projectId);
  } catch {
    return makeGitError('Failed to resolve project path');
  }

  const format = '%H|%s|%aI|%an';
  const args = ['log', `-S${input.search}`, `--format=${format}`, '--all'];

  if (input.path) args.push('--', input.path);

  const result = await execGit(args, resolved.projectPath);

  if (isGitError(result)) {
    return makeGitError(`Failed to search for "${input.search}"`, result);
  }

  const matches = result.stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line: string) => {
      const [sha, message, date, author] = line.split('|');
      // Note: -S shows both adds and removes, we'd need diff to distinguish
      // For now, mark as 'removed' since that's the primary use case
      return { sha, message, date, author, changeType: 'removed' as const };
    });

  return { matches, searchTerm: input.search };
}

// ============================================================================
// Git Blame
// ============================================================================

export async function gitBlame(
  input: GitBlameInput
): Promise<GitBlameOutput | GitError> {
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.projectId);
  } catch {
    return makeGitError('Failed to resolve project path');
  }

  const args = ['blame', '--porcelain'];

  if (input.line) {
    args.push(`-L${input.line},${input.line}`);
  } else if (input.startLine && input.endLine) {
    args.push(`-L${input.startLine},${input.endLine}`);
  }

  args.push(input.file);

  const result = await execGit(args, resolved.projectPath);

  if (isGitError(result)) {
    return makeGitError(`Failed to blame ${input.file}`, result);
  }

  // Parse porcelain format
  const lines: GitBlameOutput['lines'] = [];
  const chunks = result.stdout.split(/^([a-f0-9]{40})/m).filter(Boolean);

  let currentSha = '';
  let currentAuthor = '';
  let currentDate = '';
  let currentLine = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];

    if (/^[a-f0-9]{40}$/.test(chunk)) {
      currentSha = chunk;
      continue;
    }

    const lineMatch = chunk.match(/(\d+) (\d+)/);
    if (lineMatch) {
      currentLine = parseInt(lineMatch[2], 10);
    }

    const authorMatch = chunk.match(/^author (.+)$/m);
    if (authorMatch) currentAuthor = authorMatch[1];

    const dateMatch = chunk.match(/^author-time (\d+)$/m);
    if (dateMatch) {
      currentDate = new Date(parseInt(dateMatch[1], 10) * 1000).toISOString();
    }

    const contentMatch = chunk.match(/^\t(.*)$/m);
    if (contentMatch && currentSha) {
      lines.push({
        lineNumber: currentLine,
        sha: currentSha.substring(0, 8),
        author: currentAuthor,
        date: currentDate,
        content: contentMatch[1],
      });
    }
  }

  return { lines, file: input.file };
}

// ============================================================================
// Git Tags
// ============================================================================

export async function gitTags(
  input: GitTagsInput
): Promise<GitTagsOutput | GitError> {
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.projectId);
  } catch {
    return makeGitError('Failed to resolve project path');
  }

  const count = input.count || 10;

  // Get tags with dates, sorted by date descending
  const args = [
    'tag', '-l', '--sort=-creatordate',
    `--format=%(refname:short)|%(objectname:short)|%(creatordate:iso)|%(subject)`
  ];

  if (input.pattern) args.push(input.pattern);

  const result = await execGit(args, resolved.projectPath);

  if (isGitError(result)) {
    return makeGitError('Failed to list tags', result);
  }

  const tags = result.stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .slice(0, count)
    .map((line: string) => {
      const [name, sha, date, message] = line.split('|');
      return { name, sha, date: date || undefined, message: message || undefined };
    });

  return { tags };
}

// ============================================================================
// Git Status
// ============================================================================

export async function gitStatus(
  input: GitStatusInput
): Promise<GitStatusOutput | GitError> {
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.projectId);
  } catch {
    return makeGitError('Failed to resolve project path');
  }

  // Get branch and tracking info
  const branchResult = await execGit(['branch', '--show-current'], resolved.projectPath);
  const branch = branchResult.stdout.trim() || 'HEAD';

  // Get ahead/behind
  const trackResult = await execGit(
    ['rev-list', '--left-right', '--count', `@{upstream}...HEAD`],
    resolved.projectPath
  );

  let ahead = 0, behind = 0;
  if (!isGitError(trackResult)) {
    const [b, a] = trackResult.stdout.trim().split('\t').map(Number);
    behind = b || 0;
    ahead = a || 0;
  }

  // Get status counts
  const statusResult = await execGit(['status', '--porcelain'], resolved.projectPath);

  let staged = 0, modified = 0, untracked = 0;
  if (!isGitError(statusResult)) {
    const lines = statusResult.stdout.trim().split('\n').filter(Boolean);
    for (const line of lines) {
      const index = line.charAt(0);
      const worktree = line.charAt(1);

      if (index !== ' ' && index !== '?') staged++;
      if (worktree === 'M' || worktree === 'D') modified++;
      if (index === '?') untracked++;
    }
  }

  return {
    branch,
    ahead,
    behind,
    staged,
    modified,
    untracked,
    hasChanges: staged + modified + untracked > 0,
  };
}

// ============================================================================
// Exports
// ============================================================================

export function isGitErrorResult(result: unknown): result is GitError {
  return typeof result === 'object' && result !== null && 'error' in result;
}
