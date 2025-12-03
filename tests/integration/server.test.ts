import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createTestContext,
  cleanupTestContext,
  TestContext,
} from '../utils/test-context.js';
import { createTestMcpClient, TestMcpClient } from '../utils/mcp-test-client.js';
import '../utils/matchers.js';

describe('MCP Server Integration', () => {
  let ctx: TestContext;
  let client: TestMcpClient;

  beforeEach(async () => {
    ctx = await createTestContext();
    client = await createTestMcpClient();
  });

  afterEach(async () => {
    await client.close();
    await cleanupTestContext(ctx);
  });

  describe('ListTools', () => {
    it('should list all four tools', async () => {
      const tools = await client.listTools();

      expect(tools).toHaveLength(4);
      expect(tools.map((t) => t.name)).toEqual(
        expect.arrayContaining([
          'designer.record_design_decision',
          'architect.record_arch_decision',
          'sentinel.create_issue',
          'oracle.next_actions',
        ])
      );
    });

    it('should include descriptions for all tools', async () => {
      const tools = await client.listTools();

      for (const tool of tools) {
        expect(tool.description).toBeTruthy();
        expect(typeof tool.description).toBe('string');
      }
    });
  });

  describe('Designer Tool via MCP', () => {
    it('should execute record_design_decision successfully', async () => {
      const result = await client.callTool('designer.record_design_decision', {
        project_id: 'test-project',
        area: 'API',
        summary: 'Use REST',
        details: 'REST is simpler',
      });

      expect(result.isError).toBeFalsy();
      expect(result.content).toHaveLength(1);

      const response = JSON.parse(result.content[0].text);
      expect(response.id).toMatch(/\.md$/);
      expect(response.timestamp).toBeValidTimestamp();
      expect(response.path).toContain('designer');
    });

    it('should return error for missing required fields', async () => {
      const result = await client.callTool('designer.record_design_decision', {
        project_id: 'test',
        // missing area and summary
      });

      expect(result.isError).toBe(true);
      const response = JSON.parse(result.content[0].text);
      expect(response.error).toBeTruthy();
    });
  });

  describe('Architect Tool via MCP', () => {
    it('should execute record_arch_decision successfully', async () => {
      const result = await client.callTool('architect.record_arch_decision', {
        system_id: 'main-system',
        change: 'Add caching',
        rationale: 'Improve performance',
      });

      expect(result.isError).toBeFalsy();

      const response = JSON.parse(result.content[0].text);
      expect(response.id).toMatch(/\.md$/);
      expect(response.timestamp).toBeValidTimestamp();
      expect(response.path).toContain('architect');
    });

    it('should return error for missing required fields', async () => {
      const result = await client.callTool('architect.record_arch_decision', {
        system_id: 'test',
        change: 'Test change',
        // missing rationale
      });

      expect(result.isError).toBe(true);
    });
  });

  describe('Sentinel Tool via MCP', () => {
    it('should execute create_issue successfully', async () => {
      const result = await client.callTool('sentinel.create_issue', {
        repo: 'test-repo',
        severity: 'high',
        title: 'Bug found',
        details: 'Description of bug',
      });

      expect(result.isError).toBeFalsy();

      const response = JSON.parse(result.content[0].text);
      expect(response.id).toMatch(/\.md$/);
      expect(response.timestamp).toBeValidTimestamp();
      expect(response.path).toContain('sentinel');
      expect(response.status).toBe('open');
    });

    it('should return error for invalid severity', async () => {
      const result = await client.callTool('sentinel.create_issue', {
        repo: 'test',
        severity: 'invalid',
        title: 'Test',
        details: 'Test',
      });

      expect(result.isError).toBe(true);
    });

    it('should accept all valid severity levels', async () => {
      for (const severity of ['low', 'med', 'high', 'critical']) {
        const result = await client.callTool('sentinel.create_issue', {
          repo: 'test',
          severity,
          title: `Test ${severity}`,
          details: 'Test details',
        });

        expect(result.isError).toBeFalsy();
      }
    });
  });

  describe('Oracle Tool via MCP', () => {
    it('should execute next_actions successfully', async () => {
      const result = await client.callTool('oracle.next_actions', {
        project_id: 'test-project',
      });

      expect(result.isError).toBeFalsy();

      const response = JSON.parse(result.content[0].text);
      expect(response.actions).toBeDefined();
      expect(Array.isArray(response.actions)).toBe(true);
    });

    it('should return actions based on existing data', async () => {
      // First create some data
      await client.callTool('designer.record_design_decision', {
        project_id: 'proj',
        area: 'Test',
        summary: 'Test decision',
      });

      // Then get actions
      const result = await client.callTool('oracle.next_actions', {
        project_id: 'proj',
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.actions.length).toBeGreaterThan(0);
    });

    it('should support focus parameter', async () => {
      // Create sentinel issue
      await client.callTool('sentinel.create_issue', {
        repo: 'proj',
        severity: 'low',
        title: 'Test issue',
        details: 'Details',
      });

      const result = await client.callTool('oracle.next_actions', {
        project_id: 'proj',
        focus: 'sentinel',
      });

      expect(result.isError).toBeFalsy();
      const response = JSON.parse(result.content[0].text);
      expect(response.actions).toBeDefined();
    });

    it('should return error for missing project_id', async () => {
      const result = await client.callTool('oracle.next_actions', {});

      expect(result.isError).toBe(true);
    });
  });

  describe('Unknown Tool Handling', () => {
    it('should return error for unknown tool', async () => {
      const result = await client.callTool('unknown.tool', {});

      expect(result.isError).toBe(true);
      const response = JSON.parse(result.content[0].text);
      expect(response.error).toContain('Unknown tool');
    });
  });

  describe('Cross-Tool Integration', () => {
    it('should allow oracle to see data from all other tools', async () => {
      const projectId = 'integrated-project';

      // Create data from each tool
      await client.callTool('designer.record_design_decision', {
        project_id: projectId,
        area: 'API',
        summary: 'Design decision',
      });

      await client.callTool('architect.record_arch_decision', {
        system_id: projectId,
        change: 'Architecture change',
        rationale: 'Good reasons',
      });

      await client.callTool('sentinel.create_issue', {
        repo: projectId,
        severity: 'high',
        title: 'Important issue',
        details: 'Details here',
      });

      // Oracle should see all
      const result = await client.callTool('oracle.next_actions', {
        project_id: projectId,
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.actions.length).toBeGreaterThanOrEqual(3);

      // Should have actions from different sources
      const descriptions = response.actions.map((a: { description: string }) =>
        a.description.toLowerCase()
      );
      expect(descriptions.some((d: string) => d.includes('design'))).toBe(true);
      expect(descriptions.some((d: string) => d.includes('architecture'))).toBe(true);
      expect(descriptions.some((d: string) => d.includes('issue'))).toBe(true);
    });
  });
});
