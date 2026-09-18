import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { getEpic, logEpic, updateEpic } from '../../src/tools/sentinel.js';
import { createTestContext, cleanupTestContext, TestContext } from '../utils/test-context.js';

/**
 * update_epic appends `## Note (<iso>)` sections to the body, but the Epic
 * model had no field for them — so read_epic returned an epic whose entire
 * revision history was missing. EPIC-0038 alone carried five, including the
 * notes recording why Phase 4's memory target was withdrawn and why the
 * filename renames were dropped: the two decisions most likely to be
 * re-litigated by someone reading the epic through the tool rather than the
 * file.
 */

describe('epic notes', () => {
  let ctx: TestContext;
  let epicId: string;

  beforeEach(async () => {
    ctx = await createTestContext();
    const created = await logEpic({
      projectId: ctx.rootDir, title: 'Notable', summary: 'Has notes.', priority: 'high',
    });
    epicId = (created as { epic_id: string }).epic_id;
  });
  afterEach(async () => { await cleanupTestContext(ctx); });

  const read = async () =>
    ((await getEpic({ projectId: ctx.rootDir, epic_id: epicId })) as {
      epic: { notes: Array<{ at: string; text: string }> };
    }).epic;

  it('returns nothing for an epic that has none', async () => {
    expect((await read()).notes).toEqual([]);
  });

  it('round-trips a note written by update_epic', async () => {
    await updateEpic({ projectId: ctx.rootDir, epic_id: epicId, note: 'Phase 5 complete.' });
    const notes = (await read()).notes;
    expect(notes).toHaveLength(1);
    expect(notes[0].text).toBe('Phase 5 complete.');
    expect(notes[0].at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('keeps multiple notes in the order they were written', async () => {
    await updateEpic({ projectId: ctx.rootDir, epic_id: epicId, note: 'first' });
    await updateEpic({ projectId: ctx.rootDir, epic_id: epicId, note: 'second' });
    await updateEpic({ projectId: ctx.rootDir, epic_id: epicId, note: 'third' });
    expect((await read()).notes.map(n => n.text)).toEqual(['first', 'second', 'third']);
  });

  it('preserves a multi-paragraph note whole', async () => {
    const text = 'Target withdrawn.\n\nSix processes cannot cost less than ~371 MB.\n\nSee ADR-0010.';
    await updateEpic({ projectId: ctx.rootDir, epic_id: epicId, note: text });
    expect((await read()).notes[0].text).toBe(text);
  });

  it('does not swallow the following note into the previous one', async () => {
    // Sections end at the next `##` at column zero. A note containing an
    // indented or inline "##" must not terminate its own section early, and a
    // note must not absorb its successor.
    await updateEpic({ projectId: ctx.rootDir, epic_id: epicId, note: 'alpha' });
    await updateEpic({ projectId: ctx.rootDir, epic_id: epicId, note: 'beta' });
    const notes = (await read()).notes;
    expect(notes[0].text).toBe('alpha');
    expect(notes[0].text).not.toContain('beta');
  });

  it('does not treat an ordinary body heading as a note', async () => {
    const epicsDir = path.join(ctx.rootDir, '.decibel', 'sentinel', 'epics');
    const file = (await fs.readdir(epicsDir))[0];
    const p = path.join(epicsDir, file);
    const raw = await fs.readFile(p, 'utf-8');
    await fs.writeFile(p, `${raw.trimEnd()}\n\n## Motivation\n\n- not a note\n\n## Noteworthy\n\nalso not a note\n`);
    expect((await read()).notes).toEqual([]);
  });

  it('leaves the rest of the epic intact', async () => {
    await updateEpic({ projectId: ctx.rootDir, epic_id: epicId, note: 'a note' });
    const epic = (await getEpic({ projectId: ctx.rootDir, epic_id: epicId })) as {
      epic: Record<string, unknown>;
    };
    expect(epic.epic.title).toBe('Notable');
    expect(epic.epic.summary).toBe('Has notes.');
    expect(epic.epic.priority).toBe('high');
  });
});
