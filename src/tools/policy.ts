/**
 * Architect Policy Tools - ADR-0004 Oversight Pack
 *
 * Provides tools for creating and managing policy atoms:
 * - architect_createPolicy: Create a new policy atom
 * - architect_listPolicies: List all policies for a project
 * - architect_getPolicy: Get a specific policy by ID
 * - architect_compileOversight: Compile policies into documentation
 */

import fs from 'fs/promises';
import path from 'path';
import YAML from 'yaml';
import { log } from '../config.js';
import { ensureDir } from '../dataRoot.js';
import { resolveProjectPaths, validateWritePath, ResolvedProjectPaths } from '../projectRegistry.js';
import { emitCreateProvenance } from './provenance.js';

// ============================================================================
// Types
// ============================================================================

export type PolicySeverity = 'critical' | 'high' | 'medium' | 'low';

export interface PolicyRule {
  key: string;
  description: string;
  check?: string;
}

export interface PolicyException {
  reason: string;
  scope?: string;
  expires?: string;
  approved_by?: string;
}

export interface PolicyExamples {
  compliant?: string[];
  violation?: string[];
}

export interface CreatePolicyInput {
  projectId?: string;
  title: string;
  rationale: string;
  scope: string;
  rules: PolicyRule[];
  severity: PolicySeverity;
  enforcement_hooks?: string[];
  exceptions?: PolicyException[];
  examples?: PolicyExamples;
  tags?: string[];
}

export interface CreatePolicyOutput {
  policy_id: string;
  timestamp: string;
  path: string;
  title: string;
}

export interface ListPoliciesInput {
  projectId?: string;
  severity?: PolicySeverity;
  tags?: string[];
}

export interface PolicySummary {
  id: string;
  title: string;
  severity: PolicySeverity;
  scope: string;
  rule_count: number;
  tags: string[];
}

export interface ListPoliciesOutput {
  policies: PolicySummary[];
  total: number;
}

export interface GetPolicyInput {
  projectId?: string;
  policy_id: string;
}

export interface Policy {
  id: string;
  title: string;
  rationale: string;
  scope: string;
  rules: PolicyRule[];
  severity: PolicySeverity;
  enforcement_hooks: string[];
  exceptions: PolicyException[];
  examples: PolicyExamples;
  tags: string[];
  created_at: string;
  updated_at?: string;
}

export interface GetPolicyOutput {
  policy: Policy | null;
  path?: string;
  error?: string;
}

export interface CompileOversightInput {
  projectId?: string;
  output_format?: 'markdown' | 'json' | 'both';
  include_inherited?: boolean;
}

export interface CompileOversightOutput {
  markdown_path?: string;
  json_path?: string;
  policies_compiled: number;
  profiles_resolved: string[];
  timestamp: string;
}

export interface PolicyError {
  error: string;
  message: string;
  suggestion?: string;
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

async function getNextPolicyId(policiesDir: string): Promise<string> {
  try {
    const files = await fs.readdir(policiesDir);
    const ids = files
      .filter(f => f.startsWith('POL-') && f.endsWith('.yaml'))
      .map(f => {
        const match = f.match(/^POL-(\d+)/);
        return match ? parseInt(match[1], 10) : 0;
      })
      .filter(n => !isNaN(n));
    const maxId = ids.length > 0 ? Math.max(...ids) : 0;
    return `POL-${String(maxId + 1).padStart(4, '0')}`;
  } catch {
    return 'POL-0001';
  }
}

async function parsePolicyFile(filePath: string): Promise<Policy | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const data = YAML.parse(content);
    if (!data || !data.id) return null;
    return {
      id: data.id,
      title: data.title || 'Untitled',
      rationale: data.rationale || '',
      scope: data.scope || 'global',
      rules: data.rules || [],
      severity: data.severity || 'medium',
      enforcement_hooks: data.enforcement_hooks || [],
      exceptions: data.exceptions || [],
      examples: data.examples || {},
      tags: data.tags || [],
      created_at: data.created_at || '',
      updated_at: data.updated_at,
    };
  } catch {
    return null;
  }
}

function isError(result: unknown): result is PolicyError {
  return (
    typeof result === 'object' &&
    result !== null &&
    'error' in result &&
    'message' in result
  );
}

function makeProjectError(operation: string): PolicyError {
  return {
    error: 'PROJECT_NOT_FOUND',
    message: `Cannot ${operation}: No project context available.`,
    suggestion: 'Specify projectId parameter, set DECIBEL_PROJECT_ROOT env var, or run from a directory with .decibel/',
  };
}

// ============================================================================
// Tool Implementations
// ============================================================================

/**
 * Create a new policy atom
 */
export async function createPolicy(
  input: CreatePolicyInput
): Promise<CreatePolicyOutput | PolicyError> {
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.projectId);
  } catch {
    return makeProjectError('create policy');
  }

  const now = new Date();
  const timestamp = now.toISOString();

  const policiesDir = resolved.subPath('architect', 'policies');
  ensureDir(policiesDir);

  const policyId = await getNextPolicyId(policiesDir);
  const slug = slugify(input.title);
  const filename = `${policyId}-${slug}.yaml`;
  const filePath = path.join(policiesDir, filename);

  // Validate rules have unique keys
  const ruleKeys = input.rules.map(r => r.key);
  const uniqueKeys = new Set(ruleKeys);
  if (uniqueKeys.size !== ruleKeys.length) {
    return {
      error: 'DUPLICATE_RULE_KEYS',
      message: 'Policy rules must have unique keys.',
      suggestion: 'Remove or rename duplicate rule keys.',
    };
  }

  // Build policy data
  const policyData: Record<string, unknown> = {
    id: policyId,
    title: input.title,
    rationale: input.rationale,
    scope: input.scope,
    rules: input.rules,
    severity: input.severity,
    created_at: timestamp,
    project_id: resolved.id,
  };

  if (input.enforcement_hooks && input.enforcement_hooks.length > 0) {
    policyData.enforcement_hooks = input.enforcement_hooks;
  }
  if (input.exceptions && input.exceptions.length > 0) {
    policyData.exceptions = input.exceptions;
  }
  if (input.examples) {
    policyData.examples = input.examples;
  }
  if (input.tags && input.tags.length > 0) {
    policyData.tags = input.tags;
  }

  validateWritePath(filePath, resolved);
  await fs.writeFile(filePath, YAML.stringify(policyData), 'utf-8');
  log(`Policy: Created ${policyId} at ${filePath}`);

  await emitCreateProvenance(
    `architect:policy:${policyId}`,
    YAML.stringify(policyData),
    `Created policy: ${input.title}`,
    input.projectId
  );

  return {
    policy_id: policyId,
    timestamp,
    path: filePath,
    title: input.title,
  };
}

/**
 * List all policies for a project
 */
export async function listPolicies(
  input: ListPoliciesInput
): Promise<ListPoliciesOutput | PolicyError> {
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.projectId);
  } catch {
    return makeProjectError('list policies');
  }

  const policiesDir = resolved.subPath('architect', 'policies');
  const policies: PolicySummary[] = [];

  try {
    const files = await fs.readdir(policiesDir);
    for (const file of files) {
      if (!file.endsWith('.yaml')) continue;

      const filePath = path.join(policiesDir, file);
      const policy = await parsePolicyFile(filePath);
      if (!policy) continue;

      // Apply filters
      if (input.severity && policy.severity !== input.severity) continue;
      if (input.tags && input.tags.length > 0) {
        const hasTag = input.tags.some(t => policy.tags.includes(t));
        if (!hasTag) continue;
      }

      policies.push({
        id: policy.id,
        title: policy.title,
        severity: policy.severity,
        scope: policy.scope,
        rule_count: policy.rules.length,
        tags: policy.tags,
      });
    }
  } catch {
    // Directory doesn't exist yet - return empty
  }

  // Sort by ID
  policies.sort((a, b) => a.id.localeCompare(b.id));

  return {
    policies,
    total: policies.length,
  };
}

/**
 * Get a specific policy by ID
 */
export async function getPolicy(
  input: GetPolicyInput
): Promise<GetPolicyOutput | PolicyError> {
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.projectId);
  } catch {
    return makeProjectError('get policy');
  }

  const policiesDir = resolved.subPath('architect', 'policies');

  try {
    const files = await fs.readdir(policiesDir);
    const policyFile = files.find(f => f.startsWith(input.policy_id));

    if (!policyFile) {
      return {
        policy: null,
        error: `Policy not found: ${input.policy_id}`,
      };
    }

    const filePath = path.join(policiesDir, policyFile);
    const policy = await parsePolicyFile(filePath);

    if (!policy) {
      return {
        policy: null,
        error: `Failed to parse policy: ${input.policy_id}`,
      };
    }

    return {
      policy,
      path: filePath,
    };
  } catch {
    return {
      policy: null,
      error: `Policy not found: ${input.policy_id}`,
    };
  }
}

/**
 * Compile policies into documentation
 */
export async function compileOversight(
  input: CompileOversightInput
): Promise<CompileOversightOutput | PolicyError> {
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.projectId);
  } catch {
    return makeProjectError('compile oversight');
  }

  const now = new Date();
  const timestamp = now.toISOString();
  const format = input.output_format || 'markdown';

  // Get all policies
  const policiesDir = resolved.subPath('architect', 'policies');
  const policies: Policy[] = [];
  const profilesResolved: string[] = ['local'];

  try {
    const files = await fs.readdir(policiesDir);
    for (const file of files) {
      if (!file.endsWith('.yaml')) continue;
      const filePath = path.join(policiesDir, file);
      const policy = await parsePolicyFile(filePath);
      if (policy) policies.push(policy);
    }
  } catch {
    // No policies yet
  }

  // Sort by severity (critical first) then by ID
  const severityOrder: Record<PolicySeverity, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  };
  policies.sort((a, b) => {
    const sevDiff = severityOrder[a.severity] - severityOrder[b.severity];
    if (sevDiff !== 0) return sevDiff;
    return a.id.localeCompare(b.id);
  });

  const result: CompileOversightOutput = {
    policies_compiled: policies.length,
    profiles_resolved: profilesResolved,
    timestamp,
  };

  // Create output directory
  const docsDir = path.join(resolved.projectPath, 'docs', 'oversight');
  ensureDir(docsDir);

  // Generate markdown
  if (format === 'markdown' || format === 'both') {
    const mdPath = path.join(docsDir, 'policies.md');
    const mdContent = generatePoliciesMarkdown(policies, timestamp);
    await fs.writeFile(mdPath, mdContent, 'utf-8');
    result.markdown_path = mdPath;
    log(`Policy: Compiled markdown to ${mdPath}`);
  }

  // Generate JSON
  if (format === 'json' || format === 'both') {
    const jsonPath = path.join(docsDir, 'compiled.json');
    const jsonContent = {
      compiled_at: timestamp,
      profiles: profilesResolved,
      policies: policies.map(p => ({
        id: p.id,
        title: p.title,
        severity: p.severity,
        scope: p.scope,
        rules: p.rules,
        enforcement_hooks: p.enforcement_hooks,
      })),
    };
    await fs.writeFile(jsonPath, JSON.stringify(jsonContent, null, 2), 'utf-8');
    result.json_path = jsonPath;
    log(`Policy: Compiled JSON to ${jsonPath}`);
  }

  return result;
}

/**
 * Generate markdown documentation for policies
 */
function generatePoliciesMarkdown(policies: Policy[], timestamp: string): string {
  const lines: string[] = [
    '# Oversight Policies',
    '',
    `> Auto-generated from policy atoms on ${timestamp}`,
    '',
    '## Summary',
    '',
    `- **Total Policies:** ${policies.length}`,
    `- **Critical:** ${policies.filter(p => p.severity === 'critical').length}`,
    `- **High:** ${policies.filter(p => p.severity === 'high').length}`,
    `- **Medium:** ${policies.filter(p => p.severity === 'medium').length}`,
    `- **Low:** ${policies.filter(p => p.severity === 'low').length}`,
    '',
    '---',
    '',
  ];

  for (const policy of policies) {
    lines.push(`## ${policy.id}: ${policy.title}`);
    lines.push('');
    lines.push(`**Severity:** ${policy.severity.toUpperCase()}`);
    lines.push(`**Scope:** ${policy.scope}`);
    if (policy.tags.length > 0) {
      lines.push(`**Tags:** ${policy.tags.map(t => `\`${t}\``).join(', ')}`);
    }
    lines.push('');
    lines.push('### Rationale');
    lines.push('');
    lines.push(policy.rationale);
    lines.push('');
    lines.push('### Rules');
    lines.push('');
    for (const rule of policy.rules) {
      lines.push(`- **${rule.key}:** ${rule.description}`);
      if (rule.check) {
        lines.push(`  - Check: \`${rule.check}\``);
      }
    }
    lines.push('');

    if (policy.enforcement_hooks.length > 0) {
      lines.push('### Enforcement Hooks');
      lines.push('');
      for (const hook of policy.enforcement_hooks) {
        lines.push(`- ${hook}`);
      }
      lines.push('');
    }

    if (policy.exceptions.length > 0) {
      lines.push('### Exceptions');
      lines.push('');
      for (const ex of policy.exceptions) {
        let exLine = `- ${ex.reason}`;
        if (ex.scope) exLine += ` (scope: ${ex.scope})`;
        if (ex.expires) exLine += ` [expires: ${ex.expires}]`;
        lines.push(exLine);
      }
      lines.push('');
    }

    if (policy.examples.compliant && policy.examples.compliant.length > 0) {
      lines.push('### Compliant Examples');
      lines.push('');
      for (const ex of policy.examples.compliant) {
        lines.push(`- ${ex}`);
      }
      lines.push('');
    }

    if (policy.examples.violation && policy.examples.violation.length > 0) {
      lines.push('### Violation Examples');
      lines.push('');
      for (const ex of policy.examples.violation) {
        lines.push(`- ${ex}`);
      }
      lines.push('');
    }

    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}

export { isError as isPolicyError };
