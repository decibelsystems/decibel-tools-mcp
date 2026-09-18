// Phase 3 repository seam. The behaviours pinned here are the ones whose
// absence caused real damage: silent target selection under a duplicate id,
// status writes that did not reach the reader, and identity that moved when a
// record was edited.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import {
  FsIssueRepository,
  AmbiguousIssueIdError,
  IssueNotFoundError,
} from '../../src/domain/issueRepository.js';
import { isUid } from '../../src/domain/issue.js';

describe('FsIssueRepository', () => {
  let dir: string;
  let repo: FsIssueRepository;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'decibel-issues-'));
    repo = new FsIssueRepository(dir);
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const write = (name: string, content: string) => fs.writeFile(path.join(dir, name), content);

  describe('create', () => {
    it('stamps a uid at birth so the backfill never has to touch new records', async () => {
      const r = await repo.create({ title: 'A new issue', details: 'body', severity: 'high' });
      expect(isUid(r.issue.uid)).toBe(true);
      expect(r.issue.status).toBe('open');
      expect(r.issue.title).toBe('A new issue');
    });

    it('allocates sequential ids and round-trips through the codec', async () => {
      const a = await repo.create({ title: 'First', details: 'x', severity: 'low' });
      const b = await repo.create({ title: 'Second', details: 'y', severity: 'low' });
      expect(a.issue.id).toMatch(/^ISS-\d{4}$/);
      expect(b.issue.id).not.toBe(a.issue.id);
      expect(a.issue.details).toBe('x');
    });

    it('writes a mirror that agrees with frontmatter from the first write', async () => {
      const r = await repo.create({ title: 'T', details: 'd', severity: 'med' });
      const raw = await fs.readFile(r.path, 'utf-8');
      expect(raw).toContain('status: open');
      expect(raw).toContain('**Status:** open');
    });
  });

  describe('resolution', () => {
    beforeEach(async () => {
      await write('ISS-0110-a.md', '---\nid: ISS-0110\nstatus: open\n---\n\n# A\n');
      await write('ISS-0112-b.md', '---\nid: ISS-0112\nstatus: open\n---\n\n# B\n');
      await write('ISS-0119-c.md', '---\nid: ISS-0119\nstatus: open\n---\n\n# C\n');
    });

    it('finds an issue by its ISS-NNNN id', async () => {
      expect((await repo.get('ISS-0112'))!.issue.title).toBe('B');
    });

    // A bare startsWith made "ISS-011" match all three and the writer picked
    // one by directory order. Refusing to resolve it is the fix — but the
    // caller is told WHY, because "not found" would be a misleading answer when
    // three records visibly start with it.
    it('reports a prefix spanning several ids as a collision, never picking one', async () => {
      await expect(repo.get('ISS-011')).rejects.toThrow(AmbiguousIssueIdError);
      await expect(repo.get('ISS-011')).rejects.toMatchObject({
        candidates: expect.arrayContaining(['ISS-0110-a.md', 'ISS-0112-b.md', 'ISS-0119-c.md']),
      });
    });

    it('does not resolve a loose prefix that matches exactly one record', async () => {
      // The dangerous case: "ISS-011" with only ISS-0110 present must still not
      // silently become ISS-0110. One match is where the swallow bug lived.
      await fs.rm(path.join(dir, 'ISS-0112-b.md'));
      await fs.rm(path.join(dir, 'ISS-0119-c.md'));
      expect(await repo.get('ISS-011')).toBeNull();
    });

    it('finds an issue by filename, with or without the extension', async () => {
      expect((await repo.get('ISS-0112-b.md'))!.issue.title).toBe('B');
      expect((await repo.get('ISS-0112-b'))!.issue.title).toBe('B');
    });

    it('returns null rather than guessing when nothing matches', async () => {
      expect(await repo.get('ISS-9999')).toBeNull();
    });

    // The historical failure: two records claim one id, find() picks whichever
    // readdir yields first, the writer edits one and reports success.
    it('refuses a duplicate id instead of silently choosing one', async () => {
      await write('ISS-0112-dup.md', '---\nid: ISS-0112\nstatus: open\n---\n\n# Dup\n');
      await expect(repo.get('ISS-0112')).rejects.toThrow(AmbiguousIssueIdError);
    });

    it('lets a filename disambiguate a duplicate id', async () => {
      await write('ISS-0112-dup.md', '---\nid: ISS-0112\nstatus: open\n---\n\n# Dup\n');
      expect((await repo.get('ISS-0112-dup.md'))!.issue.title).toBe('Dup');
    });

    // uid is unique by construction, so it resolves even a duplicated ISS-NNNN.
    it('resolves by uid even when the ISS-NNNN is ambiguous', async () => {
      const uid = '018f2a00-0000-7000-8000-000000000001';
      await write('ISS-0112-dup.md', `---\nuid: ${uid}\nid: ISS-0112\nstatus: open\n---\n\n# Dup\n`);
      await expect(repo.get('ISS-0112')).rejects.toThrow(AmbiguousIssueIdError);
      expect((await repo.get(uid))!.issue.title).toBe('Dup');
    });
  });

  describe('list', () => {
    beforeEach(async () => {
      await write('ISS-0001-o.md', '---\nid: ISS-0001\nstatus: open\n---\n\n# O\n');
      await write('ISS-0002-p.md', '---\nid: ISS-0002\nstatus: in_progress\n---\n\n# P\n');
      await write('ISS-0003-c.md', '---\nid: ISS-0003\nstatus: closed\n---\n\n# C\n');
      await write('ISS-0004-w.md', '---\nid: ISS-0004\nstatus: wontfix\n---\n\n# W\n');
      await write('ISS-0005-d.yml', 'id: ISS-0005\ntitle: D\nstatus: done\n');
    });

    it('filters by exact status', async () => {
      expect((await repo.list({ status: 'open' })).map((r) => r.issue.id)).toEqual(['ISS-0001']);
    });

    // The distinction the old API could not express: "open" is one status,
    // "not finished" is three. list_issues(status:'open') silently excluded
    // in_progress and blocked work from the backlog.
    it('separates status:open from liveOnly', async () => {
      const live = (await repo.list({ liveOnly: true })).map((r) => r.issue.id).sort();
      expect(live).toEqual(['ISS-0001', 'ISS-0002']);
    });

    it('normalizes a legacy status so it is reachable by a query', async () => {
      // `done` was written by one impl and understood by neither reader.
      expect((await repo.list({ status: 'closed' })).map((r) => r.issue.id).sort()).toEqual([
        'ISS-0003',
        'ISS-0005',
      ]);
    });

    it('reads both on-disk formats without the caller knowing which', async () => {
      const all = await repo.list();
      expect(all).toHaveLength(5);
      expect(new Set(all.map((r) => r.format))).toEqual(new Set(['md', 'yaml']));
    });
  });

  describe('update and close', () => {
    beforeEach(async () => {
      await write(
        'ISS-0050-x.md',
        '---\nid: ISS-0050\nstatus: open\nseverity: high\n---\n\n# X\n\n**Severity:** high\n**Status:** open\n\n## Details\n\nprose\n'
      );
    });

    it('keeps the body mirror in step with frontmatter', async () => {
      await repo.update('ISS-0050', { status: 'in_progress' });
      const raw = await fs.readFile(path.join(dir, 'ISS-0050-x.md'), 'utf-8');
      expect(raw).toContain('status: in_progress');
      expect(raw).toContain('**Status:** in_progress');
      expect(raw).not.toContain('**Status:** open');
    });

    it('preserves the body prose across an update', async () => {
      const r = await repo.update('ISS-0050', { priority: 'high' });
      expect(r.issue.details).toBe('prose');
      expect(await fs.readFile(r.path, 'utf-8')).toContain('# X');
    });

    it('close writes status, resolution and closed_at together', async () => {
      const r = await repo.close('ISS-0050', 'fixed in abc123');
      expect(r.issue.status).toBe('closed');
      expect(r.issue.resolution).toBe('fixed in abc123');
      expect(r.issue.closed_at).toBeTruthy();
    });

    it('close can mark wontfix without inventing a different vocabulary', async () => {
      expect((await repo.close('ISS-0050', 'not doing it', 'wontfix')).issue.status).toBe('wontfix');
    });

    // Identity must not move when a record is edited — that is the property
    // that makes uid usable as a sync key.
    it('refuses to let update change identity', async () => {
      const uid = '018f2a00-0000-7000-8000-00000000abcd';
      await write('ISS-0051-y.md', `---\nuid: ${uid}\nid: ISS-0051\nstatus: open\n---\n\n# Y\n`);
      const r = await repo.update('ISS-0051', { uid: 'nope', id: 'ISS-9999' } as never);
      expect(r.issue.uid).toBe(uid);
      expect(r.issue.id).toBe('ISS-0051');
    });

    it('throws a typed error for a missing issue rather than creating one', async () => {
      await expect(repo.update('ISS-4242', { status: 'closed' })).rejects.toThrow(IssueNotFoundError);
    });
  });
});
