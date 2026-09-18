// Regression tests for decibel-array-param-bug.md:
// facade schemas only declare `action`, so MCP clients may send array params
// as JSON-encoded strings ('["a","b"]'). The kernel must coerce them back to
// real arrays before they reach handlers (tags.join crashes, char-per-line
// epic rendering, aliases stored as JSON blobs).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import { createKernel } from '../../src/kernel.js';
import {
  createTestContext,
  cleanupTestContext,
  TestContext,
} from '../utils/test-context.js';

describe('kernel param coercion (JSON-string arrays)', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext();
  });

  afterEach(async () => {
    // The kernel's run tracking writes artifacts async after dispatch returns,
    // which can race the temp-dir removal (ENOTEMPTY). Settle, then retry once.
    try {
      await cleanupTestContext(ctx);
    } catch {
      await new Promise((r) => setTimeout(r, 200));
      await cleanupTestContext(ctx);
    }
  });

  it('facade dispatch: log_epic with tags as a JSON string does not crash and stores a real list', async () => {
    const kernel = await createKernel();

    const result = await kernel.dispatch('sentinel', {
      action: 'log_epic',
      projectId: 'test-project',
      title: 'Coercion epic',
      summary: 'Array params arrive as strings',
      tags: '["phase-0","recon"]',
      motivation: '["because arrays"]',
    });

    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(result.content[0].text as string);
    const epicPath = payload.path ?? payload.epic?.path;
    expect(epicPath).toBeDefined();

    const content = await fs.readFile(epicPath, 'utf-8');
    // tags.join(', ') must have received a real array
    expect(content).toContain('phase-0');
    // and no JSON-blob leakage into the file
    expect(content).not.toContain('[\\"phase-0\\"');
    expect(content).not.toContain('["phase-0","recon"]');
  });

  it('leaves genuinely-string params and unparseable strings alone', async () => {
    const kernel = await createKernel();

    // title is type:string — must not be JSON.parsed even if it looks like JSON
    const result = await kernel.dispatch('sentinel', {
      action: 'log_epic',
      projectId: 'test-project',
      title: '["not a real array"]',
      summary: 'Title stays a string',
    });

    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(result.content[0].text as string);
    const epicPath = payload.path ?? payload.epic?.path;
    const content = await fs.readFile(epicPath, 'utf-8');
    expect(content).toContain('["not a real array"]');
  });
});
