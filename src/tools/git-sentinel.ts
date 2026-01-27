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
// Exports
// ============================================================================

export function isLinkError(result: unknown): result is LinkError {
  return typeof result === 'object' && result !== null && 'error' in result;
}
