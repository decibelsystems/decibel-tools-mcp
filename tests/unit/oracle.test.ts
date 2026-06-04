import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { nextActions, roadmapProgress, isOracleError } from '../../src/tools/oracle.js';
import { recordDesignDecision } from '../../src/tools/designer.js';
import { recordArchDecision } from '../../src/tools/architect.js';
import { createIssue } from '../../src/tools/sentinel.js';
import {
  createTestContext,
  cleanupTestContext,
  TestContext,
} from '../utils/test-context.js';
import '../utils/matchers.js';

describe('Oracle Tool', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext();
  });

  afterEach(async () => {
    await cleanupTestContext(ctx);
  });

  describe('nextActions', () => {
    it('should return empty project message when no files exist', async () => {
      const result = await nextActions({
        projectId: 'empty-project',
      });

      // nextActions now reads issues + epics via sentinel's own list_issues /
      // list_epics readers (PR #34), so the empty-state message accurately
      // names every empty domain rather than a vague "no recent activity".
      expect(result.actions).toHaveLength(1);
      expect(result.actions[0].description).toContain('No open issues, epics, friction, or recent decisions');
      expect(result.actions[0].priority).toBe('low');
    });

    it('should return actions from designer files', async () => {
      await recordDesignDecision({
        projectId: 'test-proj',
        area: 'API',
        summary: 'Use REST endpoints',
      });

      const result = await nextActions({
        projectId: 'test-proj',
      });

      expect(result.actions.length).toBeGreaterThan(0);
      expect(result.actions.some((a) => a.description.includes('design decision'))).toBe(
        true
      );
    });

    it('should return actions from architect files', async () => {
      await recordArchDecision({
        projectId: 'test-proj',
        change: 'Migrate to microservices',
        rationale: 'Better scalability',
      });

      const result = await nextActions({
        projectId: 'test-proj',
      });

      expect(result.actions.length).toBeGreaterThan(0);
      expect(result.actions.some((a) => a.description.includes('architecture'))).toBe(
        true
      );
    });

    it('should return actions from sentinel files', async () => {
      await createIssue({
        projectId: 'test-proj',
        severity: 'high',
        title: 'Critical bug',
        details: 'Something is broken',
      });

      const result = await nextActions({
        projectId: 'test-proj',
      });

      expect(result.actions.length).toBeGreaterThan(0);
      expect(result.actions.some((a) => a.description.includes('issue'))).toBe(true);
    });

    it('should prioritize high severity issues', async () => {
      await recordDesignDecision({
        projectId: 'proj',
        area: 'UI',
        summary: 'Design decision',
      });

      await createIssue({
        projectId: 'proj',
        severity: 'critical',
        title: 'Critical issue',
        details: 'Very important',
      });

      const result = await nextActions({
        projectId: 'proj',
      });

      // First action should be the critical issue
      expect(result.actions[0].priority).toBe('high');
      expect(result.actions[0].description).toContain('issue');
    });

    it('should assign medium priority to med severity issues', async () => {
      await createIssue({
        projectId: 'proj',
        severity: 'med',
        title: 'Medium severity issue',
        details: 'Details',
      });

      const result = await nextActions({
        projectId: 'proj',
      });

      const medIssue = result.actions.find((a) =>
        a.description.includes('Medium severity')
      );
      expect(medIssue).toBeDefined();
      expect(medIssue!.priority).toBe('med');
    });

    it('should return valid priorities for all actions', async () => {
      await recordDesignDecision({
        projectId: 'proj',
        area: 'Test',
        summary: 'Test decision',
      });

      await recordArchDecision({
        projectId: 'proj',
        change: 'Test change',
        rationale: 'Test rationale',
      });

      await createIssue({
        projectId: 'proj',
        severity: 'high',
        title: 'Test issue',
        details: 'Test details',
      });

      const result = await nextActions({
        projectId: 'proj',
      });

      for (const action of result.actions) {
        expect(action.priority).toBeValidPriority();
      }
    });

    it('should include source paths in actions', async () => {
      const designResult = await recordDesignDecision({
        projectId: 'proj',
        area: 'Test',
        summary: 'Test decision',
      });

      const result = await nextActions({
        projectId: 'proj',
      });

      expect(result.actions.some((a) => a.source === designResult.path)).toBe(true);
    });

    it('should filter by focus when provided', async () => {
      await recordDesignDecision({
        projectId: 'proj',
        area: 'UI',
        summary: 'Design decision',
      });

      const created = await createIssue({
        projectId: 'proj',
        severity: 'low',
        title: 'Issue',
        details: 'Details',
      });

      const result = await nextActions({
        projectId: 'proj',
        focus: 'sentinel',
      });

      // After PR #34, sentinel issues + epics come from sentinel's own readers
      // (not the recentFiles collector), so focus='sentinel' guarantees the
      // open issue is surfaced as a sentinel-domain action — but the focus
      // filter still falls back to all recentFiles when no domain-match is
      // found there, which can include a designer decision. Assert on what
      // PR #34 actually contracts: the issue appears as a sentinel action.
      const sentinelActions = result.actions.filter((a) => a.domain === 'sentinel');
      expect(sentinelActions.length).toBeGreaterThan(0);
      expect(sentinelActions.some((a) => a.source === created.id)).toBe(true);
    });

    it('should return max 7 actions', async () => {
      // Create many items
      for (let i = 0; i < 10; i++) {
        await recordDesignDecision({
          projectId: 'proj',
          area: `Area ${i}`,
          summary: `Decision ${i}`,
        });
      }

      const result = await nextActions({
        projectId: 'proj',
      });

      expect(result.actions.length).toBeLessThanOrEqual(7);
    });

    it('should return at least 3 actions when data exists', async () => {
      await recordDesignDecision({
        projectId: 'proj',
        area: 'A',
        summary: 'Decision A',
      });

      await recordArchDecision({
        projectId: 'proj',
        change: 'Change A',
        rationale: 'Rationale A',
      });

      await createIssue({
        projectId: 'proj',
        severity: 'low',
        title: 'Issue A',
        details: 'Details A',
      });

      const result = await nextActions({
        projectId: 'proj',
      });

      expect(result.actions.length).toBeGreaterThanOrEqual(3);
    });

    it('should sort actions by priority', async () => {
      await recordDesignDecision({
        projectId: 'proj',
        area: 'UI',
        summary: 'Low priority design',
      });

      await createIssue({
        projectId: 'proj',
        severity: 'critical',
        title: 'High priority issue',
        details: 'Critical bug',
      });

      await recordArchDecision({
        projectId: 'proj',
        change: 'Medium priority arch',
        rationale: 'Needed change',
      });

      const result = await nextActions({
        projectId: 'proj',
      });

      // Verify sorted by priority (high -> med -> low)
      const priorities = result.actions.map((a) => a.priority);
      const priorityOrder = { high: 0, med: 1, low: 2 };
      for (let i = 1; i < priorities.length; i++) {
        expect(priorityOrder[priorities[i]]).toBeGreaterThanOrEqual(
          priorityOrder[priorities[i - 1]]
        );
      }
    });

    it('should handle focus filter with no matches gracefully', async () => {
      await recordDesignDecision({
        projectId: 'proj',
        area: 'UI',
        summary: 'Only design decision',
      });

      const result = await nextActions({
        projectId: 'proj',
        focus: 'nonexistent-keyword',
      });

      // Should fall back to all files
      expect(result.actions.length).toBeGreaterThan(0);
    });
  });

  // ============================================================================
  // ISS-0110: roadmap reporting bug fixes
  // ============================================================================

  describe('roadmapProgress — ISS-0110 fixes', () => {
    async function writeRoadmap(content: string): Promise<void> {
      const dir = path.join(ctx.rootDir, '.decibel', 'architect', 'roadmap');
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'roadmap.yaml'), content, 'utf-8');
    }

    async function writeEpic(id: string, status: string): Promise<void> {
      const dir = path.join(ctx.rootDir, '.decibel', 'sentinel', 'epics');
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        path.join(dir, `${id}-test.md`),
        `---\nid: ${id}\nstatus: ${status}\n---\n# ${id}\n`,
        'utf-8'
      );
    }

    it('bug 1: maps sentinel "shipped" status to completed', async () => {
      await writeEpic('EPIC-0001', 'shipped');
      await writeEpic('EPIC-0002', 'shipped');
      await writeRoadmap(`
objectives: []
themes: []
milestones:
  - id: M-0001
    label: Test
    target_date: 2026-01-01
    epics: [EPIC-0001, EPIC-0002]
epic_context:
  EPIC-0001: { epic_id: EPIC-0001, milestone: M-0001, work_type: feature }
  EPIC-0002: { epic_id: EPIC-0002, milestone: M-0001, work_type: feature }
`);

      const result = await roadmapProgress({ projectId: 'proj', dryRun: true });
      if (isOracleError(result)) throw new Error(`unexpected error: ${result.message}`);

      expect(result.epics).toHaveLength(2);
      expect(result.epics.every(e => e.status === 'completed')).toBe(true);
      expect(result.milestones[0].epics_completed).toBe(2);
      expect(result.milestones[0].progress_percent).toBe(100);
      expect(result.milestones[0].status).toBe('completed');
    });

    it('bug 1: maps on_hold to blocked', async () => {
      await writeEpic('EPIC-0001', 'on_hold');
      await writeRoadmap(`
objectives: []
themes: []
milestones:
  - id: M-0001
    label: Test
    target_date: 2026-12-01
    epics: [EPIC-0001]
epic_context:
  EPIC-0001: { epic_id: EPIC-0001, milestone: M-0001, work_type: feature }
`);

      const result = await roadmapProgress({ projectId: 'proj', dryRun: true });
      if (isOracleError(result)) throw new Error(`unexpected error: ${result.message}`);
      expect(result.epics[0].status).toBe('blocked');
    });

    it('bug 2: milestone.status=shipped overrides date-based classification', async () => {
      // Past target date but milestone declares shipped — should be completed,
      // not "behind".
      await writeEpic('EPIC-0001', 'in_progress');  // would otherwise read as in_progress
      await writeRoadmap(`
objectives: []
themes: []
milestones:
  - id: M-0001
    label: Past-dated shipped milestone
    target_date: 2020-01-01
    status: shipped
    epics: [EPIC-0001]
epic_context:
  EPIC-0001: { epic_id: EPIC-0001, milestone: M-0001, work_type: feature }
`);

      const result = await roadmapProgress({ projectId: 'proj', dryRun: true });
      if (isOracleError(result)) throw new Error(`unexpected error: ${result.message}`);
      expect(result.milestones[0].status).toBe('completed');
    });

    it('bug 4: surfaces a warning when a shadow .decibel/roadmap.yml exists', async () => {
      await writeRoadmap('objectives: []\nthemes: []\nmilestones: []\nepic_context: {}\n');
      // Shadow at .decibel/roadmap.yml
      await fs.writeFile(
        path.join(ctx.rootDir, '.decibel', 'roadmap.yml'),
        'shadow: true\n',
        'utf-8'
      );

      const result = await roadmapProgress({ projectId: 'proj', dryRun: true });
      if (isOracleError(result)) throw new Error(`unexpected error: ${result.message}`);
      expect(result.warnings).toBeDefined();
      expect(result.warnings!.some(w => w.includes('Shadow roadmap detected'))).toBe(true);
    });
  });
});
