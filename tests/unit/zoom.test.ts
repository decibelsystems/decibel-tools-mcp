// ============================================================================
// Zoom ingestion — EPIC-0036
// ============================================================================
// Fixtures are HAND-BUILT, not captured (tests/fixtures/zoom/README.md). No raw
// Zoom payload has ever been persisted, so the shapes come from rendered output
// plus the field names the Python reads. Two paths therefore have no fixture at
// all, deliberately: the deprecated split summary shape, and a uuid that
// triggers double-encoding. Both are exercised below against hand-made input
// that is labelled as unverified rather than dressed up as real.
//
// The load-bearing assertion in this file is the filename one. The plasiv
// machine holds a real file named "Ben - Pete 2026-08-12 17_04Z.md"; if this
// port produces that string from the same input, its naming and timestamp
// parsing match the Python exactly, and a re-pull will not duplicate the 26
// files already on disk.
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  encodeMeetingUuid,
  extractSummaryList,
  renderSummary,
  filenameFor,
  buildFrontmatter,
  startOf,
  inRange,
  routeFor,
  indexKnownMeetings,
  dedupKey,
  buildUnroutedStub,
  listSummaries,
  apiGet,
  syncMeetings,
  ZoomError,
  type MeetingSummary,
  type ZoomRoute,
} from '../../src/tools/zoom.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'zoom');
const load = (name: string) => JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf-8'));

const page1 = load('list-page1.json');
const page2 = load('list-page2.json');
const detail = load('detail-summary-content.json');

const REAL_UUID = 'lgoqel38SxWZZ6kiYgSYlw==';

// ============================================================================
// UUID encoding
// ============================================================================

describe('encodeMeetingUuid', () => {
  it('single-encodes an ordinary uuid, matching the %3D%3D in Zoom task permalinks', () => {
    // Cross-check: this same encoding appears inside the task links Zoom embeds
    // in its own summary markdown, which is where the rule was confirmed.
    expect(encodeMeetingUuid(REAL_UUID)).toBe('lgoqel38SxWZZ6kiYgSYlw%3D%3D');
  });

  it('double-encodes a uuid starting with a slash (UNVERIFIED against real data)', () => {
    // No uuid on the plasiv disk triggers this branch. The rule is from Zoom's
    // docs; this test pins the implementation to the documented behaviour, not
    // to an observed case.
    expect(encodeMeetingUuid('/abc==')).toBe('%252Fabc%253D%253D');
  });

  it('double-encodes a uuid containing a double slash (UNVERIFIED against real data)', () => {
    expect(encodeMeetingUuid('ab//cd')).toBe('ab%252F%252Fcd');
  });
});

// ============================================================================
// List envelope
// ============================================================================

describe('extractSummaryList', () => {
  it('reads the documented `summaries` key', () => {
    expect(extractSummaryList(page1)).toHaveLength(2);
  });

  it('falls back to another list-of-objects and says which key it used', () => {
    // The failure being defended against is a SILENT zero-result run: an
    // envelope rename would otherwise read as "no meetings", indistinguishable
    // from a quiet week.
    const notes: string[] = [];
    const found = extractSummaryList({ meeting_summaries: [{ meeting_uuid: 'x' }], total_records: 1 }, notes);
    expect(found).toHaveLength(1);
    expect(notes[0]).toContain('meeting_summaries');
  });

  it('warns when total_records is non-zero but no list is present', () => {
    const notes: string[] = [];
    expect(extractSummaryList({ total_records: 4 }, notes)).toEqual([]);
    expect(notes[0]).toContain('4 records');
  });

  it('stays quiet on a genuinely empty page', () => {
    const notes: string[] = [];
    expect(extractSummaryList({ summaries: [], total_records: 0 }, notes)).toEqual([]);
    expect(notes).toEqual([]);
  });
});

describe('listSummaries', () => {
  it('follows next_page_token across pages and stops on the empty token', async () => {
    const seenTokens: Array<string | null> = [];
    const fetchImpl = (async (url: string) => {
      const token = new URL(url).searchParams.get('next_page_token');
      seenTokens.push(token);
      return { ok: true, json: async () => (token ? page2 : page1) };
    }) as unknown as typeof fetch;

    const all = await listSummaries('tok', '2026-08-06', '2026-09-04', [], { fetchImpl });

    expect(all).toHaveLength(4);
    expect(seenTokens).toEqual([null, 'Dd8vGm3wKqRzT1xY7bN0pLcE4hJ2sA6uW']);
  });
});

// ============================================================================
// Backoff
// ============================================================================

describe('apiGet', () => {
  it('retries a 429 and honours Retry-After', async () => {
    const waits: number[] = [];
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      if (calls === 1) {
        return { ok: false, status: 429, statusText: 'Too Many Requests', text: async () => '', headers: new Map([['retry-after', '2']]) as unknown as Headers };
      }
      return { ok: true, json: async () => ({ ok: true }) };
    }) as unknown as typeof fetch;

    const out = await apiGet('/x', 'tok', undefined, { fetchImpl, sleep: async (ms) => { waits.push(ms); } });

    expect(out).toEqual({ ok: true });
    expect(waits).toEqual([2000]);
  });

  it('does not retry a 401 — asking again does not fix a credential', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return { ok: false, status: 401, statusText: 'Unauthorized', text: async () => 'bad token', headers: new Map() as unknown as Headers };
    }) as unknown as typeof fetch;

    await expect(apiGet('/x', 'tok', undefined, { fetchImpl, sleep: async () => {} })).rejects.toThrow(ZoomError);
    expect(calls).toBe(1);
  });

  it('gives up after repeated 5xx rather than looping forever', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return { ok: false, status: 503, statusText: 'Unavailable', text: async () => '', headers: new Map() as unknown as Headers };
    }) as unknown as typeof fetch;

    await expect(apiGet('/x', 'tok', undefined, { fetchImpl, sleep: async () => {} })).rejects.toThrow(/503/);
    expect(calls).toBe(5);
  });
});

// ============================================================================
// Rendering
// ============================================================================

describe('renderSummary', () => {
  it('prefers summary_content, the shape this account actually returns', () => {
    const body = renderSummary(detail);
    expect(body.startsWith('## Quick recap')).toBe(true);
  });

  it('keeps Next steps SECOND — the ordering that proves the modern shape', () => {
    // The deprecated split branch appends next_steps LAST and structurally
    // cannot produce this ordering. All 26 files on the plasiv disk have it,
    // which is how the account was identified as being on summary_content.
    const body = renderSummary(detail);
    const recap = body.indexOf('## Quick recap');
    const next = body.indexOf('## Next steps');
    const summary = body.indexOf('## Summary');
    expect(recap).toBeLessThan(next);
    expect(next).toBeLessThan(summary);
  });

  it('renders the deprecated split shape (UNVERIFIED — no fixture, built from field names)', () => {
    const body = renderSummary({
      summary_overview: 'Overview text.',
      summary_details: [{ label: 'Topic A', summary: 'Detail A.' }],
      next_steps: ['Do the thing'],
    });
    expect(body).toContain('## Quick recap');
    expect(body).toContain('### Topic A');
    // Last, which is exactly why this branch cannot be what produced the files
    // on disk.
    expect(body.indexOf('## Next steps')).toBeGreaterThan(body.indexOf('### Topic A'));
  });

  it('returns empty for a meeting with no summary yet', () => {
    expect(renderSummary({})).toBe('');
  });
});

// ============================================================================
// Filenames and frontmatter — byte-identical to the Python
// ============================================================================

describe('filenameFor', () => {
  it('reproduces the real file sitting in the unrouted bucket', () => {
    expect(filenameFor(page1.summaries[0])).toBe('Ben - Pete 2026-08-12 17_04Z.md');
  });

  it('falls back to the bare date when the timestamp does not parse', () => {
    expect(filenameFor({ meeting_topic: 'X', meeting_start_time: '2026-08-12 17:04' }))
      .toBe('X 2026-08-12.md');
  });

  it('strips characters that are illegal in a filename', () => {
    expect(filenameFor({ meeting_topic: 'a/b:c*d?e"f<g>h|i', meeting_start_time: '' }))
      .toBe('a-b-c-d-e-f-g-h-i.md');
  });
});

describe('buildFrontmatter', () => {
  it('emits the five keys the dedup index reads back', () => {
    const fm = buildFrontmatter(page1.summaries[0], 'new');
    expect(fm).toContain('source: zoom-ai-companion');
    expect(fm).toContain('topic: "Ben / Pete"');
    expect(fm).toContain('start: 2026-08-12T17:04:21Z');
    expect(fm).toContain(`meeting_uuid: ${REAL_UUID}`);
    expect(fm).toContain('status: new');
  });

  it('downgrades double quotes in the topic so the YAML stays parseable', () => {
    expect(buildFrontmatter({ meeting_topic: 'the "big" one' }, 'new')).toContain(`topic: "the 'big' one"`);
  });
});

describe('inRange', () => {
  it('enforces the window Zoom ignores on the list endpoint', () => {
    expect(inRange(page1.summaries[0], '2026-08-01', '2026-08-31')).toBe(true);
    expect(inRange(page1.summaries[0], '2026-09-01', '2026-09-30')).toBe(false);
  });

  it('keeps an entry with no start time rather than hiding it', () => {
    expect(inRange({}, '2026-09-01', '2026-09-30')).toBe(true);
  });

  it('reads summary_start_time when meeting_start_time is absent', () => {
    expect(startOf({ summary_start_time: '2026-08-12T17:04:21Z' })).toBe('2026-08-12T17:04:21Z');
  });
});

// ============================================================================
// Routing
// ============================================================================

describe('routeFor', () => {
  const routes: ZoomRoute[] = [
    { id: 'plasiv', match: ['plasiv'], out: '/tmp/plasiv' },
    { id: 'plasiv-design', match: ['plasiv design'], out: '/tmp/design' },
  ];

  it('picks the longest matching needle, not the first rule in file order', () => {
    // The original took whichever rule came first in the registry, so a project
    // whose needle is a substring of another's silently stole its meetings
    // depending on file ordering.
    const hit = routeFor({ meeting_topic: 'Plasiv design review' }, routes);
    expect(hit?.id).toBe('plasiv-design');
  });

  it('matches case-insensitively', () => {
    expect(routeFor({ meeting_topic: 'Decibel Check In work sesh (Plasiv)' }, routes)?.id).toBe('plasiv');
  });

  it('returns null when nothing matches', () => {
    expect(routeFor({ meeting_topic: 'Ben / Pete' }, routes)).toBeNull();
  });
});

// ============================================================================
// Dedup — ISS-0152
// ============================================================================

describe('indexKnownMeetings', () => {
  let dir: string;

  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoom-dedup-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('finds the uuid in the frontmatter and keys it with the start time', () => {
    fs.writeFileSync(path.join(dir, 'a.md'), buildFrontmatter(page1.summaries[0], 'new') + 'body\n');
    const seen = indexKnownMeetings([dir]);
    expect(seen.has(dedupKey(REAL_UUID, '2026-08-12T17:04:21Z'))).toBe(true);
  });

  it('treats the same uuid at a different start as a different meeting', () => {
    // Recurring meetings may reuse a uuid across occurrences. Keying on uuid
    // alone silently drops the second one; nobody has observed Zoom doing this,
    // and the Python does not defend against it.
    fs.writeFileSync(path.join(dir, 'a.md'), buildFrontmatter(page1.summaries[0], 'new') + 'body\n');
    const seen = indexKnownMeetings([dir]);
    expect(seen.has(dedupKey(REAL_UUID, '2026-09-01T10:00:00Z'))).toBe(false);
  });

  it('ignores a hand-named file with no frontmatter instead of throwing', () => {
    fs.writeFileSync(path.join(dir, 'notes.md'), 'just some notes\n');
    expect(indexKnownMeetings([dir]).size).toBe(0);
  });

  it('skips a directory that does not exist', () => {
    expect(indexKnownMeetings([path.join(dir, 'nope')]).size).toBe(0);
  });
});

// ============================================================================
// Sync — the routing fan-out and the reclaim path
// ============================================================================

describe('syncMeetings', () => {
  let root: string;
  let projectDir: string;
  let home: string;
  const realHome = os.homedir;

  function fakeApi() {
    return (async (url: string) => {
      if (url.includes('meeting_summaries')) {
        const token = new URL(url).searchParams.get('next_page_token');
        return { ok: true, json: async () => (token ? page2 : page1) };
      }
      // "Quick sync" is the no-summary-body case.
      if (url.includes(encodeMeetingUuid('Rr2WfKcJ4TmuZaHnCyXqPQ=='))) {
        return { ok: true, json: async () => ({}) };
      }
      return { ok: true, json: async () => detail };
    }) as unknown as typeof fetch;
  }

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'zoom-sync-'));
    projectDir = path.join(root, 'plasiv', 'meetings', 'raw');
    home = path.join(root, 'home');
    fs.mkdirSync(path.join(home, '.decibel', 'meetings', 'unrouted'), { recursive: true });
    (os as unknown as { homedir: () => string }).homedir = () => home;
  });

  afterEach(() => {
    (os as unknown as { homedir: () => string }).homedir = realHome;
    fs.rmSync(root, { recursive: true, force: true });
  });

  const routes = (): ZoomRoute[] => [{ id: 'plasiv', match: ['plasiv'], out: projectDir }];

  const opts = { route: true, from: '2026-08-01', to: '2026-09-04' };

  it('routes matching meetings to the project and leaves the rest unrouted', async () => {
    const res = await syncMeetings(opts, { token: 'tok', routes: routes(), fetchImpl: fakeApi(), sleep: async () => {} });

    // Two plasiv topics written; "Ben / Pete" and "Quick sync" both match no
    // rule and are stubbed. Note "Quick sync" never reaches the empty-body path
    // in a routed run — being unrouted, its detail is never fetched at all.
    expect(res.unrouted).toBe(2);
    expect(res.written).toBe(4);
    expect(fs.readdirSync(projectDir).sort()).toEqual([
      'Decibel Check In work sesh (Plasiv) 2026-08-13 18_31Z.md',
      'Plasiv design review 2026-08-20 16_00Z.md',
    ]);
  });

  it('records only the identity of an unrouted meeting, never its body', async () => {
    // ISS-0123: the bucket on the plasiv machine holds a personal two-person
    // meeting with its full body on disk. Identity is enough to see what is
    // waiting for a rule.
    await syncMeetings(opts, { token: 'tok', routes: routes(), fetchImpl: fakeApi(), sleep: async () => {} });

    const bucket = path.join(home, '.decibel', 'meetings', 'unrouted');
    const stub = fs.readFileSync(path.join(bucket, 'Ben - Pete 2026-08-12 17_04Z.md'), 'utf-8');

    expect(stub).toContain(`meeting_uuid: ${REAL_UUID}`);
    expect(stub).toContain('status: unrouted');
    expect(stub).not.toContain('Quick recap');
    expect(stub).not.toContain('migration note');
  });

  it('does not fetch the detail of an unrouted meeting at all', async () => {
    const fetched: string[] = [];
    const spy = (async (url: string) => {
      fetched.push(url);
      return (await fakeApi()(url as never)) as never;
    }) as unknown as typeof fetch;

    await syncMeetings(opts, { token: 'tok', routes: routes(), fetchImpl: spy, sleep: async () => {} });

    expect(fetched.some(u => u.includes(encodeMeetingUuid(REAL_UUID)))).toBe(false);
  });

  it('skips meetings already on disk on a second run', async () => {
    const deps = { token: 'tok', routes: routes(), fetchImpl: fakeApi(), sleep: async () => {} };
    await syncMeetings(opts, deps);
    const second = await syncMeetings(opts, deps);

    expect(second.written).toBe(0);
    expect(second.skipped).toBeGreaterThan(0);
  });

  it('RECLAIMS an unrouted meeting once a routing rule is added — ISS-0152', async () => {
    // The bug this port exists to fix. The Python indexes the unrouted bucket
    // into the same seen-set as every real destination, so a meeting that lands
    // unrouted is thereafter "seen" and adding the rule that should claim it
    // does nothing without --force. The bucket was a black hole, not a holding
    // pen.
    const deps = { token: 'tok', fetchImpl: fakeApi(), sleep: async () => {} };
    const bucket = path.join(home, '.decibel', 'meetings', 'unrouted');

    await syncMeetings(opts, { ...deps, routes: routes() });
    expect(fs.existsSync(path.join(bucket, 'Ben - Pete 2026-08-12 17_04Z.md'))).toBe(true);

    // Now a rule claims it. No --force.
    const withPete = [...routes(), { id: 'pete', match: ['ben / pete'], out: path.join(root, 'pete') }];
    const res = await syncMeetings(opts, { ...deps, routes: withPete });

    expect(res.reclaimed).toBe(1);
    const claimed = fs.readFileSync(path.join(root, 'pete', 'Ben - Pete 2026-08-12 17_04Z.md'), 'utf-8');
    expect(claimed).toContain('## Quick recap');
    // The stub must not linger as a duplicate.
    expect(fs.existsSync(path.join(bucket, 'Ben - Pete 2026-08-12 17_04Z.md'))).toBe(false);
  });

  it('does not write a second stub for a meeting that is still unrouted', async () => {
    const deps = { token: 'tok', routes: routes(), fetchImpl: fakeApi(), sleep: async () => {} };
    await syncMeetings(opts, deps);
    const second = await syncMeetings(opts, deps);

    const bucket = path.join(home, '.decibel', 'meetings', 'unrouted');
    expect(fs.readdirSync(bucket)).toHaveLength(2);
    expect(second.written).toBe(0);
  });

  it('never writes a file for a routed meeting whose summary is not ready', async () => {
    // An empty file would poison the dedup index against the real summary when
    // it eventually appears, so the meeting is counted and skipped instead.
    // "Quick sync" has to be ROUTED to reach this path at all — an unrouted
    // meeting is stubbed without its detail ever being fetched.
    const withQuick = [...routes(), { id: 'quick', match: ['quick sync'], out: path.join(root, 'quick') }];
    const res = await syncMeetings(opts, { token: 'tok', routes: withQuick, fetchImpl: fakeApi(), sleep: async () => {} });

    expect(res.empty).toBe(1);
    expect(fs.existsSync(path.join(root, 'quick'))).toBe(false);
  });

  it('dry run touches nothing and still reports the routing table', async () => {
    const res = await syncMeetings({ ...opts, dryRun: true }, {
      token: 'tok', routes: routes(), fetchImpl: fakeApi(), sleep: async () => {},
    });

    expect(res.dry_run).toBe(true);
    expect(res.routes?.[0].id).toBe('plasiv');
    expect(fs.existsSync(projectDir)).toBe(false);
  });

  it('notes that Zoom ignored the requested window', async () => {
    const res = await syncMeetings(
      { route: true, from: '2026-08-01', to: '2026-08-14' },
      { token: 'tok', routes: routes(), fetchImpl: fakeApi(), sleep: async () => {} }
    );
    expect(res.notes.join(' ')).toContain('ignoring from/to');
  });

  it('refuses a routed run when no project carries a rule', async () => {
    await expect(
      syncMeetings(opts, { token: 'tok', routes: [], fetchImpl: fakeApi(), sleep: async () => {} })
    ).rejects.toThrow(/no projects/i);
  });
});

// ============================================================================
// Stub content
// ============================================================================

describe('buildUnroutedStub', () => {
  it('carries identity and instructions, and no summary text', () => {
    const stub = buildUnroutedStub(page1.summaries[0] as MeetingSummary);
    expect(stub).toContain('status: unrouted');
    expect(stub).toContain('zoom');
    expect(stub).toContain('run the sync again');
  });
});
