import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { getEpic, listEpics, logEpic, updateEpic } from '../../src/tools/sentinel.js';
import { createTestContext, cleanupTestContext, TestContext } from '../utils/test-context.js';

/**
 * parseEpicFile had two parsers: bare-YAML records went through safeParseYaml,
 * fenced `.md` records through a hand-rolled split on the first colon. The
 * loose one reports a block-scalar INDICATOR as the value — `summary: |-` read
 * back as the literal "|-", losing the entire summary — and turns every
 * indented prose line containing a colon into its own key. Observed on the real
 * EPIC-0038: summary was 2 characters and 11 keys had been invented.
 *
 * It cannot simply be replaced by YAML: records written before the write path
 * quoted its scalars contain unquoted values with ": " that YAML rejects, and
 * dropping those from list_epics would be worse than the defect.
 */

describe('epic frontmatter parsing', () => {
  let ctx: TestContext;
  let epicsDir: string;

  beforeEach(async () => {
    ctx = await createTestContext();
    epicsDir = path.join(ctx.rootDir, '.decibel', 'sentinel', 'epics');
    await fs.mkdir(epicsDir, { recursive: true });
  });

  afterEach(async () => { await cleanupTestContext(ctx); });

  const write = (name: string, body: string) =>
    fs.writeFile(path.join(epicsDir, name), body, 'utf-8');

  describe('block scalars', () => {
    const MULTILINE = `---
id: EPIC-9001
title: Runtime consolidation
summary: |-
  First paragraph of the summary.

  PHASE 0 — Reliable runtime lifecycle
  Arbitration is the socket bind, NOT a PID file.

  MEASURED STATE
  169 issue files: 111 .md, 58 .yml.
status: in_progress
priority: high
created_at: 2026-08-29T00:18:38.007Z
---

## Motivation

- one lifecycle
`;

    it('returns the block scalar content, not the "|-" indicator', async () => {
      await write('EPIC-9001-runtime.md', MULTILINE);
      const res = await getEpic({ projectId: ctx.rootDir, epic_id: 'EPIC-9001' });
      const summary = (res as { epic: { summary: string } }).epic.summary;

      expect(summary).not.toBe('|-');
      expect(summary).toContain('First paragraph of the summary.');
      expect(summary).toContain('PHASE 0 — Reliable runtime lifecycle');
      expect(summary.length).toBeGreaterThan(100);
    });

    it('does not let prose inside the summary overwrite a real field', async () => {
      // The loose reader splits every line on its first colon, including lines
      // INSIDE the block scalar. A summary that discusses status or priority
      // therefore silently rewrites the epic's own metadata — the last match in
      // the file wins.
      await write('EPIC-9003-shadow.md', `---
id: EPIC-9003
title: Discusses its own fields
summary: |-
  Phase 2 is cosmetic repair, not data recovery.

  status: shipped
  priority: low
status: in_progress
priority: high
---

## Motivation

- x
`);
      const res = await getEpic({ projectId: ctx.rootDir, epic_id: 'EPIC-9003' });
      const epic = (res as { epic: Record<string, unknown> }).epic;

      expect(epic.status).toBe('in_progress');
      expect(epic.priority).toBe('high');
      expect(epic.summary).toContain('status: shipped');
    });

    it('keeps a body `---` from truncating the summary', async () => {
      // Markdown horizontal rules are common in epic bodies; the frontmatter
      // fence must be the one that closes it.
      await write('EPIC-9002-rules.md', `---
id: EPIC-9002
title: Has rules
summary: |-
  Line one.

  Line two.
status: planned
priority: low
---

Body text.

---

More body.
`);
      const res = await getEpic({ projectId: ctx.rootDir, epic_id: 'EPIC-9002' });
      const summary = (res as { epic: { summary: string } }).epic.summary;
      expect(summary).toContain('Line one.');
      expect(summary).toContain('Line two.');
    });
  });

  describe('records a strict parser would reject', () => {
    // Written by a pre-quoting write path. YAML calls this "nested mappings are
    // not allowed in compact mappings" and refuses the whole document.
    const UNQUOTED_COLON = `---
id: EPIC-9010
title: Epic: Special Characters! @#$%
summary: Overhaul of decibel-tools-mcp: unified kernel, 26 facades.
status: shipped
priority: medium
---

## Motivation

- because
`;

    it('still reads them rather than dropping the record', async () => {
      await write('EPIC-9010-special.md', UNQUOTED_COLON);
      const res = await getEpic({ projectId: ctx.rootDir, epic_id: 'EPIC-9010' });
      const epic = (res as { epic: Record<string, unknown> | null }).epic;

      expect(epic).not.toBeNull();
      expect(epic!.title).toBe('Epic: Special Characters! @#$%');
      expect(epic!.status).toBe('shipped');
    });

    it('keeps them visible to list_epics', async () => {
      await write('EPIC-9010-special.md', UNQUOTED_COLON);
      await write('EPIC-9011-normal.md', `---
id: EPIC-9011
title: Ordinary epic
summary: Nothing unusual.
status: planned
priority: low
---

## Motivation

- fine
`);
      const res = await listEpics({ projectId: ctx.rootDir });
      const ids = (res as { epics: Array<{ id: string }> }).epics.map(e => e.id);
      expect(ids).toContain('EPIC-9010');
      expect(ids).toContain('EPIC-9011');
    });
  });

  describe('shapes the loose reader used to handle', () => {
    it('reads inline sequences as arrays', async () => {
      await write('EPIC-9020-tags.md', `---
id: EPIC-9020
title: Tagged
summary: Has tags.
status: planned
priority: low
tags: [runtime, storage]
---

## Motivation

- x
`);
      const res = await getEpic({ projectId: ctx.rootDir, epic_id: 'EPIC-9020' });
      expect((res as { epic: { tags: string[] } }).epic.tags).toEqual(['runtime', 'storage']);
    });

    it('unwraps quoted scalars instead of returning them wrapped', async () => {
      await write('EPIC-9021-quoted.md', `---
id: EPIC-9021
title: "Quoted: with a colon"
summary: "Ends with punctuation!"
status: planned
priority: low
owner: ""
---

## Motivation

- x
`);
      const res = await getEpic({ projectId: ctx.rootDir, epic_id: 'EPIC-9021' });
      const epic = (res as { epic: Record<string, unknown> }).epic;
      expect(epic.title).toBe('Quoted: with a colon');
      expect(epic.summary).toBe('Ends with punctuation!');
      expect(epic.owner).toBe('');
    });

    it('reads what log_epic writes, round-trip', async () => {
      const created = await logEpic({
        projectId: ctx.rootDir,
        title: 'Round trip',
        summary: 'A summary.',
        priority: 'high',
      });
      const id = (created as { epic_id: string }).epic_id;
      const res = await getEpic({ projectId: ctx.rootDir, epic_id: id });
      const epic = (res as { epic: Record<string, unknown> }).epic;
      expect(epic.title).toBe('Round trip');
      expect(epic.summary).toBe('A summary.');
      expect(epic.priority).toBe('high');
    });

    it('reads a summary that update_epic rewrote into a block scalar', async () => {
      // updateEpic serialises through YAML, so a multi-line summary becomes a
      // block scalar — the exact shape the reader used to mangle.
      const created = await logEpic({
        projectId: ctx.rootDir, title: 'Grows', summary: 'Short.', priority: 'low',
      });
      const id = (created as { epic_id: string }).epic_id;
      await updateEpic({
        projectId: ctx.rootDir,
        epic_id: id,
        summary: 'Line one.\n\nLine two: with a colon.\n\nLine three.',
      });
      const res = await getEpic({ projectId: ctx.rootDir, epic_id: id });
      const summary = (res as { epic: { summary: string } }).epic.summary;
      expect(summary).toContain('Line one.');
      expect(summary).toContain('Line two: with a colon.');
      expect(summary).toContain('Line three.');
      expect(summary).not.toBe('|-');
    });
  });
});
