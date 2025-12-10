import { describe, it, expect } from 'vitest';
import {
  buildCommandArgs,
  ScanDataFlag,
  isScanDataError,
  SentinelDataScanResult,
  ScanDataError,
} from '../../src/tools/sentinel-scan-data.js';

describe('sentinel-scan-data', () => {
  // ==========================================================================
  // buildCommandArgs Tests
  // ==========================================================================

  describe('buildCommandArgs', () => {
    it('should build basic args with project root', () => {
      const args = buildCommandArgs('/path/to/project', {});

      expect(args).toContain('-m');
      expect(args).toContain('sentinel.data_inspector');
      expect(args).toContain('--project-root');
      expect(args).toContain('/path/to/project');
      expect(args).toContain('--json');
    });

    it('should include default days value', () => {
      const args = buildCommandArgs('/path/to/project', {});

      expect(args).toContain('--days');
      expect(args).toContain('21');
    });

    it('should include custom days value', () => {
      const args = buildCommandArgs('/path/to/project', { days: 7 });

      expect(args).toContain('--days');
      expect(args).toContain('7');
    });

    it('should include --validate when validate is true', () => {
      const args = buildCommandArgs('/path/to/project', { validate: true });

      expect(args).toContain('--validate');
    });

    it('should not include --validate when validate is false', () => {
      const args = buildCommandArgs('/path/to/project', { validate: false });

      expect(args).not.toContain('--validate');
    });

    it('should include --flags when flags are provided', () => {
      const flags: ScanDataFlag[] = ['orphans', 'stale'];
      const args = buildCommandArgs('/path/to/project', { flags });

      expect(args).toContain('--flags');
      expect(args).toContain('orphans,stale');
    });

    it('should include single flag correctly', () => {
      const flags: ScanDataFlag[] = ['invalid'];
      const args = buildCommandArgs('/path/to/project', { flags });

      expect(args).toContain('--flags');
      expect(args).toContain('invalid');
    });

    it('should not include --flags when flags array is empty', () => {
      const args = buildCommandArgs('/path/to/project', { flags: [] });

      expect(args).not.toContain('--flags');
    });

    it('should build correct args for full input', () => {
      const args = buildCommandArgs('/path/to/my-project', {
        validate: true,
        flags: ['orphans', 'stale', 'invalid'],
        days: 14,
      });

      expect(args).toEqual([
        '-m',
        'sentinel.data_inspector',
        '--project-root',
        '/path/to/my-project',
        '--json',
        '--days',
        '14',
        '--validate',
        '--flags',
        'orphans,stale,invalid',
      ]);
    });

    it('should build args matching expected format', () => {
      // This test validates the exact format described in requirements
      const projectRoot = '/path/to/my-project';
      const args = buildCommandArgs(projectRoot, {
        validate: true,
        flags: ['orphans'],
        days: 21,
      });

      // Verify structure matches: python3 -m sentinel.data_inspector --project-root <root> --json --days <N> [--validate] [--flags <list>]
      expect(args[0]).toBe('-m');
      expect(args[1]).toBe('sentinel.data_inspector');
      expect(args[2]).toBe('--project-root');
      expect(args[3]).toBe(projectRoot);
      expect(args[4]).toBe('--json');
      expect(args[5]).toBe('--days');
      expect(args[6]).toBe('21');
      expect(args[7]).toBe('--validate');
      expect(args[8]).toBe('--flags');
      expect(args[9]).toBe('orphans');
    });
  });

  // ==========================================================================
  // isScanDataError Tests
  // ==========================================================================

  describe('isScanDataError', () => {
    it('should return true for error objects', () => {
      const error: ScanDataError = {
        error: 'Something went wrong',
        exitCode: 1,
        stderr: 'Error output',
      };

      expect(isScanDataError(error)).toBe(true);
    });

    it('should return false for success results', () => {
      const result: SentinelDataScanResult = {
        summary: 'Scan completed',
        counts: {
          issues: { total: 5, open: 2, in_progress: 1, done: 1, blocked: 1 },
          epics: { total: 2, open: 1, in_progress: 0, done: 1, blocked: 0 },
          adrs: { total: 1 },
        },
      };

      expect(isScanDataError(result)).toBe(false);
    });

    it('should return false for result with optional fields', () => {
      const result: SentinelDataScanResult = {
        summary: 'Scan completed',
        counts: {
          issues: { total: 0, open: 0, in_progress: 0, done: 0, blocked: 0 },
          epics: { total: 0, open: 0, in_progress: 0, done: 0, blocked: 0 },
          adrs: { total: 0 },
        },
        orphans: {
          epics: ['EPIC-0001'],
          issues: [],
        },
        stale: {
          issues: ['ISS-0001'],
          epics: [],
        },
        validationWarnings: [
          { id: 'ISS-0002', message: 'Missing title' },
        ],
      };

      expect(isScanDataError(result)).toBe(false);
    });
  });
});
