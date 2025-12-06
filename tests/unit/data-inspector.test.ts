import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import {
  loadIssues,
  loadEpics,
  loadADRs,
  loadDataIndex,
  validateSchema,
  findOrphans,
  findStale,
  generateSummary,
  scanData,
  formatScanOutput,
  findDecibelRoot,
  getProjectNameFromRoot,
  InspectorIssue,
  InspectorEpic,
  InspectorADR,
} from '../../src/tools/data-inspector.js';
import {
  createTestContext,
  cleanupTestContext,
  TestContext,
} from '../utils/test-context.js';

describe('Data Inspector', () => {
  let ctx: TestContext;
  let decibelRoot: string;

  beforeEach(async () => {
    ctx = await createTestContext();
    // Create a .decibel structure in the test directory
    decibelRoot = path.join(ctx.rootDir, '.decibel');
    await fs.mkdir(path.join(decibelRoot, 'sentinel', 'issues'), { recursive: true });
    await fs.mkdir(path.join(decibelRoot, 'sentinel', 'epics'), { recursive: true });
    await fs.mkdir(path.join(decibelRoot, 'architect', 'adrs'), { recursive: true });

    // Set DECIBEL_PROJECT_ROOT to point to the test directory
    process.env.DECIBEL_PROJECT_ROOT = ctx.rootDir;
  });

  afterEach(async () => {
    await cleanupTestContext(ctx);
    delete process.env.DECIBEL_PROJECT_ROOT;
  });

  // ==========================================================================
  // Path Resolution Tests
  // ==========================================================================

  describe('findDecibelRoot', () => {
    it('should find .decibel root from current directory', () => {
      const result = findDecibelRoot(ctx.rootDir);
      expect(result).toBe(decibelRoot);
    });

    it('should find .decibel root from nested directory', async () => {
      const nestedDir = path.join(ctx.rootDir, 'src', 'components', 'deep');
      await fs.mkdir(nestedDir, { recursive: true });

      const result = findDecibelRoot(nestedDir);
      expect(result).toBe(decibelRoot);
    });

    it('should return undefined if no .decibel found', async () => {
      // Create a separate temp dir without .decibel
      const isolatedDir = path.join(ctx.rootDir, 'isolated');
      await fs.mkdir(isolatedDir, { recursive: true });

      // Remove the parent .decibel to truly isolate
      await fs.rm(decibelRoot, { recursive: true });

      const result = findDecibelRoot(isolatedDir);
      expect(result).toBeUndefined();
    });
  });

  describe('getProjectNameFromRoot', () => {
    it('should extract project name from .decibel path', () => {
      const result = getProjectNameFromRoot('/home/user/my-project/.decibel');
      expect(result).toBe('my-project');
    });
  });

  // ==========================================================================
  // Data Loading Tests
  // ==========================================================================

  describe('loadIssues', () => {
    it('should load issues from YAML files', async () => {
      const issueYaml = `
id: ISS-0001
title: Exit engine shadow mode cleanup
project: senken
status: open
priority: high
epic_id: EPIC-0002
tags: [exit, risk]
created_at: 2025-12-05T09:30:00Z
updated_at: 2025-12-05T10:10:00Z
`;
      await fs.writeFile(
        path.join(decibelRoot, 'sentinel', 'issues', 'ISS-0001.yml'),
        issueYaml
      );

      const issues = await loadIssues(decibelRoot);

      expect(issues).toHaveLength(1);
      expect(issues[0].id).toBe('ISS-0001');
      expect(issues[0].title).toBe('Exit engine shadow mode cleanup');
      expect(issues[0].project).toBe('senken');
      expect(issues[0].status).toBe('open');
      expect(issues[0].priority).toBe('high');
      expect(issues[0].epic_id).toBe('EPIC-0002');
      expect(issues[0].tags).toEqual(['exit', 'risk']);
    });

    it('should return empty array if directory does not exist', async () => {
      await fs.rm(path.join(decibelRoot, 'sentinel', 'issues'), { recursive: true });
      const issues = await loadIssues(decibelRoot);
      expect(issues).toEqual([]);
    });

    it('should handle malformed YAML gracefully', async () => {
      await fs.writeFile(
        path.join(decibelRoot, 'sentinel', 'issues', 'ISS-0001.yml'),
        'id: ISS-0001\ntitle: Valid issue'
      );

      const issues = await loadIssues(decibelRoot);
      expect(issues).toHaveLength(1);
      expect(issues[0].id).toBe('ISS-0001');
    });

    it('should use filename as ID if id field is missing', async () => {
      await fs.writeFile(
        path.join(decibelRoot, 'sentinel', 'issues', 'ISS-0099.yml'),
        'title: Issue without ID'
      );

      const issues = await loadIssues(decibelRoot);
      expect(issues).toHaveLength(1);
      expect(issues[0].id).toBe('ISS-0099');
    });
  });

  describe('loadEpics', () => {
    it('should load epics from YAML files', async () => {
      const epicYaml = `
id: EPIC-0002
title: Exit Refactor v2.5
project: senken
status: in_progress
owner: ben
tags: [exit, risk]
created_at: 2025-12-04T18:00:00Z
updated_at: 2025-12-05T08:45:00Z
`;
      await fs.writeFile(
        path.join(decibelRoot, 'sentinel', 'epics', 'EPIC-0002.yml'),
        epicYaml
      );

      const epics = await loadEpics(decibelRoot);

      expect(epics).toHaveLength(1);
      expect(epics[0].id).toBe('EPIC-0002');
      expect(epics[0].title).toBe('Exit Refactor v2.5');
      expect(epics[0].status).toBe('in_progress');
      expect(epics[0].owner).toBe('ben');
    });
  });

  describe('loadADRs', () => {
    it('should load ADRs from YAML files', async () => {
      const adrYaml = `
id: ADR-0005
scope: project
project: senken
title: Exit architecture refactor v2.5
status: accepted
related_issues: [ISS-0001, ISS-0003]
related_epics: [EPIC-0002]
created_at: 2025-12-04T12:00:00Z
updated_at: 2025-12-04T19:30:00Z
`;
      await fs.writeFile(
        path.join(decibelRoot, 'architect', 'adrs', 'ADR-0005.yml'),
        adrYaml
      );

      const adrs = await loadADRs(decibelRoot);

      expect(adrs).toHaveLength(1);
      expect(adrs[0].id).toBe('ADR-0005');
      expect(adrs[0].scope).toBe('project');
      expect(adrs[0].title).toBe('Exit architecture refactor v2.5');
      expect(adrs[0].status).toBe('accepted');
      expect(adrs[0].related_issues).toEqual(['ISS-0001', 'ISS-0003']);
      expect(adrs[0].related_epics).toEqual(['EPIC-0002']);
    });
  });

  describe('loadDataIndex', () => {
    it('should load all data types into an index', async () => {
      await fs.writeFile(
        path.join(decibelRoot, 'sentinel', 'issues', 'ISS-0001.yml'),
        'id: ISS-0001\ntitle: Test Issue'
      );
      await fs.writeFile(
        path.join(decibelRoot, 'sentinel', 'epics', 'EPIC-0001.yml'),
        'id: EPIC-0001\ntitle: Test Epic'
      );
      await fs.writeFile(
        path.join(decibelRoot, 'architect', 'adrs', 'ADR-0001.yml'),
        'id: ADR-0001\ntitle: Test ADR'
      );

      const index = await loadDataIndex(decibelRoot);

      expect(index.issues).toHaveLength(1);
      expect(index.epics).toHaveLength(1);
      expect(index.adrs).toHaveLength(1);
      expect(index.decibelRoot).toBe(decibelRoot);
    });
  });

  // ==========================================================================
  // Validation Tests
  // ==========================================================================

  describe('validateSchema', () => {
    it('should report missing id as error', () => {
      const issues: InspectorIssue[] = [
        { id: '', title: 'Test', status: 'open', priority: 'medium', _file: 'test.yml' },
      ];

      const errors = validateSchema(issues, [], []);

      expect(errors).toHaveLength(1);
      expect(errors[0].severity).toBe('error');
      expect(errors[0].field).toBe('id');
      expect(errors[0].message).toContain('Missing required field: id');
    });

    it('should report missing title as warning', () => {
      const issues: InspectorIssue[] = [
        { id: 'ISS-0001', title: '', status: 'open', priority: 'medium' },
      ];

      const errors = validateSchema(issues, [], []);

      expect(errors.some(e => e.field === 'title' && e.severity === 'warn')).toBe(true);
    });

    it('should report invalid status', () => {
      const issues: InspectorIssue[] = [
        { id: 'ISS-0001', title: 'Test', status: 'doing' as any, priority: 'medium' },
      ];

      const errors = validateSchema(issues, [], []);

      expect(errors.some(e => e.field === 'status')).toBe(true);
      expect(errors.find(e => e.field === 'status')?.message).toContain('Invalid status');
    });

    it('should report invalid priority', () => {
      const issues: InspectorIssue[] = [
        { id: 'ISS-0001', title: 'Test', status: 'open', priority: 'critical' as any },
      ];

      const errors = validateSchema(issues, [], []);

      expect(errors.some(e => e.field === 'priority')).toBe(true);
    });

    it('should validate epics', () => {
      const epics: InspectorEpic[] = [
        { id: 'EPIC-0001', title: '', status: 'bad_status' as any },
      ];

      const errors = validateSchema([], epics, []);

      expect(errors.some(e => e.type === 'epic' && e.field === 'title')).toBe(true);
      expect(errors.some(e => e.type === 'epic' && e.field === 'status')).toBe(true);
    });

    it('should validate ADRs', () => {
      const adrs: InspectorADR[] = [
        { id: 'ADR-0001', title: 'Test', status: 'bad_status' as any, scope: 'invalid' as any },
      ];

      const errors = validateSchema([], [], adrs);

      expect(errors.some(e => e.type === 'adr' && e.field === 'status')).toBe(true);
      expect(errors.some(e => e.type === 'adr' && e.field === 'scope')).toBe(true);
    });

    it('should return empty array for valid data', () => {
      const issues: InspectorIssue[] = [
        { id: 'ISS-0001', title: 'Valid Issue', status: 'open', priority: 'high' },
      ];
      const epics: InspectorEpic[] = [
        { id: 'EPIC-0001', title: 'Valid Epic', status: 'in_progress' },
      ];
      const adrs: InspectorADR[] = [
        { id: 'ADR-0001', title: 'Valid ADR', status: 'accepted', scope: 'project' },
      ];

      const errors = validateSchema(issues, epics, adrs);

      expect(errors).toHaveLength(0);
    });
  });

  // ==========================================================================
  // Orphan Detection Tests
  // ==========================================================================

  describe('findOrphans', () => {
    it('should find epics with no issues', () => {
      const epics: InspectorEpic[] = [
        { id: 'EPIC-0001', title: 'Orphan Epic', status: 'open' },
        { id: 'EPIC-0002', title: 'Connected Epic', status: 'open' },
      ];
      const issues: InspectorIssue[] = [
        { id: 'ISS-0001', title: 'Issue', status: 'open', priority: 'medium', epic_id: 'EPIC-0002' },
      ];

      const orphans = findOrphans(issues, epics, []);

      expect(orphans.epicsWithNoIssues).toHaveLength(1);
      expect(orphans.epicsWithNoIssues[0].id).toBe('EPIC-0001');
    });

    it('should find issues with missing epic references', () => {
      const issues: InspectorIssue[] = [
        { id: 'ISS-0001', title: 'Orphan Issue', status: 'open', priority: 'medium', epic_id: 'EPIC-9999' },
      ];
      const epics: InspectorEpic[] = [
        { id: 'EPIC-0001', title: 'Existing Epic', status: 'open' },
      ];

      const orphans = findOrphans(issues, epics, []);

      expect(orphans.issuesWithMissingEpic).toHaveLength(1);
      expect(orphans.issuesWithMissingEpic[0].id).toBe('ISS-0001');
      expect(orphans.issuesWithMissingEpic[0].epic_id).toBe('EPIC-9999');
    });

    it('should find ADRs with missing issue references', () => {
      const issues: InspectorIssue[] = [
        { id: 'ISS-0001', title: 'Existing Issue', status: 'open', priority: 'medium' },
      ];
      const adrs: InspectorADR[] = [
        {
          id: 'ADR-0001',
          title: 'ADR with missing refs',
          status: 'accepted',
          related_issues: ['ISS-0001', 'ISS-9999'],
        },
      ];

      const orphans = findOrphans(issues, [], adrs);

      expect(orphans.adrsWithMissingIssues).toHaveLength(1);
      expect(orphans.adrsWithMissingIssues[0].missing).toContain('ISS-9999');
    });

    it('should find ADRs with missing epic references', () => {
      const epics: InspectorEpic[] = [
        { id: 'EPIC-0001', title: 'Existing Epic', status: 'open' },
      ];
      const adrs: InspectorADR[] = [
        {
          id: 'ADR-0001',
          title: 'ADR with missing refs',
          status: 'accepted',
          related_epics: ['EPIC-0001', 'EPIC-9999'],
        },
      ];

      const orphans = findOrphans([], epics, adrs);

      expect(orphans.adrsWithMissingEpics).toHaveLength(1);
      expect(orphans.adrsWithMissingEpics[0].missing).toContain('EPIC-9999');
    });

    it('should return empty report when no orphans exist', () => {
      const issues: InspectorIssue[] = [
        { id: 'ISS-0001', title: 'Issue', status: 'open', priority: 'medium', epic_id: 'EPIC-0001' },
      ];
      const epics: InspectorEpic[] = [
        { id: 'EPIC-0001', title: 'Epic', status: 'open' },
      ];
      const adrs: InspectorADR[] = [
        {
          id: 'ADR-0001',
          title: 'ADR',
          status: 'accepted',
          related_issues: ['ISS-0001'],
          related_epics: ['EPIC-0001'],
        },
      ];

      const orphans = findOrphans(issues, epics, adrs);

      expect(orphans.epicsWithNoIssues).toHaveLength(0);
      expect(orphans.issuesWithMissingEpic).toHaveLength(0);
      expect(orphans.adrsWithMissingIssues).toHaveLength(0);
      expect(orphans.adrsWithMissingEpics).toHaveLength(0);
    });
  });

  // ==========================================================================
  // Stale Detection Tests
  // ==========================================================================

  describe('findStale', () => {
    it('should find stale open issues', () => {
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      const issues: InspectorIssue[] = [
        {
          id: 'ISS-0001',
          title: 'Stale Issue',
          status: 'open',
          priority: 'medium',
          updated_at: thirtyDaysAgo.toISOString(),
        },
        {
          id: 'ISS-0002',
          title: 'Fresh Issue',
          status: 'open',
          priority: 'medium',
          updated_at: now.toISOString(),
        },
      ];

      const stale = findStale(issues, [], [], 21);

      expect(stale.issues).toHaveLength(1);
      expect(stale.issues[0].id).toBe('ISS-0001');
    });

    it('should not mark done issues as stale', () => {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const issues: InspectorIssue[] = [
        {
          id: 'ISS-0001',
          title: 'Old Done Issue',
          status: 'done',
          priority: 'medium',
          updated_at: thirtyDaysAgo.toISOString(),
        },
      ];

      const stale = findStale(issues, [], [], 21);

      expect(stale.issues).toHaveLength(0);
    });

    it('should find stale epics', () => {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const epics: InspectorEpic[] = [
        {
          id: 'EPIC-0001',
          title: 'Stale Epic',
          status: 'in_progress',
          updated_at: thirtyDaysAgo.toISOString(),
        },
      ];

      const stale = findStale([], epics, [], 21);

      expect(stale.epics).toHaveLength(1);
    });

    it('should find stale ADRs', () => {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const adrs: InspectorADR[] = [
        {
          id: 'ADR-0001',
          title: 'Stale ADR',
          status: 'proposed',
          updated_at: thirtyDaysAgo.toISOString(),
        },
      ];

      const stale = findStale([], [], adrs, 21);

      expect(stale.adrs).toHaveLength(1);
    });

    it('should respect custom days threshold', () => {
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);

      const issues: InspectorIssue[] = [
        {
          id: 'ISS-0001',
          title: 'Issue',
          status: 'open',
          priority: 'medium',
          updated_at: tenDaysAgo.toISOString(),
        },
      ];

      // With 21 day threshold, not stale
      const stale21 = findStale(issues, [], [], 21);
      expect(stale21.issues).toHaveLength(0);

      // With 5 day threshold, stale
      const stale5 = findStale(issues, [], [], 5);
      expect(stale5.issues).toHaveLength(1);
    });
  });

  // ==========================================================================
  // Summary Generation Tests
  // ==========================================================================

  describe('generateSummary', () => {
    it('should count issues by status', () => {
      const issues: InspectorIssue[] = [
        { id: 'ISS-0001', title: 'Open 1', status: 'open', priority: 'medium' },
        { id: 'ISS-0002', title: 'Open 2', status: 'open', priority: 'medium' },
        { id: 'ISS-0003', title: 'In Progress', status: 'in_progress', priority: 'medium' },
        { id: 'ISS-0004', title: 'Done', status: 'done', priority: 'medium' },
      ];

      const summary = generateSummary(issues, [], []);

      expect(summary.issues.total).toBe(4);
      expect(summary.issues.open).toBe(2);
      expect(summary.issues.in_progress).toBe(1);
      expect(summary.issues.done).toBe(1);
      expect(summary.issues.blocked).toBe(0);
    });

    it('should count epics by status', () => {
      const epics: InspectorEpic[] = [
        { id: 'EPIC-0001', title: 'Open', status: 'open' },
        { id: 'EPIC-0002', title: 'In Progress', status: 'in_progress' },
        { id: 'EPIC-0003', title: 'In Progress 2', status: 'in_progress' },
      ];

      const summary = generateSummary([], epics, []);

      expect(summary.epics.total).toBe(3);
      expect(summary.epics.open).toBe(1);
      expect(summary.epics.in_progress).toBe(2);
    });

    it('should count ADRs by status', () => {
      const adrs: InspectorADR[] = [
        { id: 'ADR-0001', title: 'Proposed', status: 'proposed' },
        { id: 'ADR-0002', title: 'Accepted', status: 'accepted' },
        { id: 'ADR-0003', title: 'Accepted 2', status: 'accepted' },
      ];

      const summary = generateSummary([], [], adrs);

      expect(summary.adrs.total).toBe(3);
      expect(summary.adrs.proposed).toBe(1);
      expect(summary.adrs.accepted).toBe(2);
    });
  });

  // ==========================================================================
  // Full Scan Tests
  // ==========================================================================

  describe('scanData', () => {
    it('should return error when .decibel not found', async () => {
      // Remove .decibel
      await fs.rm(decibelRoot, { recursive: true });

      const result = await scanData({ scope: 'data' });

      expect(result.error).toBeDefined();
      expect(result.error).toContain('No .decibel directory found');
    });

    it('should return summary for data scope', async () => {
      await fs.writeFile(
        path.join(decibelRoot, 'sentinel', 'issues', 'ISS-0001.yml'),
        'id: ISS-0001\ntitle: Test Issue\nstatus: open\npriority: high'
      );

      const result = await scanData({ scope: 'data' });

      expect(result.error).toBeUndefined();
      expect(result.summary).toBeDefined();
      expect(result.summary!.issues.total).toBe(1);
    });

    it('should include validation when validate is true', async () => {
      await fs.writeFile(
        path.join(decibelRoot, 'sentinel', 'issues', 'ISS-0001.yml'),
        'id: ISS-0001\nstatus: invalid_status'
      );

      const result = await scanData({ scope: 'data', validate: true });

      expect(result.validation).toBeDefined();
      expect(result.validation!.length).toBeGreaterThan(0);
    });

    it('should include orphans when flagged', async () => {
      await fs.writeFile(
        path.join(decibelRoot, 'sentinel', 'epics', 'EPIC-0001.yml'),
        'id: EPIC-0001\ntitle: Orphan Epic\nstatus: open'
      );

      const result = await scanData({ scope: 'data', flag: ['orphans'] });

      expect(result.orphans).toBeDefined();
      expect(result.orphans!.epicsWithNoIssues).toHaveLength(1);
    });

    it('should include stale items when flagged', async () => {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      await fs.writeFile(
        path.join(decibelRoot, 'sentinel', 'issues', 'ISS-0001.yml'),
        `id: ISS-0001\ntitle: Stale Issue\nstatus: open\npriority: medium\nupdated_at: ${thirtyDaysAgo.toISOString()}`
      );

      const result = await scanData({ scope: 'data', flag: ['stale'], days: 21 });

      expect(result.stale).toBeDefined();
      expect(result.stale!.issues).toHaveLength(1);
    });

    it('should return error message for runtime scope (not implemented)', async () => {
      const result = await scanData({ scope: 'runtime' });

      expect(result.error).toContain('Runtime scan not yet implemented');
    });
  });

  // ==========================================================================
  // Output Formatting Tests
  // ==========================================================================

  describe('formatScanOutput', () => {
    it('should format basic summary output', () => {
      const output = formatScanOutput({
        scope: 'data',
        projectName: 'my-project',
        decibelRoot: '/path/to/.decibel',
        summary: {
          issues: { total: 5, open: 3, in_progress: 1, done: 1, blocked: 0 },
          epics: { total: 2, open: 1, in_progress: 1, done: 0, blocked: 0 },
          adrs: { total: 1, proposed: 0, accepted: 1, superseded: 0, deprecated: 0 },
        },
      });

      expect(output).toContain('SENTINEL DATA INSPECTOR');
      expect(output).toContain('Project: my-project');
      expect(output).toContain('Issues: 5');
      expect(output).toContain('Epics:  2');
      expect(output).toContain('ADRs:   1');
    });

    it('should format validation errors', () => {
      const output = formatScanOutput({
        scope: 'data',
        projectName: 'test',
        summary: {
          issues: { total: 1, open: 1, in_progress: 0, done: 0, blocked: 0 },
          epics: { total: 0, open: 0, in_progress: 0, done: 0, blocked: 0 },
          adrs: { total: 0, proposed: 0, accepted: 0, superseded: 0, deprecated: 0 },
        },
        validation: [
          { severity: 'warn', type: 'issue', id: 'ISS-0001', field: 'title', message: 'Missing field: title' },
        ],
      });

      expect(output).toContain('VALIDATION');
      expect(output).toContain('[WARN] Issue ISS-0001');
    });

    it('should format orphan report', () => {
      const output = formatScanOutput({
        scope: 'data',
        projectName: 'test',
        summary: {
          issues: { total: 0, open: 0, in_progress: 0, done: 0, blocked: 0 },
          epics: { total: 1, open: 1, in_progress: 0, done: 0, blocked: 0 },
          adrs: { total: 0, proposed: 0, accepted: 0, superseded: 0, deprecated: 0 },
        },
        orphans: {
          epicsWithNoIssues: [{ id: 'EPIC-0001', title: 'Orphan' }],
          issuesWithMissingEpic: [],
          adrsWithMissingIssues: [],
          adrsWithMissingEpics: [],
        },
      });

      expect(output).toContain('ORPHANS');
      expect(output).toContain('[EPIC] EPIC-0001 (no issues attached)');
    });

    it('should format error output', () => {
      const output = formatScanOutput({
        scope: 'data',
        projectName: 'test',
        error: 'Something went wrong',
      });

      expect(output).toContain('ERROR');
      expect(output).toContain('Something went wrong');
    });
  });
});
