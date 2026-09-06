// ============================================================================
// S5 — Concurrency and crash (the actual torture)
// ============================================================================
// Spec: .decibel/specs/2026-09-02-tool-torture-test.md
//
// Gate for 3.0: HARD for sentinel issues and epics; advisory elsewhere.
//
// The class this store is structurally exposed to: one writer claim, many
// callers, plain files. Every other sweep calls tools one at a time, which is
// precisely the condition under which this whole family of defect is invisible
// — four duplicate-id groups reached the real store while every sequential
// test stayed green.
//
// CONTENTION IS ASSERTED, NOT ASSUMED. Booting a kernel costs seconds and the
// cost varies per process, so racers left to their own devices finish
// staggered and never touch each other. The barrier in raceInKernel lines them
// up, and the first test in each group asserts they actually overlapped. A
// green S5 whose racers ran one after another would be the harness lying in
// exactly the shape S2's fixture paths did.
// ============================================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import {
  makeSandbox,
  raceInKernel,
  racersOverlapped,
  scrubbedEnv,
  REPO_ROOT,
  type RacerResult,
  type SandboxPaths,
} from './harness.js';

/** The spec's N=50, as 10 processes making 5 records each. */
const RACERS = 10;
const PER_RACER = 5;
const TOTAL = RACERS * PER_RACER;

/**
 * Ten processes rather than fifty because the threat model is CROSS-PROCESS —
 * separate MCP clients, hooks and scripts on one machine — and fifty concurrent
 * tsx boots measures the machine rather than the lock. Five creates each keeps
 * every racer inside the contended window for the whole run instead of firing
 * once and exiting, which is the harder case for a lock that spans allocation
 * through write.
 */

interface CreateRun {
  ids: string[];
  errors: string[];
}

/** Records on disk, by the id in their filename. */
function idsOnDisk(dir: string, prefix: 'ISS' | 'EPIC'): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter(f => f.endsWith('.md') || f.endsWith('.yml'))
    .map(f => f.match(new RegExp(`^(${prefix}-\\d+)`))?.[1])
    .filter((id): id is string => !!id);
}

function duplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const v of values) {
    if (seen.has(v)) dupes.add(v);
    seen.add(v);
  }
  return [...dupes];
}

/** Leftovers from an interrupted atomic write. */
function strayTempFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.tmp'));
}

// ============================================================================
// Concurrent creation — issues
// ============================================================================

describe('S5 — 50 concurrent create_issue across 10 processes', () => {
  let box: SandboxPaths;
  let results: RacerResult<CreateRun>[];
  let issuesDir: string;

  beforeAll(async () => {
    box = makeSandbox('s5-issues');
    issuesDir = path.join(box.project, '.decibel', 'sentinel', 'issues');

    results = await raceInKernel<CreateRun>(
      box.home,
      `
      const ids: string[] = [];
      const errors: string[] = [];
      for (let i = 0; i < ${PER_RACER}; i++) {
        const r = await call('sentinel', {
          action: 'create_issue',
          project_id: 'torture',
          severity: 'med',
          title: 'racer ' + racer + ' issue ' + i,
          details: 'created under contention by racer ' + racer,
        });
        const p = r.parsed as { id?: string; issue_id?: string } | undefined;
        const id = p?.issue_id ?? p?.id;
        if (id) ids.push(id);
        else errors.push('racer ' + racer + ' create ' + i + ': ' + r.text.slice(0, 200));
      }
      return { ids, errors };
      `,
      { racers: RACERS }
    );
  }, 900_000);

  afterAll(() => box?.cleanup());

  it('actually ran the racers concurrently', () => {
    // The calibration assertion. Without it every result below is a claim about
    // sequential creates wearing a concurrency test's name.
    const spread = Math.max(...results.map(r => r.startedAt)) - Math.min(...results.map(r => r.startedAt));
    console.log(
      `S5 issues: ${RACERS} racers released within ${spread}ms of each other, ` +
      `window ${Math.min(...results.map(r => r.startedAt))}..${Math.max(...results.map(r => r.finishedAt))}`
    );
    expect(racersOverlapped(results), 'racers did not overlap — nothing contended').toBe(true);
  });

  it('every racer completed without throwing', () => {
    const threw = results.filter(r => r.error).map(r => `racer ${r.racer}: ${r.error?.slice(0, 300)}`);
    expect(threw, 'a racer threw instead of contending for the lock').toEqual([]);
  });

  it('no create_issue call was refused', () => {
    const errors = results.flatMap(r => r.value?.errors ?? []);
    expect(errors, 'create_issue failed under contention').toEqual([]);
  });

  it('hands out 50 DISTINCT ids', () => {
    // The duplicate-id defect, stated as an assertion. Four groups of these
    // reached the real store before the allocator held its lock through write.
    const ids = results.flatMap(r => r.value?.ids ?? []);
    expect(ids.length).toBe(TOTAL);
    expect(duplicates(ids), 'the same id was handed to two callers').toEqual([]);
  });

  it('leaves 50 records on disk — zero lost writes', () => {
    // Distinct ids are not enough: two writers can be given different ids and
    // still lose a file if the write clobbers. Count what survived.
    const onDisk = idsOnDisk(issuesDir, 'ISS');
    expect(duplicates(onDisk), 'two records claim one id on disk').toEqual([]);
    expect(onDisk.length, 'records were lost between allocation and disk').toBe(TOTAL);
  });

  it('every id a caller was given exists on disk', () => {
    // The other direction, and the one that catches a silent clobber: a caller
    // told "ISS-0042 created" must be able to find ISS-0042.
    const onDisk = new Set(idsOnDisk(issuesDir, 'ISS'));
    const missing = results.flatMap(r => r.value?.ids ?? []).filter(id => !onDisk.has(id));
    expect(missing, 'ids reported as created that are not on disk').toEqual([]);
  });

  it('leaves no stray temp files behind', () => {
    expect(strayTempFiles(issuesDir)).toEqual([]);
  });

  it('every record on disk parses, with a frontmatter id matching its filename', () => {
    const broken: string[] = [];
    for (const file of fs.readdirSync(issuesDir).filter(f => f.endsWith('.md'))) {
      const content = fs.readFileSync(path.join(issuesDir, file), 'utf-8');
      const fm = /^---\n([\s\S]*?)\n---/.exec(content);
      if (!fm) {
        broken.push(`${file}: no frontmatter block`);
        continue;
      }
      const id = /^id:\s*(\S+)/m.exec(fm[1])?.[1];
      const fromName = file.match(/^(ISS-\d+)/)?.[1];
      if (id !== fromName) broken.push(`${file}: frontmatter id ${id} != filename ${fromName}`);
    }
    expect(broken, 'interleaved writes produced a corrupt record').toEqual([]);
  });
});

// ============================================================================
// Concurrent creation — epics
// ============================================================================

describe('S5 — 50 concurrent log_epic across 10 processes', () => {
  let box: SandboxPaths;
  let results: RacerResult<CreateRun>[];
  let epicsDir: string;

  beforeAll(async () => {
    box = makeSandbox('s5-epics');
    epicsDir = path.join(box.project, '.decibel', 'sentinel', 'epics');

    results = await raceInKernel<CreateRun>(
      box.home,
      `
      const ids: string[] = [];
      const errors: string[] = [];
      for (let i = 0; i < ${PER_RACER}; i++) {
        const r = await call('sentinel', {
          action: 'log_epic',
          project_id: 'torture',
          title: 'racer ' + racer + ' epic ' + i,
          summary: 'created under contention by racer ' + racer,
        });
        const p = r.parsed as { id?: string; epic_id?: string } | undefined;
        const id = p?.epic_id ?? p?.id;
        if (id) ids.push(id);
        else errors.push('racer ' + racer + ' log_epic ' + i + ': ' + r.text.slice(0, 200));
      }
      return { ids, errors };
      `,
      { racers: RACERS }
    );
  }, 900_000);

  afterAll(() => box?.cleanup());

  it('actually ran the racers concurrently', () => {
    expect(racersOverlapped(results), 'racers did not overlap — nothing contended').toBe(true);
  });

  it('every racer completed without throwing', () => {
    const threw = results.filter(r => r.error).map(r => `racer ${r.racer}: ${r.error?.slice(0, 300)}`);
    expect(threw).toEqual([]);
  });

  it('no log_epic call was refused', () => {
    expect(results.flatMap(r => r.value?.errors ?? [])).toEqual([]);
  });

  it('hands out 50 DISTINCT ids', () => {
    const ids = results.flatMap(r => r.value?.ids ?? []);
    expect(ids.length).toBe(TOTAL);
    expect(duplicates(ids), 'the same epic id was handed to two callers').toEqual([]);
  });

  it('leaves 50 records on disk — zero lost writes', () => {
    // Epics are the worse case of the two. An issue collision leaves two files
    // and a visible duplicate; an epic collision writes both records to one
    // path, so the loser is not duplicated — it is GONE, and the caller was
    // told it was created.
    const onDisk = idsOnDisk(epicsDir, 'EPIC');
    expect(duplicates(onDisk), 'two records claim one epic id on disk').toEqual([]);
    expect(onDisk.length, 'epic records were lost between allocation and disk').toBe(TOTAL);
  });

  it('every id a caller was given exists on disk', () => {
    const onDisk = new Set(idsOnDisk(epicsDir, 'EPIC'));
    const missing = results.flatMap(r => r.value?.ids ?? []).filter(id => !onDisk.has(id));
    expect(missing, 'epic ids reported as created that are not on disk').toEqual([]);
  });

  it('leaves no stray temp files behind', () => {
    expect(strayTempFiles(epicsDir)).toEqual([]);
  });
});

// ============================================================================
// Concurrent mutation of one record
// ============================================================================

describe('S5 — 10 concurrent update_issue against one issue', () => {
  let box: SandboxPaths;
  let results: RacerResult<{ status: string; ok: boolean; text: string }>[];
  let issuesDir: string;
  const TARGET = 'ISS-0001';
  const STATUSES = ['open', 'in_progress', 'done', 'blocked'];

  beforeAll(async () => {
    box = makeSandbox('s5-update');
    issuesDir = path.join(box.project, '.decibel', 'sentinel', 'issues');

    // One issue, written sequentially, so the race below is purely about
    // mutation rather than about creation.
    await raceInKernel(
      box.home,
      `
      await call('sentinel', {
        action: 'create_issue', project_id: 'torture', severity: 'med',
        title: 'the contended issue', details: 'every racer updates this one',
      });
      return true;
      `,
      { racers: 1 }
    );

    results = await raceInKernel(
      box.home,
      `
      const status = ${JSON.stringify(STATUSES)}[racer % 4];
      const r = await call('sentinel', {
        action: 'update_issue',
        project_id: 'torture',
        issue_id: '${TARGET}',
        status,
        note: 'note from racer ' + racer,
      });
      return { status, ok: !r.isError, text: r.text.slice(0, 200) };
      `,
      { racers: RACERS }
    );
  }, 900_000);

  afterAll(() => box?.cleanup());

  it('actually ran the racers concurrently', () => {
    expect(racersOverlapped(results), 'racers did not overlap — nothing contended').toBe(true);
  });

  it('leaves exactly one record for the contended id', () => {
    expect(idsOnDisk(issuesDir, 'ISS')).toEqual([TARGET]);
  });

  it('leaves a file that still parses, with exactly one frontmatter block', () => {
    // The spec's hard line: last-write-wins or an explicit conflict is
    // acceptable, a merged or truncated file is not.
    const file = fs.readdirSync(issuesDir).find(f => f.startsWith(TARGET))!;
    const content = fs.readFileSync(path.join(issuesDir, file), 'utf-8');

    const fences = content.split('\n').filter(l => l === '---').length;
    expect(fences, 'more than one frontmatter block — two writes were interleaved').toBe(2);

    const fm = /^---\n([\s\S]*?)\n---/.exec(content);
    expect(fm, 'frontmatter no longer parses').not.toBeNull();

    const idLines = fm![1].split('\n').filter(l => /^id:/.test(l));
    expect(idLines.length, 'duplicated frontmatter keys — a merged write').toBe(1);
  });

  it('ends on a status some racer actually wrote', () => {
    const file = fs.readdirSync(issuesDir).find(f => f.startsWith(TARGET))!;
    const content = fs.readFileSync(path.join(issuesDir, file), 'utf-8');
    const status = /^status:\s*(\S+)/m.exec(content)?.[1];
    const written = new Set(results.filter(r => r.value?.ok).map(r => r.value!.status));
    expect([...written], 'no racer succeeded, so there is nothing to win').not.toEqual([]);
    expect(written.has(status ?? ''), `final status ${status} was never written by any racer`).toBe(true);
  });

  it('reports how many appended notes survived', () => {
    // ADVISORY, not a gate. `notes` appends, so under last-write-wins some are
    // expected to be lost and the spec permits that. It is recorded because a
    // number that quietly drops is how this class of bug hides — and because
    // if it ever reads 10, the update path became read-modify-write safe and
    // this test should be promoted to an assertion.
    const file = fs.readdirSync(issuesDir).find(f => f.startsWith(TARGET))!;
    const content = fs.readFileSync(path.join(issuesDir, file), 'utf-8');
    const survived = results.filter(r => content.includes(`note from racer ${r.racer}`)).length;
    const accepted = results.filter(r => r.value?.ok).length;
    const refusals = results.filter(r => r.value && !r.value.ok).map(r => r.value!.text);
    console.log(
      `S5 update: ${accepted}/${RACERS} updates accepted, ${survived}/${RACERS} notes survived` +
      (refusals.length ? `\n  refusals: ${JSON.stringify(refusals.slice(0, 3))}` : '')
    );
    expect(survived, 'the winning write did not even keep its own note').toBeGreaterThan(0);
  });

  it('leaves no stray temp files behind', () => {
    expect(strayTempFiles(issuesDir)).toEqual([]);
  });
});

// ============================================================================
// Crash mid-write
// ============================================================================

describe('S5 — SIGKILL during a write', () => {
  let box: SandboxPaths;
  let issuesDir: string;
  let runs: KillRun[] = [];

  interface KillRun {
    filesAtKill: number;
    filesAfter: number;
    exited: boolean;
  }

  /**
   * Start a writer, let it get going, then SIGKILL it mid-write.
   *
   * KILL THE PROCESS GROUP, not the child. `node_modules/.bin/tsx` is a shim
   * that spawns node as a GRANDCHILD, so `child.kill()` reaps the wrapper and
   * leaves the writer orphaned — running at full tilt with nobody waiting on
   * it. The first version of this test did exactly that and would have reported
   * four successful kills while four processes kept writing; one of them was
   * still going twelve minutes later. Hence `detached` plus `kill(-pid)`.
   *
   * And the death is VERIFIED rather than assumed: after the signal the record
   * count must stop moving. "We sent a signal" is not evidence that anything
   * stopped, which is the same circular-verification trap as everywhere else
   * in this suite.
   */
  function killDuringWrite(home: string, dir: string, minRecords: number): Promise<KillRun> {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'torture-kill-'));
    const file = path.join(tmp, 'victim.mts');
    fs.writeFileSync(file, `
      import { createKernel } from '${REPO_ROOT}/src/kernel.js';
      const kernel = await createKernel();
      for (let i = 0; i < 10_000; i++) {
        await kernel.dispatch('sentinel', {
          action: 'create_issue', project_id: 'torture', severity: 'med',
          title: 'victim ' + i,
          // A large body widens the interval between the temp-file write and
          // the rename, which is the window a SIGKILL has to land in to matter.
          details: 'x'.repeat(120_000),
        }, { transport: 'stdio', tier: 'pro' });
      }
    `);

    const count = () => (fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.md')).length : 0);

    return new Promise<KillRun>(resolve => {
      const child = spawn(path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx'), [file], {
        cwd: tmp,
        env: scrubbedEnv(home),
        detached: true,   // its own process group, so the signal reaches the grandchild
        stdio: 'ignore',
      });

      let exited = false;
      child.on('exit', () => { exited = true; });

      const deadline = Date.now() + 120_000;
      const poll = setInterval(() => {
        const now = count();
        if (now < minRecords && Date.now() < deadline) return;
        clearInterval(poll);

        try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* already gone */ }

        // Give the group a moment to die, then check the store stopped growing.
        setTimeout(() => {
          const after = count();
          fs.rmSync(tmp, { recursive: true, force: true });
          resolve({ filesAtKill: now, filesAfter: after, exited });
        }, 1_500);
      }, 50);
    });
  }

  beforeAll(async () => {
    box = makeSandbox('s5-kill');
    issuesDir = path.join(box.project, '.decibel', 'sentinel', 'issues');
    // Four kills at different depths, because one fixed point in the write
    // cycle tests one thing and the interesting cases are the others.
    for (const minRecords of [3, 8, 15, 25]) {
      runs.push(await killDuringWrite(box.home, issuesDir, minRecords));
    }
  }, 900_000);

  afterAll(() => box?.cleanup());

  it('actually stopped the writer — the store stopped growing after the signal', () => {
    // The calibration assertion, and the one the first draft of this test got
    // wrong. A kill that orphans the writer looks identical to a kill that
    // worked, right up until the store keeps filling.
    console.log(
      `S5 kill: ${runs.length} runs, records at kill ${runs.map(r => r.filesAtKill).join('/')}, ` +
      `after ${runs.map(r => r.filesAfter).join('/')}`
    );
    const survived = runs
      .map((r, i) => ({ i, r }))
      .filter(({ r }) => r.filesAfter > r.filesAtKill)
      .map(({ i, r }) => `run ${i}: ${r.filesAtKill} -> ${r.filesAfter} records after SIGKILL`);
    expect(survived, 'the writer outlived the signal — the process group was not killed').toEqual([]);
  });

  it('wrote something before dying, so there is a store to judge', () => {
    expect(idsOnDisk(issuesDir, 'ISS').length).toBeGreaterThan(0);
  });

  it('leaves every surviving record complete — no truncated file', () => {
    // The property atomic writes exist to provide: a record is the old version
    // or the new one, never half of one.
    const broken: string[] = [];
    for (const file of fs.readdirSync(issuesDir).filter(f => f.endsWith('.md'))) {
      const content = fs.readFileSync(path.join(issuesDir, file), 'utf-8');
      if (!/^---\n[\s\S]*?\n---/.test(content)) {
        broken.push(`${file}: truncated before the frontmatter closed (${content.length} bytes)`);
        continue;
      }
      if (!/^id:\s*ISS-\d+/m.test(content)) broken.push(`${file}: no id survived`);
    }
    expect(broken, 'a SIGKILL left a partially written record').toEqual([]);
  });

  it('leaves no duplicate ids behind', () => {
    // A writer killed between allocation and write releases its lock only by
    // going stale. The next writer must not hand out an id that already landed.
    expect(duplicates(idsOnDisk(issuesDir, 'ISS'))).toEqual([]);
  });

  it('leaves no stray temp file behind', () => {
    // A killed writer cannot clean up after itself, so this asserts something
    // else does — or documents that nothing does.
    expect(strayTempFiles(issuesDir), 'temp files from a killed writer are never reclaimed').toEqual([]);
  });

  it('leaves no orphaned lock that would wedge the next writer', () => {
    // A held lock is only a problem if it is never reclaimed; withFileLock
    // steals one older than 30s. Assert the recovery path, not the absence.
    const locks = fs.readdirSync(issuesDir).filter(f => f.endsWith('.lock'));
    for (const lock of locks) {
      const age = Date.now() - fs.statSync(path.join(issuesDir, lock)).mtimeMs;
      expect(age, `${lock} is held and not yet stealable`).toBeLessThan(30_000);
    }
  });
});
