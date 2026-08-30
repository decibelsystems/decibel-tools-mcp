// Phase 3 canonical model + codec.
//
// The corpus block at the bottom is the important one: it runs the codec over
// every real record in this repo's own store, because the defects this model
// exists to fix were all found in real records and none of them would have
// appeared in a hand-written fixture.
import { describe, it, expect } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  ISSUE_STATUSES,
  isLive,
  isTerminal,
  isUid,
  newUid,
  normalizeStatus,
} from '../../src/domain/issue.js';
import {
  decodeIssue,
  encodeIssue,
  applyIssueChanges,
  splitBareYaml,
} from '../../src/domain/issueCodec.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ISSUES_DIR = path.join(REPO_ROOT, '.decibel', 'sentinel', 'issues');

describe('status vocabulary', () => {
  it('accepts every canonical value unchanged', () => {
    for (const s of ISSUE_STATUSES) {
      const r = normalizeStatus(s);
      expect(r.status).toBe(s);
      expect(r.normalizedFrom).toBeUndefined();
      expect(r.unrecognized).toBeUndefined();
    }
  });

  // The two pre-Phase-3 unions disagreed: one had `done`, the other `closed`.
  // A record written by one was unreadable to the other's filter.
  it('maps the legacy `done` from sentinelIssues onto `closed`', () => {
    const r = normalizeStatus('done');
    expect(r.status).toBe('closed');
    expect(r.normalizedFrom).toBe('done');
    expect(r.unrecognized).toBeUndefined();
  });

  // ISS-0026 on disk. Not in either old union, so no filter could ever select
  // it — the record was finished work that no query could reach.
  it('rescues ISS-0026 — `resolved` matched no writer and no filter', () => {
    const r = normalizeStatus('resolved');
    expect(r.status).toBe('closed');
    expect(r.normalizedFrom).toBe('resolved');
  });

  it('flags a genuinely unknown value instead of passing it through', () => {
    const r = normalizeStatus('bananas');
    expect(r.status).toBe('open');
    expect(r.unrecognized).toBe(true);
    // The old reader stored 'bananas' verbatim and returned it to callers.
    expect(ISSUE_STATUSES).not.toContain('bananas' as never);
  });

  it('defaults a missing status to open, and does not call that unrecognized', () => {
    const r = normalizeStatus(undefined);
    expect(r.status).toBe('open');
    expect(r.unrecognized).toBeUndefined();
  });

  it('partitions the vocabulary into live and terminal with no gaps', () => {
    for (const s of ISSUE_STATUSES) expect(isLive(s)).toBe(!isTerminal(s));
    expect(ISSUE_STATUSES.filter(isTerminal)).toEqual(['closed', 'wontfix']);
  });
});

describe('uid', () => {
  it('is a valid, recognizable UUIDv7', () => {
    const uid = newUid();
    expect(isUid(uid)).toBe(true);
    expect(uid[14]).toBe('7'); // version nibble
  });

  it('sorts by creation time as a string, which is why v7 and not v4', () => {
    const early = newUid(1_000_000_000_000);
    const late = newUid(1_900_000_000_000);
    expect(early < late).toBe(true);
  });

  it('is unique across a tight loop', () => {
    const seen = new Set(Array.from({ length: 500 }, () => newUid()));
    expect(seen.size).toBe(500);
  });

  it('rejects a v4 uuid and other near-misses', () => {
    expect(isUid('f47ac10b-58cc-4372-a567-0e02b2c3d479')).toBe(false); // v4
    expect(isUid('not-a-uuid')).toBe(false);
    expect(isUid(undefined)).toBe(false);
  });
});

describe('codec — markdown format', () => {
  const MD = `---
id: ISS-0999
projectId: decibel-tools-mcp
severity: high
status: open
created_at: 2026-01-01T00:00:00.000Z
---

# A markdown issue

**Severity:** high
**Status:** open

## Details

Body prose that must survive.
`;

  it('decodes frontmatter, not the body mirror', () => {
    const d = decodeIssue('ISS-0999-a-markdown-issue.md', MD);
    expect(d.format).toBe('md');
    expect(d.issue.id).toBe('ISS-0999');
    expect(d.issue.title).toBe('A markdown issue');
    expect(d.issue.status).toBe('open');
    expect(d.issue.details).toBe('Body prose that must survive.');
    expect(d.warnings).toEqual([]);
  });

  // The whole reason the codec exists. The mirror is regenerated on encode, so
  // there is no path that writes a body disagreeing with its frontmatter.
  it('regenerates the body mirror from the model on encode', () => {
    const d = decodeIssue('ISS-0999-a-markdown-issue.md', MD);
    const out = encodeIssue(applyIssueChanges(d, { status: 'in_progress' }));
    expect(out).toContain('status: in_progress');
    expect(out).toContain('**Status:** in_progress');
    expect(out).not.toContain('**Status:** open');
  });

  it('cannot produce a mirror that disagrees with frontmatter, even if handed one', () => {
    // Feed it a record that is ALREADY drifted — the 16-record bug on disk.
    const drifted = MD.replace('status: open', 'status: closed');
    const d = decodeIssue('x.md', drifted);
    expect(d.issue.status).toBe('closed'); // frontmatter is authoritative
    const out = encodeIssue(d);
    expect(out).toContain('**Status:** closed'); // drift repaired by writing
  });

  // ISS-0099 and ISS-0103 on disk. Skeletal records with frontmatter and no
  // body at all: the title has nowhere to live except frontmatter, and an
  // encoder that only ever wrote the heading dropped it — so the next read
  // showed the raw filename as the title. Caught by the corpus idempotency
  // check, not by any hand-written fixture.
  it('keeps the title in frontmatter when the body has no heading to hold it', () => {
    const skeletal = '---\nid: ISS-0099\nstatus: in_progress\ntitle: A recovered title\n---\n';
    const d = decodeIssue('2026-03-28T05-03-28Z-slug.md', skeletal);
    expect(d.issue.title).toBe('A recovered title');

    const out = encodeIssue(d);
    expect(out).toContain('title: A recovered title');
    expect(decodeIssue('2026-03-28T05-03-28Z-slug.md', out).issue.title).toBe('A recovered title');
  });

  // The converse: when a heading exists it is the title's home, and duplicating
  // into frontmatter would create a second copy to drift — the status-mirror
  // mistake all over again.
  it('does not duplicate the title into frontmatter when a heading exists', () => {
    const out = encodeIssue(decodeIssue('ISS-0999-a.md', MD));
    expect(out.match(/^---\n([\s\S]*?)\n---/)![1]).not.toContain('title:');
    expect(out).toContain('# A markdown issue');
  });

  it('preserves prose, heading and delimiters through a round trip', () => {
    const out = encodeIssue(decodeIssue('ISS-0999-a.md', MD));
    expect(out.startsWith('---\n')).toBe(true);
    expect(out).toContain('# A markdown issue');
    expect(out).toContain('Body prose that must survive.');
    expect(out).toContain('## Details');
  });
});

describe('codec — bare YAML format', () => {
  const YML = `id: ISS-0888
title: A yaml issue
project: decibel-tools-mcp
status: done
priority: high
tags:
  - alpha
created_at: 2026-01-01T00:00:00.000Z
description: |-
  Multi-line prose.

  ## An indented-looking heading inside the block scalar
  still body text.
`;

  it('decodes and normalizes the legacy status', () => {
    const d = decodeIssue('ISS-0888-a-yaml-issue.yml', YML);
    expect(d.format).toBe('yaml');
    expect(d.issue.title).toBe('A yaml issue');
    expect(d.issue.status).toBe('closed');
    expect(d.warnings.some((w) => w.includes('normalized'))).toBe(true);
  });

  // The column-0 anchor in splitBareYaml. If it ever gains \s*, a heading inside
  // a block scalar becomes a "tail" and the record is truncated at parse time.
  it('does not treat a heading inside a block scalar as a markdown tail', () => {
    const d = decodeIssue('ISS-0888-a.yml', YML);
    expect(d.issue.details).toContain('An indented-looking heading');
    expect(d.raw.body).toBe('');
    expect(splitBareYaml(YML).tail).toBe('');
  });

  it('round-trips the block scalar without flattening it', () => {
    const out = encodeIssue(decodeIssue('ISS-0888-a.yml', YML));
    const again = decodeIssue('ISS-0888-a.yml', out);
    expect(again.issue.details).toBe(decodeIssue('ISS-0888-a.yml', YML).issue.details);
    expect(again.issue.tags).toEqual(['alpha']);
  });
});

describe('codec — lossless preservation', () => {
  // Real records carry keys no interface declares. A codec that emitted only
  // known fields would delete them on the first write.
  it('carries unknown frontmatter keys through a round trip', () => {
    const src = `id: ISS-0777
title: Has odd keys
status: closed
repo: my-repo
closed_reason: shipped per body
source: importer
`;
    const out = encodeIssue(decodeIssue('ISS-0777-x.yml', src));
    expect(out).toContain('repo: my-repo');
    expect(out).toContain('closed_reason: shipped per body');
    expect(out).toContain('source: importer');
  });

  it('keeps each format spelling of the project field', () => {
    const md = decodeIssue('a.md', '---\nid: ISS-1\nprojectId: p\nstatus: open\n---\n\n# T\n');
    expect(md.issue.project).toBe('p');
    expect(encodeIssue(md)).toContain('projectId: p');

    const yml = decodeIssue('b.yml', 'id: ISS-2\ntitle: T\nproject: p\nstatus: open\n');
    expect(yml.issue.project).toBe('p');
    expect(encodeIssue(yml)).toContain('project: p');
  });
});

// ---------------------------------------------------------------------------
// Corpus — every real record in this repo's store
// ---------------------------------------------------------------------------

describe('codec against the real store', () => {
  async function records(): Promise<Array<{ file: string; content: string }>> {
    const names = (await fs.readdir(ISSUES_DIR)).filter((f) => /\.(md|ya?ml)$/i.test(f));
    return Promise.all(
      names.map(async (file) => ({
        file,
        content: await fs.readFile(path.join(ISSUES_DIR, file), 'utf-8'),
      }))
    );
  }

  it('decodes every record without a parse failure', async () => {
    const failures = (await records())
      .map((r) => ({ file: r.file, d: decodeIssue(r.file, r.content) }))
      .filter(({ d }) => d.warnings.some((w) => w.includes('did not parse')));
    expect(failures.map((f) => f.file)).toEqual([]);
  });

  it('gives every record a title that is not just its filename', async () => {
    const untitled = (await records())
      .map((r) => ({ file: r.file, d: decodeIssue(r.file, r.content) }))
      .filter(({ d }) => d.warnings.some((w) => w.includes('no title')));
    expect(untitled.map((f) => f.file)).toEqual([]);
  });

  // Encode/decode must be a fixed point: writing a record you did not change
  // must not change what it means.
  it('is idempotent — decode(encode(x)) equals decode(x) for every record', async () => {
    for (const { file, content } of await records()) {
      const once = decodeIssue(file, content);
      const twice = decodeIssue(file, encodeIssue(once));
      expect({ file, ...twice.issue }).toEqual({ file, ...once.issue });
    }
  });

  it('loses no frontmatter key on a write', async () => {
    for (const { file, content } of await records()) {
      const before = decodeIssue(file, content);
      const after = decodeIssue(file, encodeIssue(before));
      expect({ file, keys: Object.keys(after.raw.data).sort() }).toEqual({
        file,
        keys: Object.keys(before.raw.data).sort(),
      });
    }
  });

  // Post-Phase-2 invariant, now enforced by the type rather than by a migration.
  it('reads no record into an unrecognized status', async () => {
    const bad = (await records())
      .map((r) => ({ file: r.file, d: decodeIssue(r.file, r.content) }))
      .filter(({ d }) => d.warnings.some((w) => w.includes('unrecognized status')));
    expect(bad.map((f) => f.file)).toEqual([]);
  });

  it('leaves every markdown mirror in agreement after a write', async () => {
    for (const { file, content } of await records()) {
      const d = decodeIssue(file, content);
      if (d.format !== 'md') continue;
      const out = encodeIssue(d);
      const mirror = /^\*\*Status:\*\* (.*)$/m.exec(out)?.[1];
      if (mirror !== undefined) expect({ file, mirror }).toEqual({ file, mirror: d.issue.status });
    }
  });
});
