import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { parse as parseYaml } from 'yaml';
import { logEpic, updateEpic, getEpic } from '../../src/tools/sentinel.js';
import { createTestContext, cleanupTestContext, TestContext } from '../utils/test-context.js';

/**
 * ISS-0140: epics were write-once. log_epic created them and nothing could
 * change status, priority, summary, or ownership afterwards, so `status` stayed
 * `planned` forever — which made list_epics(status:...) useless and fed wrong
 * epic state into oracle/roadmap reporting (ISS-0110). Correcting an epic meant
 * hand-editing the file, which is the markdown-into-YAML write hazard that
 * corrupted issue records in the first place (ISS-0129).
 */

describe('updateEpic', () => {
  let ctx: TestContext;
  let epicId: string;
  let epicPath: string;

  beforeEach(async () => {
    ctx = await createTestContext();
    const created = await logEpic({
      projectId: ctx.rootDir,
      title: 'Test epic',
      summary: 'Original summary.',
      priority: 'medium',
    });
    epicId = (created as { epic_id: string }).epic_id;
    epicPath = (created as { path: string }).path;
  });

  afterEach(async () => {
    await cleanupTestContext(ctx);
  });

  async function frontmatter(): Promise<Record<string, unknown>> {
    const raw = await fs.readFile(epicPath, 'utf-8');
    const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    return parseYaml(m![1]) as Record<string, unknown>;
  }

  it('updates status, which was previously pinned at planned forever', async () => {
    const result = await updateEpic({
      projectId: ctx.rootDir,
      epic_id: epicId,
      status: 'in_progress',
    });
    expect('changes' in result).toBe(true);
    expect((await frontmatter()).status).toBe('in_progress');
  });

  it('updates priority, owner, squad and tags', async () => {
    await updateEpic({
      projectId: ctx.rootDir,
      epic_id: epicId,
      priority: 'critical',
      owner: 'ben',
      squad: 'platform',
      tags: ['runtime', 'repair'],
    });
    const fm = await frontmatter();
    expect(fm.priority).toBe('critical');
    expect(fm.owner).toBe('ben');
    expect(fm.squad).toBe('platform');
    expect(fm.tags).toEqual(['runtime', 'repair']);
  });

  it('keeps frontmatter summary and the body ## Summary section in step', async () => {
    // The value is stored twice. Updating one and not the other is precisely
    // what makes a hand-edited epic untrustworthy.
    await updateEpic({
      projectId: ctx.rootDir,
      epic_id: epicId,
      summary: 'Revised summary after review.',
    });
    const raw = await fs.readFile(epicPath, 'utf-8');
    const fm = await frontmatter();
    expect(fm.summary).toBe('Revised summary after review.');
    expect(raw).toContain('## Summary');
    expect(raw.split('## Summary')[1]).toContain('Revised summary after review.');
    expect(raw).not.toContain('Original summary.');
  });

  it('stamps updated_at only when something actually changed', async () => {
    const before = await frontmatter();
    const noop = await updateEpic({ projectId: ctx.rootDir, epic_id: epicId });
    expect('changes' in noop && noop.changes).toEqual([]);
    expect((await frontmatter()).updated_at).toBe(before.updated_at);

    await updateEpic({ projectId: ctx.rootDir, epic_id: epicId, status: 'shipped' });
    expect((await frontmatter()).updated_at).toBeTruthy();
  });

  it('appends notes without destroying earlier ones', async () => {
    await updateEpic({ projectId: ctx.rootDir, epic_id: epicId, note: 'First note.' });
    await updateEpic({ projectId: ctx.rootDir, epic_id: epicId, note: 'Second note.' });
    const raw = await fs.readFile(epicPath, 'utf-8');
    expect(raw).toContain('First note.');
    expect(raw).toContain('Second note.');
  });

  it('reports the transitions it made', async () => {
    const result = await updateEpic({
      projectId: ctx.rootDir,
      epic_id: epicId,
      status: 'in_progress',
      priority: 'high',
    });
    const changes = (result as { changes: string[] }).changes;
    expect(changes.some((c) => c.includes('status'))).toBe(true);
    expect(changes.some((c) => c.includes('priority'))).toBe(true);
  });

  it('leaves the record parseable by getEpic afterwards', async () => {
    // Round-trip: the write path must not produce something the read path
    // then reports as degraded or unparseable.
    await updateEpic({
      projectId: ctx.rootDir,
      epic_id: epicId,
      status: 'in_progress',
      summary: 'Round-tripped summary.',
      note: 'A note with a # hash and a : colon.',
    });
    const read = await getEpic({ projectId: ctx.rootDir, epic_id: epicId });
    expect('epic' in read && read.epic).toBeTruthy();
    expect((read as { epic: { status: string } }).epic.status).toBe('in_progress');
  });

  it('returns EPIC_NOT_FOUND for an unknown id', async () => {
    const result = await updateEpic({
      projectId: ctx.rootDir,
      epic_id: 'EPIC-9999',
      status: 'shipped',
    });
    expect('error' in result && result.error).toBe('EPIC_NOT_FOUND');
  });

  it('matches ids on a boundary rather than a bare prefix', async () => {
    // A bare startsWith would let "EPIC-000" target EPIC-0001 and any sibling
    // at once, then silently write to whichever readdir returned first — the
    // defect that made issue resolution unsafe (ISS-0131).
    await logEpic({ projectId: ctx.rootDir, title: 'Second epic', summary: 'Another.' });
    const result = await updateEpic({
      projectId: ctx.rootDir,
      epic_id: 'EPIC-000',
      status: 'shipped',
    });
    expect('error' in result).toBe(true);
  });

  it('refuses to write into a record with unparseable frontmatter', async () => {
    // Never repeat ISS-0129: writing into a malformed file compounds damage.
    await fs.writeFile(epicPath, '---\nid: [unclosed\n---\n\n# Broken\n');
    const result = await updateEpic({
      projectId: ctx.rootDir,
      epic_id: epicId,
      status: 'shipped',
    });
    expect('error' in result).toBe(true);
    const raw = await fs.readFile(epicPath, 'utf-8');
    expect(raw).toContain('[unclosed');
  });
});
