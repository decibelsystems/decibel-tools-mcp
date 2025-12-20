import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { nextActions } from '../../src/tools/oracle.js';
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
        project_id: 'empty-project',
      });

      expect(result.actions).toHaveLength(1);
      expect(result.actions[0].description).toContain('No recent activity');
      expect(result.actions[0].priority).toBe('low');
    });

    it('should return actions from designer files', async () => {
      await recordDesignDecision({
        project_id: 'test-proj',
        area: 'API',
        summary: 'Use REST endpoints',
      });

      const result = await nextActions({
        project_id: 'test-proj',
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
        project_id: 'test-proj',
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
        project_id: 'test-proj',
      });

      expect(result.actions.length).toBeGreaterThan(0);
      expect(result.actions.some((a) => a.description.includes('issue'))).toBe(true);
    });

    it('should prioritize high severity issues', async () => {
      await recordDesignDecision({
        project_id: 'proj',
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
        project_id: 'proj',
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
        project_id: 'proj',
      });

      const medIssue = result.actions.find((a) =>
        a.description.includes('Medium severity')
      );
      expect(medIssue).toBeDefined();
      expect(medIssue!.priority).toBe('med');
    });

    it('should return valid priorities for all actions', async () => {
      await recordDesignDecision({
        project_id: 'proj',
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
        project_id: 'proj',
      });

      for (const action of result.actions) {
        expect(action.priority).toBeValidPriority();
      }
    });

    it('should include source paths in actions', async () => {
      const designResult = await recordDesignDecision({
        project_id: 'proj',
        area: 'Test',
        summary: 'Test decision',
      });

      const result = await nextActions({
        project_id: 'proj',
      });

      expect(result.actions.some((a) => a.source === designResult.path)).toBe(true);
    });

    it('should filter by focus when provided', async () => {
      await recordDesignDecision({
        project_id: 'proj',
        area: 'UI',
        summary: 'Design decision',
      });

      await createIssue({
        projectId: 'proj',
        severity: 'low',
        title: 'Issue',
        details: 'Details',
      });

      const result = await nextActions({
        project_id: 'proj',
        focus: 'sentinel',
      });

      // Should only have sentinel actions
      expect(result.actions.every((a) => a.description.includes('issue'))).toBe(true);
    });

    it('should return max 7 actions', async () => {
      // Create many items
      for (let i = 0; i < 10; i++) {
        await recordDesignDecision({
          project_id: 'proj',
          area: `Area ${i}`,
          summary: `Decision ${i}`,
        });
      }

      const result = await nextActions({
        project_id: 'proj',
      });

      expect(result.actions.length).toBeLessThanOrEqual(7);
    });

    it('should return at least 3 actions when data exists', async () => {
      await recordDesignDecision({
        project_id: 'proj',
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
        project_id: 'proj',
      });

      expect(result.actions.length).toBeGreaterThanOrEqual(3);
    });

    it('should sort actions by priority', async () => {
      await recordDesignDecision({
        project_id: 'proj',
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
        project_id: 'proj',
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
        project_id: 'proj',
        area: 'UI',
        summary: 'Only design decision',
      });

      const result = await nextActions({
        project_id: 'proj',
        focus: 'nonexistent-keyword',
      });

      // Should fall back to all files
      expect(result.actions.length).toBeGreaterThan(0);
    });
  });
});
