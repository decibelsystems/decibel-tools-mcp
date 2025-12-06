import { spawn } from 'child_process';
import { resolveProjectRoot, ProjectConfig } from '../projectPaths.js';
import { log } from '../config.js';

// ============================================================================
// Types
// ============================================================================

export type ScanDataFlag = 'orphans' | 'stale' | 'invalid';

export interface ScanDataInput {
  projectId: string;
  validate?: boolean;
  flags?: ScanDataFlag[];
  days?: number;
}

export interface SentinelDataScanResult {
  summary: string;
  counts: {
    issues: { total: number; open: number; in_progress: number; done: number; blocked: number };
    epics: { total: number; open: number; in_progress: number; done: number; blocked: number };
    adrs: { total: number };
  };
  orphans?: {
    epics: string[];
    issues: string[];
  };
  stale?: {
    issues: string[];
    epics: string[];
  };
  validationWarnings?: { id?: string; message: string }[];
}

export interface ScanDataError {
  error: string;
  exitCode: number;
  stderr: string;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_DAYS = 21;
const DEFAULT_FLAGS: ScanDataFlag[] = [];
const PYTHON_COMMAND = 'python3'; // Consistent with typical Python 3 installations

// ============================================================================
// Command Builder (exported for testing)
// ============================================================================

/**
 * Build the command arguments for the Python data inspector.
 * Exported for testing purposes.
 */
export function buildCommandArgs(
  projectRoot: string,
  options: { validate?: boolean; flags?: ScanDataFlag[]; days?: number }
): string[] {
  const { validate = false, flags = DEFAULT_FLAGS, days = DEFAULT_DAYS } = options;

  const args = [
    '-m',
    'sentinel.data_inspector',
    '--project-root',
    projectRoot,
    '--json',
    '--days',
    String(days),
  ];

  if (validate) {
    args.push('--validate');
  }

  if (flags.length > 0) {
    args.push('--flags', flags.join(','));
  }

  return args;
}

// ============================================================================
// Main Function
// ============================================================================

/**
 * Execute the Python sentinel.data_inspector and return parsed results.
 */
export async function scanData(
  input: ScanDataInput
): Promise<SentinelDataScanResult | ScanDataError> {
  const { projectId, validate = false, flags = DEFAULT_FLAGS, days = DEFAULT_DAYS } = input;

  // Resolve project root from projectId
  let project: ProjectConfig;
  try {
    project = await resolveProjectRoot(projectId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      error: `Failed to resolve projectId: ${message}`,
      exitCode: -1,
      stderr: '',
    };
  }

  log(`sentinel.scanData: Resolved project "${projectId}" to root: ${project.root}`);

  // Build command arguments
  const args = buildCommandArgs(project.root, { validate, flags, days });
  log(`sentinel.scanData: Running ${PYTHON_COMMAND} ${args.join(' ')}`);

  // Execute Python process
  return new Promise((resolve) => {
    const proc = spawn(PYTHON_COMMAND, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
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
      log(`sentinel.scanData: Process error: ${err.message}`);
      resolve({
        error: `Failed to execute Python process: ${err.message}`,
        exitCode: -1,
        stderr: err.message,
      });
    });

    proc.on('close', (code) => {
      const exitCode = code ?? -1;

      if (exitCode !== 0) {
        log(`sentinel.scanData: Process exited with code ${exitCode}`);
        log(`sentinel.scanData: stderr: ${stderr}`);

        // Truncate stderr if too long
        const stderrSnippet = stderr.length > 500 ? stderr.slice(0, 500) + '...' : stderr;

        resolve({
          error: `Python data_inspector exited with code ${exitCode}`,
          exitCode,
          stderr: stderrSnippet,
        });
        return;
      }

      // Parse JSON output
      try {
        const result = JSON.parse(stdout) as SentinelDataScanResult;
        log(`sentinel.scanData: Successfully parsed result`);
        resolve(result);
      } catch (parseErr) {
        const message = parseErr instanceof Error ? parseErr.message : String(parseErr);
        log(`sentinel.scanData: Failed to parse JSON: ${message}`);
        log(`sentinel.scanData: stdout was: ${stdout.slice(0, 200)}`);

        resolve({
          error: `Failed to parse Python output as JSON: ${message}`,
          exitCode: 0,
          stderr: `stdout: ${stdout.slice(0, 200)}`,
        });
      }
    });
  });
}

/**
 * Check if a result is an error
 */
export function isScanDataError(
  result: SentinelDataScanResult | ScanDataError
): result is ScanDataError {
  return 'error' in result && 'exitCode' in result;
}
