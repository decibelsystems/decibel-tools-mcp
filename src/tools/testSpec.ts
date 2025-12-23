/**
 * Sentinel Test Specification Tools - ADR-0004 Oversight Pack
 *
 * Provides tools for creating and managing test specifications:
 * - sentinel_createTestSpec: Create a new test specification atom
 * - sentinel_listTestSpecs: List all test specs for a project
 * - sentinel_compileTests: Compile test specs into documentation
 * - sentinel_auditPolicies: Audit policy compliance
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

export type TestType = 'unit' | 'integration' | 'e2e' | 'contract' | 'property' | 'manual';
export type TestPriority = 'critical' | 'high' | 'medium' | 'low';
export type TestStatus = 'draft' | 'active' | 'deprecated';

export interface TestCase {
  name: string;
  description?: string;
  steps?: string[];
  expected: string;
  tags?: string[];
}

export interface CreateTestSpecInput {
  projectId?: string;
  title: string;
  description: string;
  type: TestType;
  priority?: TestPriority;
  policy_refs?: string[];
  test_cases: TestCase[];
  setup?: string;
  teardown?: string;
  tags?: string[];
}

export interface CreateTestSpecOutput {
  test_id: string;
  timestamp: string;
  path: string;
  title: string;
}

export interface ListTestSpecsInput {
  projectId?: string;
  type?: TestType;
  priority?: TestPriority;
  policy_ref?: string;
  tags?: string[];
}

export interface TestSpecSummary {
  id: string;
  title: string;
  type: TestType;
  priority: TestPriority;
  status: TestStatus;
  case_count: number;
  policy_refs: string[];
  tags: string[];
}

export interface ListTestSpecsOutput {
  test_specs: TestSpecSummary[];
  total: number;
}

export interface CompileTestsInput {
  projectId?: string;
  output_format?: 'markdown' | 'json' | 'both';
  include_deprecated?: boolean;
}

export interface CompileTestsOutput {
  markdown_path?: string;
  json_path?: string;
  specs_compiled: number;
  total_cases: number;
  timestamp: string;
}

export interface AuditPoliciesInput {
  projectId?: string;
  check_freshness?: boolean;
  run_enforcement?: boolean;
}

export interface PolicyComplianceItem {
  policy_id: string;
  title: string;
  severity: string;
  status: 'pass' | 'fail' | 'warn' | 'skip';
  message?: string;
}

export interface AuditPoliciesOutput {
  timestamp: string;
  policies_checked: number;
  compliance: PolicyComplianceItem[];
  freshness: {
    policies_stale: boolean;
    tests_stale: boolean;
    last_compiled_policies?: string;
    last_compiled_tests?: string;
  };
  summary: {
    pass: number;
    fail: number;
    warn: number;
    skip: number;
  };
}

export interface TestSpecError {
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

async function getNextTestId(testSpecsDir: string): Promise<string> {
  try {
    const files = await fs.readdir(testSpecsDir);
    const ids = files
      .filter(f => f.startsWith('TEST-') && f.endsWith('.yaml'))
      .map(f => {
        const match = f.match(/^TEST-(\d+)/);
        return match ? parseInt(match[1], 10) : 0;
      })
      .filter(n => !isNaN(n));
    const maxId = ids.length > 0 ? Math.max(...ids) : 0;
    return `TEST-${String(maxId + 1).padStart(4, '0')}`;
  } catch {
    return 'TEST-0001';
  }
}

interface TestSpec {
  id: string;
  title: string;
  description: string;
  type: TestType;
  priority: TestPriority;
  status: TestStatus;
  policy_refs: string[];
  test_cases: TestCase[];
  setup?: string;
  teardown?: string;
  tags: string[];
  created_at: string;
  updated_at?: string;
}

async function parseTestSpecFile(filePath: string): Promise<TestSpec | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const data = YAML.parse(content);
    if (!data || !data.id) return null;
    return {
      id: data.id,
      title: data.title || 'Untitled',
      description: data.description || '',
      type: data.type || 'unit',
      priority: data.priority || 'medium',
      status: data.status || 'active',
      policy_refs: data.policy_refs || [],
      test_cases: data.test_cases || [],
      setup: data.setup,
      teardown: data.teardown,
      tags: data.tags || [],
      created_at: data.created_at || '',
      updated_at: data.updated_at,
    };
  } catch {
    return null;
  }
}

function makeProjectError(operation: string): TestSpecError {
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
 * Create a new test specification atom
 */
export async function createTestSpec(
  input: CreateTestSpecInput
): Promise<CreateTestSpecOutput | TestSpecError> {
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.projectId);
  } catch {
    return makeProjectError('create test spec');
  }

  const now = new Date();
  const timestamp = now.toISOString();

  const testSpecsDir = resolved.subPath('sentinel', 'test_specs');
  ensureDir(testSpecsDir);

  const testId = await getNextTestId(testSpecsDir);
  const slug = slugify(input.title);
  const filename = `${testId}-${slug}.yaml`;
  const filePath = path.join(testSpecsDir, filename);

  // Validate test cases
  if (!input.test_cases || input.test_cases.length === 0) {
    return {
      error: 'NO_TEST_CASES',
      message: 'Test specification must have at least one test case.',
      suggestion: 'Add test_cases array with at least one case containing name and expected.',
    };
  }

  // Build test spec data
  const testSpecData: Record<string, unknown> = {
    id: testId,
    title: input.title,
    description: input.description,
    type: input.type,
    priority: input.priority || 'medium',
    status: 'active',
    test_cases: input.test_cases,
    created_at: timestamp,
    project_id: resolved.id,
  };

  if (input.policy_refs && input.policy_refs.length > 0) {
    testSpecData.policy_refs = input.policy_refs;
  }
  if (input.setup) {
    testSpecData.setup = input.setup;
  }
  if (input.teardown) {
    testSpecData.teardown = input.teardown;
  }
  if (input.tags && input.tags.length > 0) {
    testSpecData.tags = input.tags;
  }

  validateWritePath(filePath, resolved);
  await fs.writeFile(filePath, YAML.stringify(testSpecData), 'utf-8');
  log(`TestSpec: Created ${testId} at ${filePath}`);

  await emitCreateProvenance(
    `sentinel:testspec:${testId}`,
    YAML.stringify(testSpecData),
    `Created test spec: ${input.title}`,
    input.projectId
  );

  return {
    test_id: testId,
    timestamp,
    path: filePath,
    title: input.title,
  };
}

/**
 * List all test specifications for a project
 */
export async function listTestSpecs(
  input: ListTestSpecsInput
): Promise<ListTestSpecsOutput | TestSpecError> {
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.projectId);
  } catch {
    return makeProjectError('list test specs');
  }

  const testSpecsDir = resolved.subPath('sentinel', 'test_specs');
  const testSpecs: TestSpecSummary[] = [];

  try {
    const files = await fs.readdir(testSpecsDir);
    for (const file of files) {
      if (!file.endsWith('.yaml')) continue;

      const filePath = path.join(testSpecsDir, file);
      const spec = await parseTestSpecFile(filePath);
      if (!spec) continue;

      // Apply filters
      if (input.type && spec.type !== input.type) continue;
      if (input.priority && spec.priority !== input.priority) continue;
      if (input.policy_ref && !spec.policy_refs.includes(input.policy_ref)) continue;
      if (input.tags && input.tags.length > 0) {
        const hasTag = input.tags.some(t => spec.tags.includes(t));
        if (!hasTag) continue;
      }

      testSpecs.push({
        id: spec.id,
        title: spec.title,
        type: spec.type,
        priority: spec.priority,
        status: spec.status,
        case_count: spec.test_cases.length,
        policy_refs: spec.policy_refs,
        tags: spec.tags,
      });
    }
  } catch {
    // Directory doesn't exist yet - return empty
  }

  // Sort by ID
  testSpecs.sort((a, b) => a.id.localeCompare(b.id));

  return {
    test_specs: testSpecs,
    total: testSpecs.length,
  };
}

/**
 * Compile test specifications into documentation
 */
export async function compileTests(
  input: CompileTestsInput
): Promise<CompileTestsOutput | TestSpecError> {
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.projectId);
  } catch {
    return makeProjectError('compile tests');
  }

  const now = new Date();
  const timestamp = now.toISOString();
  const format = input.output_format || 'markdown';

  // Get all test specs
  const testSpecsDir = resolved.subPath('sentinel', 'test_specs');
  const testSpecs: TestSpec[] = [];
  let totalCases = 0;

  try {
    const files = await fs.readdir(testSpecsDir);
    for (const file of files) {
      if (!file.endsWith('.yaml')) continue;
      const filePath = path.join(testSpecsDir, file);
      const spec = await parseTestSpecFile(filePath);
      if (spec) {
        if (!input.include_deprecated && spec.status === 'deprecated') continue;
        testSpecs.push(spec);
        totalCases += spec.test_cases.length;
      }
    }
  } catch {
    // No test specs yet
  }

  // Sort by priority (critical first) then by ID
  const priorityOrder: Record<TestPriority, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  };
  testSpecs.sort((a, b) => {
    const priDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (priDiff !== 0) return priDiff;
    return a.id.localeCompare(b.id);
  });

  const result: CompileTestsOutput = {
    specs_compiled: testSpecs.length,
    total_cases: totalCases,
    timestamp,
  };

  // Create output directory
  const docsDir = path.join(resolved.projectPath, 'docs', 'testing');
  ensureDir(docsDir);

  // Generate markdown
  if (format === 'markdown' || format === 'both') {
    const mdPath = path.join(docsDir, 'manifest.md');
    const mdContent = generateTestManifestMarkdown(testSpecs, timestamp);
    await fs.writeFile(mdPath, mdContent, 'utf-8');
    result.markdown_path = mdPath;
    log(`TestSpec: Compiled markdown to ${mdPath}`);
  }

  // Generate JSON
  if (format === 'json' || format === 'both') {
    const jsonPath = path.join(docsDir, 'manifest.json');
    const jsonContent = {
      compiled_at: timestamp,
      total_specs: testSpecs.length,
      total_cases: totalCases,
      specs: testSpecs.map(s => ({
        id: s.id,
        title: s.title,
        type: s.type,
        priority: s.priority,
        status: s.status,
        policy_refs: s.policy_refs,
        case_count: s.test_cases.length,
      })),
    };
    await fs.writeFile(jsonPath, JSON.stringify(jsonContent, null, 2), 'utf-8');
    result.json_path = jsonPath;
    log(`TestSpec: Compiled JSON to ${jsonPath}`);
  }

  return result;
}

/**
 * Audit policy compliance
 */
export async function auditPolicies(
  input: AuditPoliciesInput
): Promise<AuditPoliciesOutput | TestSpecError> {
  let resolved: ResolvedProjectPaths;
  try {
    resolved = resolveProjectPaths(input.projectId);
  } catch {
    return makeProjectError('audit policies');
  }

  const now = new Date();
  const timestamp = now.toISOString();

  const compliance: PolicyComplianceItem[] = [];
  const summary = { pass: 0, fail: 0, warn: 0, skip: 0 };

  // Check freshness of compiled docs
  const freshness = {
    policies_stale: false,
    tests_stale: false,
    last_compiled_policies: undefined as string | undefined,
    last_compiled_tests: undefined as string | undefined,
  };

  if (input.check_freshness !== false) {
    // Check policies.md freshness
    const policiesDocPath = path.join(resolved.projectPath, 'docs', 'oversight', 'policies.md');
    const policiesDir = resolved.subPath('architect', 'policies');

    try {
      const docStat = await fs.stat(policiesDocPath);
      freshness.last_compiled_policies = docStat.mtime.toISOString();

      const policyFiles = await fs.readdir(policiesDir);
      for (const file of policyFiles) {
        if (!file.endsWith('.yaml')) continue;
        const fileStat = await fs.stat(path.join(policiesDir, file));
        if (fileStat.mtime > docStat.mtime) {
          freshness.policies_stale = true;
          break;
        }
      }
    } catch {
      freshness.policies_stale = true;
    }

    // Check manifest.md freshness
    const testsDocPath = path.join(resolved.projectPath, 'docs', 'testing', 'manifest.md');
    const testSpecsDir = resolved.subPath('sentinel', 'test_specs');

    try {
      const docStat = await fs.stat(testsDocPath);
      freshness.last_compiled_tests = docStat.mtime.toISOString();

      const testFiles = await fs.readdir(testSpecsDir);
      for (const file of testFiles) {
        if (!file.endsWith('.yaml')) continue;
        const fileStat = await fs.stat(path.join(testSpecsDir, file));
        if (fileStat.mtime > docStat.mtime) {
          freshness.tests_stale = true;
          break;
        }
      }
    } catch {
      freshness.tests_stale = true;
    }
  }

  // Load all policies for compliance check
  const policiesDir = resolved.subPath('architect', 'policies');
  try {
    const files = await fs.readdir(policiesDir);
    for (const file of files) {
      if (!file.endsWith('.yaml')) continue;
      const filePath = path.join(policiesDir, file);
      const content = await fs.readFile(filePath, 'utf-8');
      const policy = YAML.parse(content);

      if (!policy || !policy.id) continue;

      // Basic compliance check - verify policy has required fields
      let status: 'pass' | 'fail' | 'warn' | 'skip' = 'pass';
      let message: string | undefined;

      if (!policy.rules || policy.rules.length === 0) {
        status = 'warn';
        message = 'Policy has no rules defined.';
      } else if (!policy.rationale) {
        status = 'warn';
        message = 'Policy missing rationale.';
      }

      // Check for expired exceptions
      if (policy.exceptions && Array.isArray(policy.exceptions)) {
        for (const ex of policy.exceptions) {
          if (ex.expires) {
            const expiryDate = new Date(ex.expires);
            if (expiryDate < now) {
              status = 'warn';
              message = `Has expired exception: ${ex.reason}`;
              break;
            }
          }
        }
      }

      compliance.push({
        policy_id: policy.id,
        title: policy.title || 'Untitled',
        severity: policy.severity || 'medium',
        status,
        message,
      });

      summary[status]++;
    }
  } catch {
    // No policies yet
  }

  // Add freshness warnings to summary
  if (freshness.policies_stale) {
    compliance.unshift({
      policy_id: 'FRESHNESS',
      title: 'Policy Documentation Freshness',
      severity: 'medium',
      status: 'warn',
      message: 'Compiled policies.md is stale. Run architect_compileOversight to update.',
    });
    summary.warn++;
  }

  if (freshness.tests_stale) {
    compliance.unshift({
      policy_id: 'FRESHNESS',
      title: 'Test Documentation Freshness',
      severity: 'medium',
      status: 'warn',
      message: 'Compiled manifest.md is stale. Run sentinel_compileTests to update.',
    });
    summary.warn++;
  }

  return {
    timestamp,
    policies_checked: compliance.filter(c => c.policy_id !== 'FRESHNESS').length,
    compliance,
    freshness,
    summary,
  };
}

/**
 * Generate markdown documentation for test specifications
 */
function generateTestManifestMarkdown(specs: TestSpec[], timestamp: string): string {
  const lines: string[] = [
    '# Test Manifest',
    '',
    `> Auto-generated from test specs on ${timestamp}`,
    '',
    '## Summary',
    '',
    `- **Total Test Specs:** ${specs.length}`,
    `- **Total Test Cases:** ${specs.reduce((sum, s) => sum + s.test_cases.length, 0)}`,
    '',
    '### By Type',
    '',
  ];

  const typeCounts: Record<string, number> = {};
  for (const spec of specs) {
    typeCounts[spec.type] = (typeCounts[spec.type] || 0) + 1;
  }
  for (const [type, count] of Object.entries(typeCounts)) {
    lines.push(`- **${type}:** ${count}`);
  }

  lines.push('', '### By Priority', '');
  const priorityCounts: Record<string, number> = {};
  for (const spec of specs) {
    priorityCounts[spec.priority] = (priorityCounts[spec.priority] || 0) + 1;
  }
  for (const [priority, count] of Object.entries(priorityCounts)) {
    lines.push(`- **${priority}:** ${count}`);
  }

  lines.push('', '---', '');

  for (const spec of specs) {
    lines.push(`## ${spec.id}: ${spec.title}`);
    lines.push('');
    lines.push(`**Type:** ${spec.type}`);
    lines.push(`**Priority:** ${spec.priority.toUpperCase()}`);
    lines.push(`**Status:** ${spec.status}`);
    if (spec.tags.length > 0) {
      lines.push(`**Tags:** ${spec.tags.map(t => `\`${t}\``).join(', ')}`);
    }
    if (spec.policy_refs.length > 0) {
      lines.push(`**Policy References:** ${spec.policy_refs.join(', ')}`);
    }
    lines.push('');
    lines.push('### Description');
    lines.push('');
    lines.push(spec.description);
    lines.push('');

    if (spec.setup) {
      lines.push('### Setup');
      lines.push('');
      lines.push('```');
      lines.push(spec.setup);
      lines.push('```');
      lines.push('');
    }

    lines.push('### Test Cases');
    lines.push('');
    for (let i = 0; i < spec.test_cases.length; i++) {
      const tc = spec.test_cases[i];
      lines.push(`#### Case ${i + 1}: ${tc.name}`);
      lines.push('');
      if (tc.description) {
        lines.push(tc.description);
        lines.push('');
      }
      if (tc.steps && tc.steps.length > 0) {
        lines.push('**Steps:**');
        for (let j = 0; j < tc.steps.length; j++) {
          lines.push(`${j + 1}. ${tc.steps[j]}`);
        }
        lines.push('');
      }
      lines.push(`**Expected:** ${tc.expected}`);
      lines.push('');
    }

    if (spec.teardown) {
      lines.push('### Teardown');
      lines.push('');
      lines.push('```');
      lines.push(spec.teardown);
      lines.push('```');
      lines.push('');
    }

    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}

export function isTestSpecError(result: unknown): result is TestSpecError {
  return (
    typeof result === 'object' &&
    result !== null &&
    'error' in result &&
    'message' in result
  );
}
