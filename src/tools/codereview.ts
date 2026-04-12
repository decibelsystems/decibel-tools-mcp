import { log } from '../config.js';
import { resolveProjectPaths, ResolvedProjectPaths } from '../projectRegistry.js';
import { createIssue, CreateIssueInput, Severity, isProjectResolutionError } from './sentinel.js';
import { appendLearning, AppendLearningInput, LearningCategory, isLearningsError } from './learnings.js';

// ============================================================================
// Types
// ============================================================================

export type ReviewType = 'code-review' | 'security-review' | 'pr-review' | 'general';
export type FindingType = 'bug' | 'security' | 'performance' | 'style' | 'architecture' | 'testing' | 'documentation';
export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface CodeReviewFinding {
  type: FindingType;
  severity: FindingSeverity;
  title: string;
  description: string;
  file_path?: string;
  line_range?: { start: number; end: number };
  suggestion?: string;
}

export interface IngestInput {
  projectId?: string;
  review_type: ReviewType;
  raw_output: string;
  source?: {
    pr_number?: string;
    branch?: string;
    commit?: string;
  };
  dry_run?: boolean;
}

export interface IngestOutput {
  findings_parsed: number;
  issues_created: Array<{ id: string; title: string; path: string }>;
  friction_logged: Array<{ id: string; context: string; path: string }>;
  learnings_added: Array<{ title: string; path: string }>;
  skipped: Array<{ title: string; reason: string }>;
}

export interface CodeReviewError {
  error: string;
  message: string;
  hint?: string;
}

export function isCodeReviewError(result: unknown): result is CodeReviewError {
  return (
    typeof result === 'object' &&
    result !== null &&
    'error' in result &&
    'message' in result
  );
}

// ============================================================================
// Severity Mapping
// ============================================================================

function mapSeverity(severity: FindingSeverity): Severity {
  const map: Record<FindingSeverity, Severity> = {
    critical: 'critical',
    high: 'high',
    medium: 'med',
    low: 'low',
    info: 'low',
  };
  return map[severity] || 'med';
}

function inferLearningCategory(finding: CodeReviewFinding): LearningCategory {
  const typeMap: Record<FindingType, LearningCategory> = {
    architecture: 'architecture',
    performance: 'debug',
    security: 'integration',
    testing: 'tooling',
    documentation: 'process',
    bug: 'debug',
    style: 'process',
  };
  return typeMap[finding.type] || 'other';
}

// ============================================================================
// Raw Text Parser
// ============================================================================

export function parseReviewOutput(raw: string, reviewType: ReviewType): CodeReviewFinding[] {
  const findings: CodeReviewFinding[] = [];

  // Split by common section patterns (## headers)
  const sections = raw.split(/(?=^##\s)/m);

  for (const section of sections) {
    // Detect severity from section header or content
    let severity: FindingSeverity = 'medium';
    const severityMatch = section.match(/\b(critical|high|medium|low|info)\b/i);
    if (severityMatch) {
      severity = severityMatch[1].toLowerCase() as FindingSeverity;
    }

    // Detect type from section header
    let type: FindingType = 'bug';
    if (/security|vulnerabilit|injection|xss|csrf|auth/i.test(section)) {
      type = 'security';
    } else if (/performance|slow|optimi|latency|memory/i.test(section)) {
      type = 'performance';
    } else if (/architect|design|pattern|structure/i.test(section)) {
      type = 'architecture';
    } else if (/test|coverage|spec|unit|integration/i.test(section)) {
      type = 'testing';
    } else if (/style|format|lint|naming|convention/i.test(section)) {
      type = 'style';
    } else if (/doc|comment|readme|learning|pattern|insight|recommendation/i.test(section)) {
      type = 'documentation';
    } else if (/bug|issue|error|fix|broken|fail/i.test(section)) {
      type = 'bug';
    }

    // Override type based on review type for better defaults
    if (reviewType === 'security-review' && type === 'bug') {
      type = 'security';
    }

    // Extract bullet points as individual findings
    const bullets = section.match(/^[-*]\s+.+$/gm) || [];

    for (const bullet of bullets) {
      // Extract file path if present
      const fileMatch = bullet.match(/`([^`]+\.[a-z]{1,4}(?::\d+)?)`|(?:in|at|file:?\s*)([^\s,`]+\.[a-z]{1,4})/i);
      let file_path: string | undefined;
      if (fileMatch) {
        file_path = (fileMatch[1] || fileMatch[2]).replace(/:\d+.*$/, '');
      }

      // Extract line number if present
      let line_range: { start: number; end: number } | undefined;
      const lineMatch = bullet.match(/:(\d+)(?:-(\d+))?|line[s]?\s+(\d+)(?:\s*-\s*(\d+))?/i);
      if (lineMatch) {
        const start = parseInt(lineMatch[1] || lineMatch[3], 10);
        const end = lineMatch[2] || lineMatch[4] ? parseInt(lineMatch[2] || lineMatch[4], 10) : start;
        line_range = { start, end };
      }

      // Check for inline severity markers
      const inlineSeverityMatch = bullet.match(/\*\*(critical|high|medium|low|info)\*\*|\[(critical|high|medium|low|info)\]/i);
      if (inlineSeverityMatch) {
        severity = (inlineSeverityMatch[1] || inlineSeverityMatch[2]).toLowerCase() as FindingSeverity;
      }

      // Clean up title - remove markdown formatting, file paths, etc.
      let title = bullet
        .replace(/^[-*]\s+/, '')
        .replace(/\*\*[^*]+\*\*/g, match => match.replace(/\*\*/g, ''))
        .replace(/`[^`]+`/g, '')
        .replace(/\s+/g, ' ')
        .trim();

      // Truncate long titles
      if (title.length > 100) {
        title = title.slice(0, 97) + '...';
      }

      // Skip very short or empty items
      if (title.length < 10) continue;

      // Route soft suggestions to learnings, but keep actionable items as issues
      // "Consider adding error handling" → learning
      // "Missing null check causes crash" → issue (even if starts with soft language)
      const isSoftSuggestion = /^consider|^you might|^it would be|^perhaps|^maybe/i.test(title);
      const isActionableIssue = /crash|bug|error|fail|broken|vulnerab|inject|leak|missing.*check|null.*check|undefined/i.test(title);

      if (isSoftSuggestion && !isActionableIssue) {
        // Soft suggestion without actionable keywords → learning
        findings.push({
          type: 'documentation',
          severity: 'info',
          title,
          description: bullet,
          file_path,
          line_range,
        });
        continue;
      }

      findings.push({
        type,
        severity,
        title,
        description: bullet,
        file_path,
        line_range,
      });
    }
  }

  // Also look for explicit learning/pattern/insight mentions
  const learningPatterns = [
    /(?:learning|lesson|insight|takeaway|key point):\s*(.+)/gi,
    /(?:pattern|best practice|recommendation):\s*(.+)/gi,
  ];

  for (const pattern of learningPatterns) {
    let match;
    while ((match = pattern.exec(raw)) !== null) {
      const title = match[1].trim().slice(0, 100);
      if (title.length >= 10) {
        const exists = findings.some(f => f.title === title);
        if (!exists) {
          findings.push({
            type: 'documentation',
            severity: 'info',
            title,
            description: match[0],
          });
        }
      }
    }
  }

  return findings;
}

// ============================================================================
// Format Issue Details
// ============================================================================

function formatIssueDetails(finding: CodeReviewFinding, source?: IngestInput['source']): string {
  let details = finding.description;

  if (finding.file_path) {
    details += `\n\n**File:** \`${finding.file_path}\``;
    if (finding.line_range) {
      if (finding.line_range.start === finding.line_range.end) {
        details += `:${finding.line_range.start}`;
      } else {
        details += `:${finding.line_range.start}-${finding.line_range.end}`;
      }
    }
  }

  if (finding.suggestion) {
    details += `\n\n**Suggestion:** ${finding.suggestion}`;
  }

  if (source) {
    const sourceInfo: string[] = [];
    if (source.pr_number) sourceInfo.push(`PR #${source.pr_number}`);
    if (source.branch) sourceInfo.push(`branch: ${source.branch}`);
    if (source.commit) sourceInfo.push(`commit: ${source.commit.slice(0, 8)}`);
    if (sourceInfo.length > 0) {
      details += `\n\n**Source:** ${sourceInfo.join(', ')}`;
    }
  }

  details += '\n\n*Created from code review via codereview_ingest*';

  return details;
}

// ============================================================================
// Main Ingest Function
// ============================================================================

export async function ingestCodeReview(
  input: IngestInput
): Promise<IngestOutput | CodeReviewError> {
  // Validate project exists first
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.projectId);
  } catch {
    return {
      error: 'PROJECT_NOT_FOUND',
      message: 'Cannot ingest code review: No project context available.',
      hint: 'Specify projectId parameter, set DECIBEL_PROJECT_ROOT env var, or run from a directory with .decibel/',
    };
  }

  // Parse the raw output
  const findings = parseReviewOutput(input.raw_output, input.review_type);

  const result: IngestOutput = {
    findings_parsed: findings.length,
    issues_created: [],
    friction_logged: [],
    learnings_added: [],
    skipped: [],
  };

  log(`CodeReview: Parsed ${findings.length} findings from ${input.review_type} review`);

  for (const finding of findings) {
    const isIssueable = ['bug', 'security', 'performance', 'architecture', 'testing'].includes(finding.type);
    const isLearning = finding.type === 'documentation' || finding.severity === 'info';

    if (isIssueable && !isLearning) {
      if (input.dry_run) {
        result.issues_created.push({
          id: 'DRY-RUN',
          title: finding.title,
          path: `[dry-run] .decibel/sentinel/issues/...`,
        });
      } else {
        const issueInput: CreateIssueInput = {
          projectId: input.projectId,
          severity: mapSeverity(finding.severity),
          title: `[${input.review_type}] ${finding.title}`,
          details: formatIssueDetails(finding, input.source),
        };

        const issueResult = await createIssue(issueInput);

        if (isProjectResolutionError(issueResult)) {
          result.skipped.push({
            title: finding.title,
            reason: 'Project resolution error',
          });
        } else if ('error' in issueResult) {
          result.skipped.push({
            title: finding.title,
            reason: issueResult.message,
          });
        } else {
          result.issues_created.push({
            id: issueResult.id,
            title: finding.title,
            path: issueResult.path,
          });
        }
      }
    } else if (isLearning) {
      if (input.dry_run) {
        result.learnings_added.push({
          title: finding.title,
          path: `[dry-run] .decibel/oracle/learnings/learnings.md`,
        });
      } else {
        const learningInput: AppendLearningInput = {
          projectId: input.projectId,
          category: inferLearningCategory(finding),
          title: finding.title,
          content: finding.description,
          tags: ['code-review', input.review_type],
        };

        const learningResult = await appendLearning(learningInput);

        if (isLearningsError(learningResult)) {
          result.skipped.push({
            title: finding.title,
            reason: learningResult.message,
          });
        } else {
          result.learnings_added.push({
            title: finding.title,
            path: learningResult.path,
          });
        }
      }
    } else {
      result.skipped.push({
        title: finding.title,
        reason: `Type '${finding.type}' with severity '${finding.severity}' not auto-created`,
      });
    }
  }

  log(`CodeReview: Created ${result.issues_created.length} issues, ${result.learnings_added.length} learnings, skipped ${result.skipped.length}`);

  return result;
}
