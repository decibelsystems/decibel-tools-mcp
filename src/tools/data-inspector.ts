import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import { log } from '../config.js';
import { resolveProjectPaths } from '../projectRegistry.js';

// ============================================================================
// Types - Data Models
// ============================================================================

// Issue Schema
export type InspectorIssueStatus = 'open' | 'in_progress' | 'done' | 'blocked';
export type InspectorPriority = 'low' | 'medium' | 'high';

export interface InspectorIssue {
  id: string;
  title: string;
  project?: string;
  status: InspectorIssueStatus;
  priority: InspectorPriority;
  epic_id?: string;
  tags?: string[];
  created_at?: string;
  updated_at?: string;
  _file?: string; // internal: source file path
}

// Epic Schema
export type InspectorEpicStatus = 'open' | 'in_progress' | 'done' | 'blocked';

export interface InspectorEpic {
  id: string;
  title: string;
  project?: string;
  status: InspectorEpicStatus;
  owner?: string;
  tags?: string[];
  created_at?: string;
  updated_at?: string;
  _file?: string; // internal: source file path
}

// ADR Schema
export type InspectorADRScope = 'project' | 'global';
export type InspectorADRStatus = 'proposed' | 'accepted' | 'superseded' | 'deprecated';

export interface InspectorADR {
  id: string;
  scope?: InspectorADRScope;
  project?: string;
  title: string;
  status: InspectorADRStatus;
  related_issues?: string[];
  related_epics?: string[];
  created_at?: string;
  updated_at?: string;
  _file?: string; // internal: source file path
}

// ============================================================================
// Types - Validation & Reports
// ============================================================================

export type ValidationSeverity = 'error' | 'warn';

export interface ValidationError {
  severity: ValidationSeverity;
  type: 'issue' | 'epic' | 'adr';
  id: string;
  file?: string;
  field?: string;
  message: string;
}

export interface OrphanReport {
  epicsWithNoIssues: Array<{ id: string; title: string }>;
  issuesWithMissingEpic: Array<{ id: string; title: string; epic_id: string }>;
  adrsWithMissingIssues: Array<{ id: string; title: string; missing: string[] }>;
  adrsWithMissingEpics: Array<{ id: string; title: string; missing: string[] }>;
}

export interface StaleReport {
  issues: Array<{ id: string; title: string; updated_at: string }>;
  epics: Array<{ id: string; title: string; updated_at: string }>;
  adrs: Array<{ id: string; title: string; updated_at: string }>;
}

export interface DataIndex {
  issues: InspectorIssue[];
  epics: InspectorEpic[];
  adrs: InspectorADR[];
  decibelRoot: string;
  projectName: string;
}

export interface ScanSummary {
  issues: {
    total: number;
    open: number;
    in_progress: number;
    done: number;
    blocked: number;
  };
  epics: {
    total: number;
    open: number;
    in_progress: number;
    done: number;
    blocked: number;
  };
  adrs: {
    total: number;
    proposed: number;
    accepted: number;
    superseded: number;
    deprecated: number;
  };
}

// ============================================================================
// Types - Scan Input/Output
// ============================================================================

export type ScanScope = 'runtime' | 'data' | 'all';
export type FlagCategory = 'orphans' | 'stale' | 'invalid';

export interface ScanDataInput {
  projectId?: string;
  scope: ScanScope;
  validate?: boolean;
  flag?: FlagCategory[];
  days?: number;
}

export interface ScanDataOutput {
  scope: ScanScope;
  projectName: string;
  decibelRoot?: string;
  summary?: ScanSummary;
  validation?: ValidationError[];
  orphans?: OrphanReport;
  stale?: StaleReport;
  error?: string;
}

// ============================================================================
// Path Resolution
// ============================================================================

/**
 * Find the .decibel root directory by walking up from the start path
 */
export function findDecibelRoot(start?: string): string | undefined {
  const startPath = start || process.env.DECIBEL_PROJECT_ROOT || process.cwd();
  let current = path.resolve(startPath);

  while (true) {
    const candidate = path.join(current, '.decibel');
    if (fsSync.existsSync(candidate) && fsSync.statSync(candidate).isDirectory()) {
      return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

/**
 * Get the project name from the .decibel root's parent directory
 */
export function getProjectNameFromRoot(decibelRoot: string): string {
  const projectDir = path.dirname(decibelRoot);
  return path.basename(projectDir);
}

/**
 * Get global data root (DECIBEL_MCP_ROOT or ~/.decibel)
 */
export function getGlobalRoot(): string {
  return process.env.DECIBEL_MCP_ROOT || path.join(os.homedir(), '.decibel');
}

// ============================================================================
// YAML Parsing
// ============================================================================

/**
 * Parse simple YAML content (single-level key-value with array support)
 * This is a lightweight parser for our specific schema needs
 */
function parseSimpleYaml(content: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) continue;

    const colonIndex = trimmed.indexOf(':');
    if (colonIndex <= 0) continue;

    const key = trimmed.slice(0, colonIndex).trim();
    let value: string = trimmed.slice(colonIndex + 1).trim();

    // Handle arrays: [item1, item2]
    if (value.startsWith('[') && value.endsWith(']')) {
      const inner = value.slice(1, -1);
      result[key] = inner
        .split(',')
        .map(s => s.trim())
        .filter(s => s.length > 0);
    } else if (value === '' || value === '~' || value === 'null') {
      result[key] = undefined;
    } else if (value === 'true') {
      result[key] = true;
    } else if (value === 'false') {
      result[key] = false;
    } else {
      // Remove quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      result[key] = value;
    }
  }

  return result;
}

// ============================================================================
// Data Loaders
// ============================================================================

/**
 * Load all issues from the .decibel/sentinel/issues directory
 */
export async function loadIssues(decibelRoot: string): Promise<InspectorIssue[]> {
  const issuesDir = path.join(decibelRoot, 'sentinel', 'issues');
  const issues: InspectorIssue[] = [];

  try {
    const files = await fs.readdir(issuesDir);
    for (const file of files) {
      if (!file.endsWith('.yml') && !file.endsWith('.yaml')) continue;

      const filePath = path.join(issuesDir, file);
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const parsed = parseSimpleYaml(content);

        const issue: InspectorIssue = {
          id: (parsed.id as string) || file.replace(/\.ya?ml$/, ''),
          title: (parsed.title as string) || '',
          project: parsed.project as string | undefined,
          status: (parsed.status as InspectorIssueStatus) || 'open',
          priority: (parsed.priority as InspectorPriority) || 'medium',
          epic_id: parsed.epic_id as string | undefined,
          tags: parsed.tags as string[] | undefined,
          created_at: parsed.created_at as string | undefined,
          updated_at: parsed.updated_at as string | undefined,
          _file: filePath,
        };

        issues.push(issue);
      } catch (err) {
        log(`Data Inspector: Failed to parse issue file ${file}: ${err}`);
      }
    }
  } catch {
    // Directory doesn't exist, return empty array
  }

  return issues;
}

/**
 * Load all epics from the .decibel/sentinel/epics directory
 */
export async function loadEpics(decibelRoot: string): Promise<InspectorEpic[]> {
  const epicsDir = path.join(decibelRoot, 'sentinel', 'epics');
  const epics: InspectorEpic[] = [];

  try {
    const files = await fs.readdir(epicsDir);
    for (const file of files) {
      if (!file.endsWith('.yml') && !file.endsWith('.yaml')) continue;

      const filePath = path.join(epicsDir, file);
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const parsed = parseSimpleYaml(content);

        const epic: InspectorEpic = {
          id: (parsed.id as string) || file.replace(/\.ya?ml$/, ''),
          title: (parsed.title as string) || '',
          project: parsed.project as string | undefined,
          status: (parsed.status as InspectorEpicStatus) || 'open',
          owner: parsed.owner as string | undefined,
          tags: parsed.tags as string[] | undefined,
          created_at: parsed.created_at as string | undefined,
          updated_at: parsed.updated_at as string | undefined,
          _file: filePath,
        };

        epics.push(epic);
      } catch (err) {
        log(`Data Inspector: Failed to parse epic file ${file}: ${err}`);
      }
    }
  } catch {
    // Directory doesn't exist, return empty array
  }

  return epics;
}

/**
 * Load all ADRs from the .decibel/architect/adrs directory
 */
export async function loadADRs(decibelRoot: string): Promise<InspectorADR[]> {
  const adrsDir = path.join(decibelRoot, 'architect', 'adrs');
  const adrs: InspectorADR[] = [];

  try {
    const files = await fs.readdir(adrsDir);
    for (const file of files) {
      if (!file.endsWith('.yml') && !file.endsWith('.yaml')) continue;

      const filePath = path.join(adrsDir, file);
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const parsed = parseSimpleYaml(content);

        const adr: InspectorADR = {
          id: (parsed.id as string) || file.replace(/\.ya?ml$/, ''),
          scope: parsed.scope as InspectorADRScope | undefined,
          project: parsed.project as string | undefined,
          title: (parsed.title as string) || '',
          status: (parsed.status as InspectorADRStatus) || 'proposed',
          related_issues: parsed.related_issues as string[] | undefined,
          related_epics: parsed.related_epics as string[] | undefined,
          created_at: parsed.created_at as string | undefined,
          updated_at: parsed.updated_at as string | undefined,
          _file: filePath,
        };

        adrs.push(adr);
      } catch (err) {
        log(`Data Inspector: Failed to parse ADR file ${file}: ${err}`);
      }
    }
  } catch {
    // Directory doesn't exist, return empty array
  }

  return adrs;
}

/**
 * Load all data into a DataIndex
 */
export async function loadDataIndex(decibelRoot: string): Promise<DataIndex> {
  const [issues, epics, adrs] = await Promise.all([
    loadIssues(decibelRoot),
    loadEpics(decibelRoot),
    loadADRs(decibelRoot),
  ]);

  return {
    issues,
    epics,
    adrs,
    decibelRoot,
    projectName: getProjectNameFromRoot(decibelRoot),
  };
}

// ============================================================================
// Validation
// ============================================================================

const VALID_ISSUE_STATUSES: InspectorIssueStatus[] = ['open', 'in_progress', 'done', 'blocked'];
const VALID_PRIORITIES: InspectorPriority[] = ['low', 'medium', 'high'];
const VALID_EPIC_STATUSES: InspectorEpicStatus[] = ['open', 'in_progress', 'done', 'blocked'];
const VALID_ADR_STATUSES: InspectorADRStatus[] = ['proposed', 'accepted', 'superseded', 'deprecated'];
const VALID_ADR_SCOPES: InspectorADRScope[] = ['project', 'global'];

/**
 * Validate all data and return validation errors
 */
export function validateSchema(
  issues: InspectorIssue[],
  epics: InspectorEpic[],
  adrs: InspectorADR[]
): ValidationError[] {
  const errors: ValidationError[] = [];

  // Validate issues
  for (const issue of issues) {
    if (!issue.id) {
      errors.push({
        severity: 'error',
        type: 'issue',
        id: issue._file || 'unknown',
        file: issue._file,
        field: 'id',
        message: 'Missing required field: id',
      });
    }

    if (!issue.title) {
      errors.push({
        severity: 'warn',
        type: 'issue',
        id: issue.id || issue._file || 'unknown',
        file: issue._file,
        field: 'title',
        message: 'Missing field: title',
      });
    }

    if (issue.status && !VALID_ISSUE_STATUSES.includes(issue.status)) {
      errors.push({
        severity: 'warn',
        type: 'issue',
        id: issue.id,
        file: issue._file,
        field: 'status',
        message: `Invalid status '${issue.status}'. Must be one of: ${VALID_ISSUE_STATUSES.join(', ')}`,
      });
    }

    if (issue.priority && !VALID_PRIORITIES.includes(issue.priority)) {
      errors.push({
        severity: 'warn',
        type: 'issue',
        id: issue.id,
        file: issue._file,
        field: 'priority',
        message: `Invalid priority '${issue.priority}'. Must be one of: ${VALID_PRIORITIES.join(', ')}`,
      });
    }
  }

  // Validate epics
  for (const epic of epics) {
    if (!epic.id) {
      errors.push({
        severity: 'error',
        type: 'epic',
        id: epic._file || 'unknown',
        file: epic._file,
        field: 'id',
        message: 'Missing required field: id',
      });
    }

    if (!epic.title) {
      errors.push({
        severity: 'warn',
        type: 'epic',
        id: epic.id || epic._file || 'unknown',
        file: epic._file,
        field: 'title',
        message: 'Missing field: title',
      });
    }

    if (epic.status && !VALID_EPIC_STATUSES.includes(epic.status)) {
      errors.push({
        severity: 'warn',
        type: 'epic',
        id: epic.id,
        file: epic._file,
        field: 'status',
        message: `Invalid status '${epic.status}'. Must be one of: ${VALID_EPIC_STATUSES.join(', ')}`,
      });
    }
  }

  // Validate ADRs
  for (const adr of adrs) {
    if (!adr.id) {
      errors.push({
        severity: 'error',
        type: 'adr',
        id: adr._file || 'unknown',
        file: adr._file,
        field: 'id',
        message: 'Missing required field: id',
      });
    }

    if (!adr.title) {
      errors.push({
        severity: 'warn',
        type: 'adr',
        id: adr.id || adr._file || 'unknown',
        file: adr._file,
        field: 'title',
        message: 'Missing field: title',
      });
    }

    if (adr.status && !VALID_ADR_STATUSES.includes(adr.status)) {
      errors.push({
        severity: 'warn',
        type: 'adr',
        id: adr.id,
        file: adr._file,
        field: 'status',
        message: `Invalid status '${adr.status}'. Must be one of: ${VALID_ADR_STATUSES.join(', ')}`,
      });
    }

    if (adr.scope && !VALID_ADR_SCOPES.includes(adr.scope)) {
      errors.push({
        severity: 'warn',
        type: 'adr',
        id: adr.id,
        file: adr._file,
        field: 'scope',
        message: `Invalid scope '${adr.scope}'. Must be one of: ${VALID_ADR_SCOPES.join(', ')}`,
      });
    }
  }

  return errors;
}

// ============================================================================
// Orphan Detection
// ============================================================================

/**
 * Find orphaned records (broken references)
 */
export function findOrphans(
  issues: InspectorIssue[],
  epics: InspectorEpic[],
  adrs: InspectorADR[]
): OrphanReport {
  const issueIds = new Set(issues.map(i => i.id));
  const epicIds = new Set(epics.map(e => e.id));

  // Find epics with no issues
  const issuesByEpic = new Map<string, number>();
  for (const issue of issues) {
    if (issue.epic_id) {
      issuesByEpic.set(issue.epic_id, (issuesByEpic.get(issue.epic_id) || 0) + 1);
    }
  }

  const epicsWithNoIssues = epics
    .filter(epic => !issuesByEpic.has(epic.id))
    .map(epic => ({ id: epic.id, title: epic.title }));

  // Find issues with missing epics
  const issuesWithMissingEpic = issues
    .filter(issue => issue.epic_id && !epicIds.has(issue.epic_id))
    .map(issue => ({
      id: issue.id,
      title: issue.title,
      epic_id: issue.epic_id!,
    }));

  // Find ADRs with missing issues
  const adrsWithMissingIssues: Array<{ id: string; title: string; missing: string[] }> = [];
  for (const adr of adrs) {
    if (adr.related_issues && adr.related_issues.length > 0) {
      const missing = adr.related_issues.filter(issueId => !issueIds.has(issueId));
      if (missing.length > 0) {
        adrsWithMissingIssues.push({ id: adr.id, title: adr.title, missing });
      }
    }
  }

  // Find ADRs with missing epics
  const adrsWithMissingEpics: Array<{ id: string; title: string; missing: string[] }> = [];
  for (const adr of adrs) {
    if (adr.related_epics && adr.related_epics.length > 0) {
      const missing = adr.related_epics.filter(epicId => !epicIds.has(epicId));
      if (missing.length > 0) {
        adrsWithMissingEpics.push({ id: adr.id, title: adr.title, missing });
      }
    }
  }

  return {
    epicsWithNoIssues,
    issuesWithMissingEpic,
    adrsWithMissingIssues,
    adrsWithMissingEpics,
  };
}

// ============================================================================
// Stale Detection
// ============================================================================

/**
 * Parse an ISO date string safely
 */
function parseDate(dateStr: string | undefined): Date | null {
  if (!dateStr) return null;
  try {
    const date = new Date(dateStr);
    return isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}

/**
 * Find stale records (not updated in N days)
 */
export function findStale(
  issues: InspectorIssue[],
  epics: InspectorEpic[],
  adrs: InspectorADR[],
  days: number = 21
): StaleReport {
  const now = Date.now();
  const threshold = days * 24 * 60 * 60 * 1000; // days in milliseconds

  const isStale = (dateStr: string | undefined): boolean => {
    const date = parseDate(dateStr);
    if (!date) return false; // Can't determine staleness without a date
    return (now - date.getTime()) > threshold;
  };

  // Filter stale issues (only open/in_progress ones - done issues should be stale)
  const staleIssues = issues
    .filter(issue =>
      (issue.status === 'open' || issue.status === 'in_progress') &&
      isStale(issue.updated_at || issue.created_at)
    )
    .map(issue => ({
      id: issue.id,
      title: issue.title,
      updated_at: issue.updated_at || issue.created_at || 'unknown',
    }));

  // Filter stale epics (only open/in_progress ones)
  const staleEpics = epics
    .filter(epic =>
      (epic.status === 'open' || epic.status === 'in_progress') &&
      isStale(epic.updated_at || epic.created_at)
    )
    .map(epic => ({
      id: epic.id,
      title: epic.title,
      updated_at: epic.updated_at || epic.created_at || 'unknown',
    }));

  // Filter stale ADRs (only proposed/accepted - not superseded/deprecated)
  const staleADRs = adrs
    .filter(adr =>
      (adr.status === 'proposed' || adr.status === 'accepted') &&
      isStale(adr.updated_at || adr.created_at)
    )
    .map(adr => ({
      id: adr.id,
      title: adr.title,
      updated_at: adr.updated_at || adr.created_at || 'unknown',
    }));

  return {
    issues: staleIssues,
    epics: staleEpics,
    adrs: staleADRs,
  };
}

// ============================================================================
// Summary Generation
// ============================================================================

/**
 * Generate a summary of the data
 */
export function generateSummary(
  issues: InspectorIssue[],
  epics: InspectorEpic[],
  adrs: InspectorADR[]
): ScanSummary {
  return {
    issues: {
      total: issues.length,
      open: issues.filter(i => i.status === 'open').length,
      in_progress: issues.filter(i => i.status === 'in_progress').length,
      done: issues.filter(i => i.status === 'done').length,
      blocked: issues.filter(i => i.status === 'blocked').length,
    },
    epics: {
      total: epics.length,
      open: epics.filter(e => e.status === 'open').length,
      in_progress: epics.filter(e => e.status === 'in_progress').length,
      done: epics.filter(e => e.status === 'done').length,
      blocked: epics.filter(e => e.status === 'blocked').length,
    },
    adrs: {
      total: adrs.length,
      proposed: adrs.filter(a => a.status === 'proposed').length,
      accepted: adrs.filter(a => a.status === 'accepted').length,
      superseded: adrs.filter(a => a.status === 'superseded').length,
      deprecated: adrs.filter(a => a.status === 'deprecated').length,
    },
  };
}

// ============================================================================
// Main Scan Function
// ============================================================================

/**
 * Execute the data scan
 */
export async function scanData(input: ScanDataInput): Promise<ScanDataOutput> {
  const { projectId, scope, validate = false, flag = [], days = 21 } = input;

  // For 'runtime' scope, just return a placeholder (not implemented yet)
  if (scope === 'runtime') {
    return {
      scope,
      projectName: 'unknown',
      error: 'Runtime scan not yet implemented. Use scope "data" or "all".',
    };
  }

  // Find .decibel root - use projectId if provided, otherwise walk up from cwd
  let decibelRoot: string | undefined;
  let projectName: string;

  if (projectId) {
    try {
      const resolved = resolveProjectPaths(projectId);
      decibelRoot = resolved.decibelPath;
      projectName = resolved.id;
    } catch (err) {
      return {
        scope,
        projectName: projectId,
        error: `Failed to resolve project "${projectId}": ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  } else {
    decibelRoot = findDecibelRoot();
    if (!decibelRoot) {
      return {
        scope,
        projectName: 'unknown',
        error: `No .decibel directory found above ${process.cwd()}. Data inspector cannot run.`,
      };
    }
    projectName = getProjectNameFromRoot(decibelRoot);
  }

  // Load all data
  const { issues, epics, adrs } = await loadDataIndex(decibelRoot);

  // Build output
  const output: ScanDataOutput = {
    scope,
    projectName,
    decibelRoot,
    summary: generateSummary(issues, epics, adrs),
  };

  // Run validation if requested
  if (validate || flag.includes('invalid')) {
    output.validation = validateSchema(issues, epics, adrs);
  }

  // Run orphan detection if flagged
  if (flag.includes('orphans')) {
    output.orphans = findOrphans(issues, epics, adrs);
  }

  // Run stale detection if flagged
  if (flag.includes('stale')) {
    output.stale = findStale(issues, epics, adrs, days);
  }

  return output;
}

// ============================================================================
// Output Formatting
// ============================================================================

/**
 * Format the scan output as a human-readable string
 */
export function formatScanOutput(output: ScanDataOutput): string {
  const lines: string[] = [];

  lines.push('SENTINEL DATA INSPECTOR');
  lines.push(`  Project: ${output.projectName}`);
  if (output.decibelRoot) {
    lines.push(`  .decibel root: ${output.decibelRoot}`);
  }

  if (output.error) {
    lines.push('');
    lines.push('ERROR');
    lines.push(`  ${output.error}`);
    return lines.join('\n');
  }

  if (output.summary) {
    lines.push('');
    lines.push('SUMMARY');

    const { issues, epics, adrs } = output.summary;

    const issueBreakdown = [
      `open: ${issues.open}`,
      `in_progress: ${issues.in_progress}`,
      `done: ${issues.done}`,
      `blocked: ${issues.blocked}`,
    ].filter(s => !s.includes(': 0')).join(', ');
    lines.push(`  Issues: ${issues.total}${issueBreakdown ? ` (${issueBreakdown})` : ''}`);

    const epicBreakdown = [
      `open: ${epics.open}`,
      `in_progress: ${epics.in_progress}`,
      `done: ${epics.done}`,
      `blocked: ${epics.blocked}`,
    ].filter(s => !s.includes(': 0')).join(', ');
    lines.push(`  Epics:  ${epics.total}${epicBreakdown ? ` (${epicBreakdown})` : ''}`);

    const adrBreakdown = [
      `proposed: ${adrs.proposed}`,
      `accepted: ${adrs.accepted}`,
      `superseded: ${adrs.superseded}`,
      `deprecated: ${adrs.deprecated}`,
    ].filter(s => !s.includes(': 0')).join(', ');
    lines.push(`  ADRs:   ${adrs.total}${adrBreakdown ? ` (${adrBreakdown})` : ''}`);
  }

  if (output.validation && output.validation.length > 0) {
    lines.push('');
    lines.push('VALIDATION');
    for (const err of output.validation) {
      const prefix = err.severity === 'error' ? '[ERROR]' : '[WARN]';
      const typeLabel = err.type.charAt(0).toUpperCase() + err.type.slice(1);
      lines.push(`  ${prefix} ${typeLabel} ${err.id}: ${err.message}`);
    }
  }

  if (output.orphans) {
    const { epicsWithNoIssues, issuesWithMissingEpic, adrsWithMissingIssues, adrsWithMissingEpics } = output.orphans;
    const hasOrphans = epicsWithNoIssues.length > 0 ||
                       issuesWithMissingEpic.length > 0 ||
                       adrsWithMissingIssues.length > 0 ||
                       adrsWithMissingEpics.length > 0;

    if (hasOrphans) {
      lines.push('');
      lines.push('ORPHANS');

      for (const epic of epicsWithNoIssues) {
        lines.push(`  [EPIC] ${epic.id} (no issues attached)`);
      }

      for (const issue of issuesWithMissingEpic) {
        lines.push(`  [ISSUE] ${issue.id} references missing epic ${issue.epic_id}`);
      }

      for (const adr of adrsWithMissingIssues) {
        lines.push(`  [ADR] ${adr.id} references missing issues: ${adr.missing.join(', ')}`);
      }

      for (const adr of adrsWithMissingEpics) {
        lines.push(`  [ADR] ${adr.id} references missing epics: ${adr.missing.join(', ')}`);
      }
    }
  }

  if (output.stale) {
    const { issues, epics, adrs } = output.stale;
    const hasStale = issues.length > 0 || epics.length > 0 || adrs.length > 0;

    if (hasStale) {
      lines.push('');
      lines.push('STALE');

      for (const issue of issues) {
        lines.push(`  [ISSUE] ${issue.id} last updated ${issue.updated_at}`);
      }

      for (const epic of epics) {
        lines.push(`  [EPIC] ${epic.id} last updated ${epic.updated_at}`);
      }

      for (const adr of adrs) {
        lines.push(`  [ADR] ${adr.id} last updated ${adr.updated_at}`);
      }
    }
  }

  return lines.join('\n');
}
