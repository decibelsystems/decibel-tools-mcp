// A read path that turns failure into emptiness tells its caller a lie the
// caller cannot detect: "no activity" and "could not read" arrive as the same
// bytes, through a success envelope. HQ measured this in the wild on
// 2026-08-30 — ten of thirty-four projects reported empty provenance that
// demonstrably had events, non-deterministic and load-dependent, which is what
// fd exhaustion under a concurrency-6 fan-out looks like.
//
// These tests pin the two properties that make the difference visible: a
// non-ENOENT failure propagates, and records lost to a bad parse are counted.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { listProvenance } from '../../src/tools/provenance.js';
import { listRuns } from '../../src/tools/vector.js';

// chmod cannot lock root out of a directory, so the permission-denied case is
// not expressible when the suite runs as root (some CI containers do).
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

let projectRoot: string;

async function writeEvent(name: string, body: string): Promise<void> {
  const dir = path.join(projectRoot, '.decibel', 'provenance', 'events');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, name), body, 'utf-8');
}

const validEvent = (id: string) => `event_id: ${id}
timestamp: 2026-08-30T00:00:00.000Z
actor_id: human:test
action: create
artifact_refs:
  - ISS-0001
reason_code: initial_creation
`;

beforeEach(async () => {
  projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'decibel-readpath-'));
  await fs.mkdir(path.join(projectRoot, '.decibel'), { recursive: true });
});

afterEach(async () => {
  await fs.rm(projectRoot, { recursive: true, force: true });
});

describe('listProvenance — empty must mean empty', () => {
  it('reports a genuinely empty store as empty, with nothing unreadable', async () => {
    const out = await listProvenance({ projectId: projectRoot });
    expect(out).toMatchObject({ events: [], total_count: 0, unreadable_count: 0 });
  });

  it('lists healthy events', async () => {
    await writeEvent('PROV-1.yml', validEvent('PROV-1'));
    await writeEvent('PROV-2.yml', validEvent('PROV-2'));

    const out = await listProvenance({ projectId: projectRoot });

    expect('events' in out && out.events.length).toBe(2);
    expect('unreadable_count' in out && out.unreadable_count).toBe(0);
  });

  it('counts a record it could not parse instead of dropping it silently', async () => {
    await writeEvent('PROV-1.yml', validEvent('PROV-1'));
    await writeEvent('PROV-2.yml', ': not: valid: yaml: [');

    const out = await listProvenance({ projectId: projectRoot });

    // The healthy record still comes back — one corrupt file must not hide the rest.
    expect('events' in out && out.events.length).toBe(1);
    // ...but the loss is visible, so a caller can tell this list is short.
    expect('unreadable_count' in out && out.unreadable_count).toBe(1);
  });

  it('counts a record missing required fields — the same silent loss', async () => {
    await writeEvent('PROV-1.yml', validEvent('PROV-1'));
    await writeEvent('PROV-2.yml', 'summary: no event_id, no timestamp, no actor\n');

    const out = await listProvenance({ projectId: projectRoot });

    expect('events' in out && out.events.length).toBe(1);
    expect('unreadable_count' in out && out.unreadable_count).toBe(1);
  });

  it.skipIf(isRoot)('propagates a read failure that is NOT a missing directory', async () => {
    // The exact production shape: the events dir exists but cannot be read.
    // Before the fix, a bare catch turned this into {events: [], total_count: 0}
    // — a success envelope claiming the project had no activity.
    const dir = path.join(projectRoot, '.decibel', 'provenance', 'events');
    await fs.mkdir(dir, { recursive: true });
    await writeEvent('PROV-1.yml', validEvent('PROV-1'));
    await fs.chmod(dir, 0o000);

    try {
      await expect(listProvenance({ projectId: projectRoot })).rejects.toThrow();
    } finally {
      await fs.chmod(dir, 0o755);
    }
  });
});

describe('listRuns — a read must not write', () => {
  it('returns no runs without creating the runs directory', async () => {
    const runsDir = path.join(projectRoot, '.decibel', 'runs');

    const out = await listRuns({ projectId: projectRoot });

    expect(out.runs).toEqual([]);
    // The mistyped-project case: listing used to mkdir its way to an empty
    // answer, so a wrong project_id looked exactly like an idle project and
    // left a directory behind to prove it had been asked.
    await expect(fs.access(runsDir)).rejects.toThrow();
  });
});
