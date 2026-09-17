import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { createTestContext, TestContext } from '../utils/test-context.js';
import { projectInitTool } from '../../src/tools/registry/index.js';

// ponytail: one check that fails if the CLAUDE.md append logic breaks.
describe('project_init CLAUDE.md section', () => {
  let ctx: TestContext;
  let projectDir: string;

  beforeEach(async () => {
    ctx = await createTestContext();
    projectDir = path.join(ctx.rootDir, 'newproj');
    await fs.mkdir(projectDir);
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it('appends the Decibel section to an existing CLAUDE.md exactly once', async () => {
    const claudeMd = path.join(projectDir, 'CLAUDE.md');
    await fs.writeFile(claudeMd, '# My project\n\nSome rules.\n');

    const first = await projectInitTool.handler({ path: projectDir, id: 'newproj' });
    expect(first.isError).toBeFalsy();
    let body = await fs.readFile(claudeMd, 'utf-8');
    expect(body.startsWith('# My project')).toBe(true);
    expect(body).toContain('<!-- decibel:start -->');
    expect(body).toContain('Decibel is the durable memory for this project');

    // Re-running must not duplicate the section.
    const second = await projectInitTool.handler({ path: projectDir, id: 'newproj', force: true });
    expect(second.isError).toBeFalsy();
    body = await fs.readFile(claudeMd, 'utf-8');
    expect(body.split('<!-- decibel:start -->').length).toBe(2);
  });

  it('creates CLAUDE.md when absent and skips it with claude_md=false', async () => {
    const other = path.join(ctx.rootDir, 'other');
    await fs.mkdir(other);
    await projectInitTool.handler({ path: other, id: 'other', claude_md: false });
    await expect(fs.access(path.join(other, 'CLAUDE.md'))).rejects.toThrow();

    await projectInitTool.handler({ path: projectDir, id: 'newproj' });
    const body = await fs.readFile(path.join(projectDir, 'CLAUDE.md'), 'utf-8');
    expect(body.startsWith('<!-- decibel:start -->')).toBe(true);
  });
});
