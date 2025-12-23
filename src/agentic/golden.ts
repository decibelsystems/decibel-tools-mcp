/**
 * Agentic Pack Golden Eval
 *
 * Regression testing harness for semiotic clarity.
 * Compares rendered outputs against known-good golden files.
 */

import fs from 'fs/promises';
import path from 'path';
import { log } from '../config.js';
import { resolveProjectPaths, ResolvedProjectPaths } from '../projectRegistry.js';
import {
  GoldenCase,
  GoldenResult,
  GoldenTestResult,
  CanonicalPayload,
  CompiledPack,
  GoldenInput,
  GoldenOutputResult,
} from './types.js';
import { getOrCompilePack } from './compiler.js';
import { render } from './renderer.js';
import { lintWithPack } from './linter.js';

// ============================================================================
// Golden File Loading
// ============================================================================

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function loadGoldenCases(goldenDir: string): Promise<GoldenCase[]> {
  const cases: GoldenCase[] = [];

  try {
    const entries = await fs.readdir(goldenDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const caseDir = path.join(goldenDir, entry.name);
        const payloadPath = path.join(caseDir, 'payload.json');

        if (await fileExists(payloadPath)) {
          // Find expected output files
          const expectedOutputs: Record<string, string> = {};
          const files = await fs.readdir(caseDir);

          for (const file of files) {
            if (file.startsWith('expected-') && file.endsWith('.txt')) {
              const rendererId = file.replace('expected-', '').replace('.txt', '');
              expectedOutputs[rendererId] = path.join(caseDir, file);
            }
          }

          if (Object.keys(expectedOutputs).length > 0) {
            cases.push({
              name: entry.name,
              payload_file: payloadPath,
              expected_outputs: expectedOutputs,
            });
          }
        }
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  return cases;
}

async function loadPayload(payloadPath: string): Promise<CanonicalPayload> {
  const content = await fs.readFile(payloadPath, 'utf-8');
  return JSON.parse(content) as CanonicalPayload;
}

async function loadExpectedOutput(expectedPath: string): Promise<string> {
  return await fs.readFile(expectedPath, 'utf-8');
}

// ============================================================================
// Diff Generation
// ============================================================================

function generateDiff(expected: string, actual: string): string[] {
  const expectedLines = expected.split('\n');
  const actualLines = actual.split('\n');
  const diff: string[] = [];

  const maxLen = Math.max(expectedLines.length, actualLines.length);

  for (let i = 0; i < maxLen; i++) {
    const exp = expectedLines[i] ?? '';
    const act = actualLines[i] ?? '';

    if (exp !== act) {
      diff.push(`Line ${i + 1}:`);
      if (exp) diff.push(`  - ${exp}`);
      if (act) diff.push(`  + ${act}`);
    }
  }

  return diff;
}

function normalizeWhitespace(text: string): string {
  return text
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
}

// ============================================================================
// Core Golden Eval Function
// ============================================================================

/**
 * Run golden eval for a single case
 */
async function runGoldenCase(
  goldenCase: GoldenCase,
  pack: CompiledPack,
  strict: boolean
): Promise<GoldenTestResult[]> {
  const results: GoldenTestResult[] = [];

  // Load payload
  const payload = await loadPayload(goldenCase.payload_file);

  // Test each expected output
  for (const [rendererId, expectedPath] of Object.entries(goldenCase.expected_outputs)) {
    try {
      // Load expected
      const expected = await loadExpectedOutput(expectedPath);

      // Render actual
      const renderOutput = render(payload, rendererId, pack, 'plain');
      const actual = renderOutput.rendered;

      // Compare (normalize whitespace for comparison)
      const normalizedExpected = normalizeWhitespace(expected);
      const normalizedActual = normalizeWhitespace(actual);
      const passed = normalizedExpected === normalizedActual;

      // Run lint if strict mode
      let lintResult;
      if (strict) {
        lintResult = lintWithPack(actual, rendererId, pack, payload);
      }

      const testResult: GoldenTestResult = {
        case_name: goldenCase.name,
        renderer_id: rendererId,
        passed: passed && (!strict || (lintResult?.valid ?? true)),
        expected_file: expectedPath,
      };

      if (!passed) {
        testResult.expected = normalizedExpected;
        testResult.actual = normalizedActual;
        testResult.diff = generateDiff(normalizedExpected, normalizedActual);
      }

      if (lintResult) {
        testResult.lint_result = lintResult;
      }

      results.push(testResult);
    } catch (error) {
      results.push({
        case_name: goldenCase.name,
        renderer_id: rendererId,
        passed: false,
        expected_file: expectedPath,
        diff: [`Error: ${error instanceof Error ? error.message : String(error)}`],
      });
    }
  }

  return results;
}

/**
 * Run all golden eval cases
 */
export async function runGoldenEval(
  resolved: ResolvedProjectPaths,
  caseName?: string,
  strict: boolean = false
): Promise<GoldenResult> {
  const goldenDir = resolved.subPath('architect', 'agentic', 'golden');
  const pack = await getOrCompilePack(resolved);

  log(`agentic-golden: Running golden eval from ${goldenDir}`);

  // Load cases
  let cases = await loadGoldenCases(goldenDir);

  // Filter by case name if specified
  if (caseName) {
    cases = cases.filter((c) => c.name === caseName);
    if (cases.length === 0) {
      throw new Error(`Golden case '${caseName}' not found`);
    }
  }

  log(`agentic-golden: Found ${cases.length} test cases`);

  // Run all cases
  const allResults: GoldenTestResult[] = [];
  for (const goldenCase of cases) {
    const caseResults = await runGoldenCase(goldenCase, pack.content, strict);
    allResults.push(...caseResults);
  }

  // Summarize
  const passedCount = allResults.filter((r) => r.passed).length;
  const failedCount = allResults.length - passedCount;

  const result: GoldenResult = {
    passed: failedCount === 0,
    total_cases: allResults.length,
    passed_cases: passedCount,
    failed_cases: failedCount,
    results: allResults,
    run_at: new Date().toISOString(),
  };

  log(
    `agentic-golden: ${result.passed ? 'PASS' : 'FAIL'} - ${passedCount}/${allResults.length} tests passed`
  );

  return result;
}

// ============================================================================
// Golden File Management
// ============================================================================

/**
 * Update golden files with current output (for updating baselines)
 */
export async function updateGoldenFile(
  resolved: ResolvedProjectPaths,
  caseName: string,
  rendererId: string
): Promise<void> {
  const goldenDir = resolved.subPath('architect', 'agentic', 'golden');
  const caseDir = path.join(goldenDir, caseName);
  const payloadPath = path.join(caseDir, 'payload.json');
  const expectedPath = path.join(caseDir, `expected-${rendererId}.txt`);

  // Load payload
  const payload = await loadPayload(payloadPath);

  // Get pack and render
  const pack = await getOrCompilePack(resolved);
  const renderOutput = render(payload, rendererId, pack.content, 'plain');

  // Write new expected file
  await fs.writeFile(expectedPath, renderOutput.rendered, 'utf-8');

  log(`agentic-golden: Updated ${expectedPath}`);
}

/**
 * Create a new golden case from a payload
 */
export async function createGoldenCase(
  resolved: ResolvedProjectPaths,
  caseName: string,
  payload: CanonicalPayload,
  rendererIds: string[]
): Promise<void> {
  const goldenDir = resolved.subPath('architect', 'agentic', 'golden');
  const caseDir = path.join(goldenDir, caseName);

  // Create case directory
  await fs.mkdir(caseDir, { recursive: true });

  // Write payload
  const payloadPath = path.join(caseDir, 'payload.json');
  await fs.writeFile(payloadPath, JSON.stringify(payload, null, 2), 'utf-8');

  // Get pack
  const pack = await getOrCompilePack(resolved);

  // Generate expected outputs for each renderer
  for (const rendererId of rendererIds) {
    const renderOutput = render(payload, rendererId, pack.content, 'plain');
    const expectedPath = path.join(caseDir, `expected-${rendererId}.txt`);
    await fs.writeFile(expectedPath, renderOutput.rendered, 'utf-8');
  }

  log(`agentic-golden: Created golden case '${caseName}' with ${rendererIds.length} renderers`);
}

// ============================================================================
// MCP Tool Handler
// ============================================================================

/**
 * MCP tool handler for running golden eval
 */
export async function runGolden(input: GoldenInput): Promise<GoldenOutputResult> {
  try {
    const resolved = resolveProjectPaths(input.projectId);

    log(`agentic-golden: Running golden eval${input.case_name ? ` for case '${input.case_name}'` : ''}`);

    const result = await runGoldenEval(resolved, input.case_name, input.strict ?? false);

    return {
      status: 'executed',
      result,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`agentic-golden: Error: ${message}`);
    return {
      status: 'error',
      error: message,
    };
  }
}
