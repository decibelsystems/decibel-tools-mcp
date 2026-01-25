// ============================================================================
// Git-Sentinel Integration Tools
// ============================================================================
// Tools for linking git history to Decibel artifacts.
// These are METADATA operations - they update .decibel files, not git.
// ============================================================================

import fs from 'fs/promises';
import path from 'path';
import YAML from 'yaml';
import { resolveProjectPaths, ResolvedProjectPaths } from '../projectRegistry.js';
import { gitLogRecent, isGitErrorResult } from './git.js';

// ============================================================================
// Types
// ============================================================================

export interface LinkedCommit {
  sha: string;
  shortSha: string;
  message: string;
  relationship: 'fixes' | 'closes' | 'related' | 'reverts' | 'breaks' | 'implements';
  linked_at: string;
  linked_by?: string;
}

export interface SentinelLinkCommitInput {
  projectId?: string;
  artifactId: string;         // ISS-0042, EPIC-0015, etc.
  commitSha: string;          // Full or short SHA
  relationship?: LinkedCommit['relationship'];  // Default: 'related'
}

export interface SentinelLinkCommitOutput {
  artifactId: string;
  artifactPath: string;
  commit: LinkedCommit;
  totalLinkedCommits: number;
}

export interface SentinelGetCommitsInput {
  projectId?: string;
  artifactId: string;
}

export interface SentinelGetCommitsOutput {
  artifactId: string;
  commits: LinkedCommit[];
}

export interface GitFindIssueInput {
  projectId?: string;
  commitSha: string;
}

export interface GitFindIssueOutput {
  commitSha: string;
  linkedArtifacts: Array<{
    id: string;
    type: 'issue' | 'epic';
    title: string;
    relationship: string;
  }>;
}

export interface LinkError {
  error: string;
  details?: string;
}

// Auto-link types
export interface ParsedReference {
  artifactId: string;
  relationship: LinkedCommit['relationship'];
}

export interface AutoLinkInput {
  projectId?: string;
  commitSha?: string;  // If not provided, uses HEAD
}

export interface AutoLinkOutput {
  commitSha: string;
  commitMessage: string;
  referencesFound: ParsedReference[];
  linked: Array<{
    artifactId: string;
    relationship: string;
    status: 'linked' | 'already_linked' | 'not_found';
  }>;
}

// ============================================================================
// Helpers
// ============================================================================

function makeError(message: string, details?: string): LinkError {
  return { error: message, details };
}

async function findArtifactFile(
  resolved: ResolvedProjectPaths,
  artifactId: string
): Promise<{ path: string; type: 'issue' | 'epic' } | null> {
  const id = artifactId.toUpperCase();
  
  // Check issues
  const issuesDir = resolved.subPath('sentinel', 'issues');
  try {
    const issueFiles = await fs.readdir(issuesDir);
    const issueFile = issueFiles.find(f => f.toUpperCase().startsWith(id));
    if (issueFile) {
      return { path: path.join(issuesDir, issueFile), type: 'issue' };
    }
  } catch { /* dir doesn't exist */ }
  
  // Check epics
  const epicsDir = resolved.subPath('sentinel', 'epics');
  try {
    const epicFiles = await fs.readdir(epicsDir);
    const epicFile = epicFiles.find(f => f.toUpperCase().startsWith(id));
    if (epicFile) {
      return { path: path.join(epicsDir, epicFile), type: 'epic' };
    }
  } catch { /* dir doesn't exist */ }
  
  return null;
}

async function getCommitInfo(
  projectId: string | undefined,
  sha: string
): Promise<{ sha: string; shortSha: string; message: string } | null> {
  const logResult = await gitLogRecent({ projectId, count: 100 });
  
  if (isGitErrorResult(logResult)) {
    return null;
  }
  
  const commit = logResult.commits.find(
    c => c.sha.startsWith(sha) || c.shortSha === sha
  );
  
  return commit || null;
}

// ============================================================================
// sentinel_link_commit
// ============================================================================

export async function sentinelLinkCommit(
  input: SentinelLinkCommitInput
): Promise<SentinelLinkCommitOutput | LinkError> {
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.projectId);
  } catch {
    return makeError('Failed to resolve project path');
  }

  // Find the artifact file
  const artifact = await findArtifactFile(resolved, input.artifactId);
  if (!artifact) {
    return makeError(
      `Artifact not found: ${input.artifactId}`,
      'Check that the issue or epic ID is correct'
    );
  }

  // Get commit info
  const commitInfo = await getCommitInfo(input.projectId, input.commitSha);
  if (!commitInfo) {
    return makeError(
      `Commit not found: ${input.commitSha}`,
      'Verify the commit SHA exists in this repository'
    );
  }

  // Read current artifact
  const content = await fs.readFile(artifact.path, 'utf-8');
  
  // Parse YAML (handle frontmatter format)
  let data: Record<string, unknown>;
  let prefix = '';
  let suffix = '';
  
  if (content.startsWith('---')) {
    const parts = content.split('---');
    if (parts.length >= 3) {
      prefix = '---\n';
      data = YAML.parse(parts[1]) || {};
      suffix = '\n---' + parts.slice(2).join('---');
    } else {
      data = YAML.parse(content) || {};
    }
  } else {
    data = YAML.parse(content) || {};
  }

  // Create linked commit entry
  const linkedCommit: LinkedCommit = {
    sha: commitInfo.sha,
    shortSha: commitInfo.shortSha,
    message: commitInfo.message,
    relationship: input.relationship || 'related',
    linked_at: new Date().toISOString(),
    linked_by: 'ai:claude',
  };

  // Add to linked_commits array
  const existingCommits = (data.linked_commits as LinkedCommit[]) || [];
  
  // Check for duplicate
  if (existingCommits.some(c => c.sha === linkedCommit.sha)) {
    return makeError(
      'Commit already linked',
      `${input.commitSha} is already linked to ${input.artifactId}`
    );
  }

  existingCommits.push(linkedCommit);
  data.linked_commits = existingCommits;
  data.updated_at = new Date().toISOString();

  // Write back
  const newContent = prefix + YAML.stringify(data) + suffix;
  await fs.writeFile(artifact.path, newContent, 'utf-8');

  return {
    artifactId: input.artifactId,
    artifactPath: artifact.path,
    commit: linkedCommit,
    totalLinkedCommits: existingCommits.length,
  };
}

// ============================================================================
// sentinel_get_linked_commits
// ============================================================================

export async function sentinelGetLinkedCommits(
  input: SentinelGetCommitsInput
): Promise<SentinelGetCommitsOutput | LinkError> {
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.projectId);
  } catch {
    return makeError('Failed to resolve project path');
  }

  const artifact = await findArtifactFile(resolved, input.artifactId);
  if (!artifact) {
    return makeError(`Artifact not found: ${input.artifactId}`);
  }

  const content = await fs.readFile(artifact.path, 'utf-8');
  
  // Parse YAML
  let data: Record<string, unknown>;
  if (content.startsWith('---')) {
    const parts = content.split('---');
    data = parts.length >= 3 ? YAML.parse(parts[1]) || {} : YAML.parse(content) || {};
  } else {
    data = YAML.parse(content) || {};
  }

  const commits = (data.linked_commits as LinkedCommit[]) || [];

  return {
    artifactId: input.artifactId,
    commits,
  };
}

// ============================================================================
// git_find_linked_issues
// ============================================================================

export async function gitFindLinkedIssues(
  input: GitFindIssueInput
): Promise<GitFindIssueOutput | LinkError> {
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.projectId);
  } catch {
    return makeError('Failed to resolve project path');
  }

  const linkedArtifacts: GitFindIssueOutput['linkedArtifacts'] = [];

  // Scan issues
  const issuesDir = resolved.subPath('sentinel', 'issues');
  try {
    const issueFiles = await fs.readdir(issuesDir);
    for (const file of issueFiles) {
      if (!file.endsWith('.yml') && !file.endsWith('.yaml') && !file.endsWith('.md')) continue;
      
      const content = await fs.readFile(path.join(issuesDir, file), 'utf-8');
      
      // Quick check before parsing
      if (!content.includes(input.commitSha)) continue;
      
      // Parse and check linked_commits
      let data: Record<string, unknown>;
      if (content.startsWith('---')) {
        const parts = content.split('---');
        data = parts.length >= 3 ? YAML.parse(parts[1]) || {} : {};
      } else {
        data = YAML.parse(content) || {};
      }
      
      const commits = (data.linked_commits as LinkedCommit[]) || [];
      const match = commits.find(c => c.sha.startsWith(input.commitSha) || c.shortSha === input.commitSha);
      
      if (match) {
        linkedArtifacts.push({
          id: data.id as string,
          type: 'issue',
          title: data.title as string,
          relationship: match.relationship,
        });
      }
    }
  } catch { /* dir doesn't exist */ }

  // Scan epics
  const epicsDir = resolved.subPath('sentinel', 'epics');
  try {
    const epicFiles = await fs.readdir(epicsDir);
    for (const file of epicFiles) {
      if (!file.endsWith('.yml') && !file.endsWith('.yaml') && !file.endsWith('.md')) continue;
      
      const content = await fs.readFile(path.join(epicsDir, file), 'utf-8');
      if (!content.includes(input.commitSha)) continue;
      
      let data: Record<string, unknown>;
      if (content.startsWith('---')) {
        const parts = content.split('---');
        data = parts.length >= 3 ? YAML.parse(parts[1]) || {} : {};
      } else {
        data = YAML.parse(content) || {};
      }
      
      const commits = (data.linked_commits as LinkedCommit[]) || [];
      const match = commits.find(c => c.sha.startsWith(input.commitSha) || c.shortSha === input.commitSha);
      
      if (match) {
        linkedArtifacts.push({
          id: data.id as string,
          type: 'epic',
          title: data.title as string,
          relationship: match.relationship,
        });
      }
    }
  } catch { /* dir doesn't exist */ }

  return {
    commitSha: input.commitSha,
    linkedArtifacts,
  };
}

// ============================================================================
// parseCommitMessage - Extract issue/epic references from commit message
// ============================================================================

/**
 * Parse commit message for issue/epic references.
 * Supports patterns:
 *   - ISS-0042, EPIC-0001 (standalone references -> 'related')
 *   - fixes ISS-0042, closes EPIC-0001 (action + reference)
 *   - fix: ISS-0042, close: EPIC-0001 (conventional commit style)
 *   - implements EPIC-0001, reverts ISS-0042
 */
export function parseCommitMessage(message: string): ParsedReference[] {
  const refs: ParsedReference[] = [];
  const seen = new Set<string>();

  // Pattern: action + artifact (fixes ISS-0042, closes EPIC-0001, etc.)
  const actionPatterns: Array<{ pattern: RegExp; relationship: LinkedCommit['relationship'] }> = [
    { pattern: /(?:fix(?:es|ed)?|fixing)[:\s]+((iss|epic|issue)-?\d+)/gi, relationship: 'fixes' },
    { pattern: /(?:close[sd]?|closing)[:\s]+((iss|epic|issue)-?\d+)/gi, relationship: 'closes' },
    { pattern: /(?:implement[sd]?|implementing)[:\s]+((iss|epic|issue)-?\d+)/gi, relationship: 'implements' },
    { pattern: /(?:revert[sd]?|reverting)[:\s]+((iss|epic|issue)-?\d+)/gi, relationship: 'reverts' },
    { pattern: /(?:break[sd]?|breaking)[:\s]+((iss|epic|issue)-?\d+)/gi, relationship: 'breaks' },
  ];

  for (const { pattern, relationship } of actionPatterns) {
    let match;
    while ((match = pattern.exec(message)) !== null) {
      const artifactId = normalizeArtifactId(match[1]);
      if (!seen.has(artifactId)) {
        seen.add(artifactId);
        refs.push({ artifactId, relationship });
      }
    }
  }

  // Pattern: standalone artifact references (ISS-0042, EPIC-0001)
  // Only add as 'related' if not already captured with a specific relationship
  const standalonePattern = /\b(iss(?:ue)?-?\d+|epic-?\d+)\b/gi;
  let match;
  while ((match = standalonePattern.exec(message)) !== null) {
    const artifactId = normalizeArtifactId(match[1]);
    if (!seen.has(artifactId)) {
      seen.add(artifactId);
      refs.push({ artifactId, relationship: 'related' });
    }
  }

  return refs;
}

/**
 * Normalize artifact ID to standard format (ISS-0042, EPIC-0001)
 */
function normalizeArtifactId(raw: string): string {
  const upper = raw.toUpperCase();

  // Handle ISSUE -> ISS
  if (upper.startsWith('ISSUE')) {
    const num = upper.replace(/[^0-9]/g, '');
    return `ISS-${num.padStart(4, '0')}`;
  }

  // Handle ISS0042 -> ISS-0042
  if (upper.startsWith('ISS') && !upper.includes('-')) {
    const num = upper.replace(/[^0-9]/g, '');
    return `ISS-${num.padStart(4, '0')}`;
  }

  // Handle EPIC0001 -> EPIC-0001
  if (upper.startsWith('EPIC') && !upper.includes('-')) {
    const num = upper.replace(/[^0-9]/g, '');
    return `EPIC-${num.padStart(4, '0')}`;
  }

  // Already normalized
  return upper;
}

// ============================================================================
// autoLinkCommit - Auto-link commit to referenced issues/epics
// ============================================================================

export async function autoLinkCommit(
  input: AutoLinkInput
): Promise<AutoLinkOutput | LinkError> {
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.projectId);
  } catch {
    return makeError('Failed to resolve project path');
  }

  // Get commit info (HEAD if not specified)
  const logResult = await gitLogRecent({ projectId: input.projectId, count: 1 });

  if (isGitErrorResult(logResult) || logResult.commits.length === 0) {
    return makeError('Failed to get commit info');
  }

  // If SHA specified, find it; otherwise use HEAD (first commit)
  let commit = logResult.commits[0];
  if (input.commitSha) {
    const fullLog = await gitLogRecent({ projectId: input.projectId, count: 100 });
    if (!isGitErrorResult(fullLog)) {
      const found = fullLog.commits.find(
        c => c.sha.startsWith(input.commitSha!) || c.shortSha === input.commitSha
      );
      if (found) commit = found;
    }
  }

  // Parse commit message for references
  const refs = parseCommitMessage(commit.message);

  if (refs.length === 0) {
    return {
      commitSha: commit.sha,
      commitMessage: commit.message,
      referencesFound: [],
      linked: [],
    };
  }

  // Try to link each reference
  const linked: AutoLinkOutput['linked'] = [];

  for (const ref of refs) {
    const artifact = await findArtifactFile(resolved, ref.artifactId);

    if (!artifact) {
      linked.push({
        artifactId: ref.artifactId,
        relationship: ref.relationship,
        status: 'not_found',
      });
      continue;
    }

    // Try to link
    const linkResult = await sentinelLinkCommit({
      projectId: input.projectId,
      artifactId: ref.artifactId,
      commitSha: commit.sha,
      relationship: ref.relationship,
    });

    if (isLinkError(linkResult)) {
      if (linkResult.error === 'Commit already linked') {
        linked.push({
          artifactId: ref.artifactId,
          relationship: ref.relationship,
          status: 'already_linked',
        });
      } else {
        linked.push({
          artifactId: ref.artifactId,
          relationship: ref.relationship,
          status: 'not_found',
        });
      }
    } else {
      linked.push({
        artifactId: ref.artifactId,
        relationship: ref.relationship,
        status: 'linked',
      });
    }
  }

  return {
    commitSha: commit.sha,
    commitMessage: commit.message,
    referencesFound: refs,
    linked,
  };
}

// ============================================================================
// Exports
// ============================================================================

export function isLinkError(result: unknown): result is LinkError {
  return typeof result === 'object' && result !== null && 'error' in result;
}
